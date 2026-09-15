import Peer, { type DataConnection, type PeerOptions } from 'peerjs';
import { catalogVersion, promptById, PROMPT_IDS } from './data';
import { commitment, DuelEngine, GRACE_MS, type DuelState, type Seat, safeName } from './duel-engine';
import { DEFAULT_SETTINGS, validSettings, type DuelSettings } from './settings';
import { peerOptions } from './connection-config';

export const CONNECT_TIMEOUT_MS = 20_000;
export const HANDSHAKE_TIMEOUT_MS = 10_000;
export const JOIN_TIMEOUT_MS = 60_000;
const SIGNALING_TIMEOUT_MS = 25_000;
const RETRY_DELAY_MS = 2_000;

type Draft = { matchId: string; round: number; promptId: string; input: string; salt: string; hash: string };
type Callbacks = { change: (state: DuelState) => void; status: (message: string) => void; error: (message: string) => void };
type Packet = Record<string, unknown>;
type HintPurchase = { matchId: string; round: number; expectedHintLevel: number; sentAt: number;
  promise: Promise<boolean>; resolve: (accepted: boolean) => void; timer: ReturnType<typeof setTimeout> };
export const roomFromHash = (): string | null => {
  const id = new URLSearchParams(location.hash.slice(1)).get('room');
  return id && /^[a-f0-9]{24}$/.test(id) ? id : null;
};
export const storageRead = (key: string): string | null => { try { return sessionStorage.getItem(key); } catch { return null; } };
const storageWrite = (key: string, value: string): void => { try { sessionStorage.setItem(key, value); } catch { /* Room still works without storage. */ } };
const storageRemove = (key: string): void => { try { sessionStorage.removeItem(key); } catch { /* Storage may be disabled. */ } };

/** Browser-to-browser rooms; the host owns timing/scoring. No account or custom backend. */
export class DuelRoom {
  readonly room: string;
  readonly seat: Seat;
  state: DuelState | null = null;
  hostClockOffset: number | null = null;
  private clockSamples: { rtt: number; offset: number }[] = [];
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private engine: DuelEngine | null = null;
  private version = '';
  private guestToken = '';
  private token = '';
  private alive = true;
  private accepted = false;
  private lastSeen = Date.now();
  private lastBroadcast = 0;
  private reconnectStarted: number | null = null;
  private nextRetry = 0;
  private retryAttempts = 0;
  private attemptStarted: number | null = null;
  private handshakeStarted: number | null = null;
  private serviceStarted: number | null = null;
  private serviceOpened = false;
  private nextServiceRetry = 0;
  private slowHintShown = false;
  private lastError = '';
  private lastIce = 'not started';
  private lastConnection = 'not started';
  private stage = 'idle';
  private pendingHost = new Map<DataConnection, { started: number; opened: number | null }>();
  private interval = 0;
  private draft: Draft | null = null;
  private revealing = false;
  private sending = false;
  private hostRevealedKey = '';
  private hintPending: HintPurchase | null = null;

  constructor(private name: string, room: string | null, private callbacks: Callbacks, settings: DuelSettings = DEFAULT_SETTINGS) {
    this.name = safeName(name);
    this.room = room ?? crypto.randomUUID().replaceAll('-', '').slice(0, 24);
    this.seat = room ? 1 : 0;
    if (this.seat === 0) this.hostClockOffset = 0;
    this.token = storageRead(`kd-token-${this.room}`) || crypto.randomUUID();
    storageWrite(`kd-token-${this.room}`, this.token);
    if (!room) this.engine = new DuelEngine(this.name, undefined, undefined, settings);
    try {
      const saved = JSON.parse(storageRead(`kd-answer-${this.room}`) ?? 'null') as Draft | null;
      if (saved && typeof saved.input === 'string' && typeof saved.salt === 'string' && typeof saved.hash === 'string') this.draft = saved;
    } catch { /* A broken draft does not prevent a new connection. */ }
  }

  get invite(): string { return `${location.origin}${location.pathname}#room=${this.room}`; }

  /** Safe to share: no room IDs, session tokens, answers, IPs, or relay credentials. */
  diagnostics(): object {
    const pc = this.conn?.peerConnection;
    return {
      app: 'krill-duels', protocol: 3, role: this.seat === 0 ? 'host' : 'guest', stage: this.stage,
      signaling: this.peer?.destroyed ? 'closed' : this.peer?.open ? 'open' : this.peer?.disconnected ? 'disconnected' : 'connecting',
      attempts: this.retryAttempts, dataChannel: this.conn?.open ? 'open' : 'closed', accepted: this.accepted,
      ice: pc?.iceConnectionState ?? this.lastIce, connection: pc?.connectionState ?? this.lastConnection,
      lastError: this.lastError || null,
    };
  }

  async open(): Promise<void> {
    if (!this.alive || this.interval) return;
    this.stage = 'service';
    this.serviceStarted = Date.now();
    this.reconnectStarted = Date.now();
    this.interval = window.setInterval(() => this.tick(), 250);
    this.callbacks.status(this.seat === 0 ? 'Opening your room…' : 'Joining your friend…');
    try {
      this.version = `krill-duels-3:${await catalogVersion()}`;
    } catch {
      this.fail('Could not prepare the game. Refresh the page and try again.');
      return;
    }
    if (!this.alive) return;
    let options: PeerOptions;
    try { options = peerOptions(); }
    catch {
      this.lastError = 'configuration-error';
      this.fail('Live rooms are temporarily unavailable because of a site setup problem. Please report it using the connection details below.');
      return;
    }
    try {
      this.peer = this.seat === 0 ? new Peer(`kd-${this.room}`, options) : new Peer(options);
    } catch {
      this.lastError = 'initialization-error';
      this.fail('Could not start the live connection. Refresh the page and try again.');
      return;
    }
    this.peer.on('open', () => {
      if (!this.alive) return;
      this.serviceOpened = true;
      this.serviceStarted = null;
      if (this.accepted) return;
      // Signaling can recover while ICE is still negotiating. Keep that attempt.
      if (this.seat === 1 && this.attemptStarted !== null) return;
      this.stage = this.seat === 0 ? 'waiting for friend' : 'connecting';
      this.callbacks.status(this.seat === 0 ? 'Room open. Send your invite link.' : 'Connecting to your friend…');
      if (this.seat === 1 && !this.accepted) this.connect();
      else this.publish();
    });
    this.peer.on('connection', connection => {
      if (!this.alive || this.seat !== 0) { connection.close(); return; }
      this.wireHost(connection);
    });
    this.peer.on('disconnected', () => {
      if (!this.alive) return;
      this.serviceStarted ??= Date.now();
      if (!this.accepted) this.callbacks.status('Room service interrupted. Reconnecting…');
    });
    this.peer.on('error', error => {
      if (!this.alive) return;
      this.lastError = error.type;
      // PeerJS emits these without a connection ID, including from promises on
      // already-closed attempts. The channel's own events/timeouts own recovery.
      if (error.type === 'webrtc') return;
      if (error.type === 'peer-unavailable' && this.seat === 1) {
        if (!this.accepted) this.retryConnection();
        return;
      }
      if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(error.type)) {
        this.serviceStarted ??= Date.now();
        if (!this.accepted) this.callbacks.status('Room service interrupted. Reconnecting…');
        return;
      }
      this.fail(error.type === 'browser-incompatible'
        ? 'This browser cannot connect live rooms. Try a recent Chrome, Safari, Firefox, or Edge browser.'
        : 'The room could not connect. Try again, or try a different network.');
    });
  }

  private connect(): void {
    if (!this.peer || this.peer.disconnected || this.peer.destroyed || !this.alive) return;
    this.retryAttempts++;
    this.attemptStarted = Date.now();
    this.handshakeStarted = null;
    this.slowHintShown = false;
    this.stage = 'connecting';
    this.callbacks.status(this.state ? 'Connection interrupted. Reconnecting…' : 'Connecting to your friend… Allowing time for your network.');
    // Binary serialization chunks long match histories; PeerJS JSON is limited to 16 KB.
    let connection: DataConnection;
    try {
      connection = this.peer.connect(`kd-${this.room}`, { reliable: true, serialization: 'binary' });
    } catch {
      this.lastError = 'connection-error';
      this.retryConnection();
      return;
    }
    const previous = this.conn;
    this.conn = connection;
    previous?.close();
    this.accepted = false;
    connection.on('open', () => {
      if (this.conn !== connection || !this.alive) return;
      this.handshakeStarted = Date.now();
      this.stage = 'checking room';
      this.callbacks.status('Connection open. Checking the room…');
      this.send({ type: 'hello', version: this.version, name: this.name, token: this.token });
      this.lastSeen = Date.now();
    });
    connection.on('data', value => {
      if (this.conn !== connection || !this.alive) return;
      const packet = this.packet(value);
      if (!packet) return;
      this.lastSeen = Date.now();
      if (packet.type === 'reject') {
        this.fail(typeof packet.reason === 'string' ? packet.reason : 'The room is unavailable.');
      } else if (packet.type === 'state' && packet.version === this.version && this.validSnapshot(packet.state)) {
        const wasAccepted = this.accepted;
        this.accepted = true;
        this.reconnectStarted = null;
        this.attemptStarted = null;
        this.handshakeStarted = null;
        this.stage = 'connected';
        if (!wasAccepted) this.callbacks.status('Connected');
        this.receive(packet.state as DuelState);
      } else if (packet.type === 'hint-result' && typeof packet.accepted === 'boolean') {
        const pending = this.hintPending;
        if (pending && packet.matchId === pending.matchId && packet.round === pending.round &&
            packet.expectedHintLevel === pending.expectedHintLevel) this.finishHint(packet.accepted);
      } else if (packet.type === 'pong' && typeof packet.sent === 'number' && typeof packet.now === 'number') {
        const arrived = Date.now();
        const rtt = arrived - packet.sent;
        if (Number.isFinite(packet.now) && rtt >= 0 && rtt < 8_000) {
          this.clockSamples.push({ rtt, offset: (packet.sent + arrived) / 2 - packet.now });
          this.clockSamples = this.clockSamples.slice(-12);
          this.hostClockOffset = this.clockSamples.reduce((best, sample) => sample.rtt < best.rtt ? sample : best).offset;
        }
      } else if (packet.type === 'ended') {
        this.fail('The host closed this room. Ask your friend for a new invite.');
      }
    });
    connection.on('close', () => {
      if (this.conn !== connection || !this.alive) return;
      this.lastError = 'connection-closed'; this.startReconnect();
    });
    connection.on('error', () => {
      if (this.conn !== connection || !this.alive) return;
      this.lastError = 'connection-error'; this.startReconnect();
    });
  }

  private wireHost(connection: DataConnection): void {
    let authenticated = false;
    const timing = { started: Date.now(), opened: connection.open ? Date.now() : null as number | null };
    this.pendingHost.set(connection, timing);
    connection.on('open', () => { timing.opened = Date.now(); });
    connection.on('data', value => {
      if (!this.alive || !authenticated && !this.pendingHost.has(connection)) return;
      const packet = this.packet(value);
      if (!packet) return;
      if (!authenticated) {
        if (packet.type !== 'hello' || typeof packet.name !== 'string' || typeof packet.token !== 'string' || packet.token.length > 80) return;
        if (packet.version !== this.version) {
          connection.send({ type: 'reject', reason: 'Your game versions differ. Both refresh the page, then create a new room.' });
          return;
        }
        if (this.guestToken && packet.token !== this.guestToken) {
          connection.send({ type: 'reject', reason: 'This room already has two players. Create your own duel.' });
          return;
        }
        // The same session token may reconnect; a different player cannot take this seat.
        authenticated = true;
        this.pendingHost.delete(connection);
        const previous = this.conn;
        this.conn = connection;
        previous?.close();
        this.guestToken = packet.token;
        this.accepted = true;
        this.lastSeen = Date.now();
        this.reconnectStarted = null;
        this.stage = 'connected';
        this.engine!.join(packet.name, Date.now());
        this.callbacks.status('Your friend joined. Both press Ready.');
        this.publish();
        return;
      }
      if (this.conn !== connection) return;
      this.lastSeen = Date.now();
      if (packet.type === 'ping') {
        if (typeof packet.sent === 'number' && Number.isFinite(packet.sent)) this.send({ type: 'pong', sent: packet.sent, now: Date.now() });
        return;
      }
      const current = this.engine!.snapshot(Date.now());
      if (packet.type === 'hint' && typeof packet.matchId === 'string' && typeof packet.round === 'number' &&
          typeof packet.expectedHintLevel === 'number') {
        const accepted = this.engine!.hint(1, packet.matchId, packet.round, packet.expectedHintLevel, Date.now());
        this.publish();
        this.send({ type: 'hint-result', matchId: packet.matchId, round: packet.round,
          expectedHintLevel: packet.expectedHintLevel, accepted });
        return;
      }
      if (packet.matchId !== current.matchId || packet.round !== current.round) return;
      if (packet.type === 'ready' && packet.phase === current.phase) {
        this.engine!.ready(1, Date.now()); this.publish();
      } else if (packet.type === 'commit' && typeof packet.hash === 'string') {
        this.engine!.commit(1, current.matchId, current.round, packet.hash, Date.now()); this.publish();
      } else if (packet.type === 'reveal' && typeof packet.input === 'string' && typeof packet.salt === 'string') {
        void this.engine!.reveal(1, current.matchId, current.round, packet.input, packet.salt, Date.now()).then(accepted => { if (accepted) this.publish(); });
      } else if (packet.type === 'leave') {
        this.engine!.forfeit(1); this.publish();
      }
    });
    const disconnected = (): void => {
      this.pendingHost.delete(connection);
      if (this.conn !== connection || !this.alive || !authenticated) return;
      if (this.accepted && !this.peer?.open) this.serviceStarted = Date.now();
      this.accepted = false;
      this.stage = 'reconnecting';
      this.callbacks.status('Connection interrupted. Waiting for your friend to reconnect…');
      this.engine!.connection(false, Date.now());
      this.publish();
    };
    connection.on('close', disconnected);
    connection.on('error', disconnected);
  }

  ready(): void {
    if (!this.state || !this.alive) return;
    if (this.engine) { this.engine.ready(0, Date.now()); this.publish(); }
    else this.send({ type: 'ready', matchId: this.state.matchId, round: this.state.round, phase: this.state.phase });
  }

  async submit(input: string): Promise<boolean> {
    const state = this.state;
    if (this.sending || !state || !state.connected || state.phase !== 'question' || state.committed[this.seat]) return false;
    if (this.draft?.matchId === state.matchId && this.draft.round === state.round) return false;
    this.sending = true;
    try {
      const trimmed = input.trim().slice(0, 160);
      const salt = crypto.randomUUID();
      const hash = await commitment(state.matchId, state.round, this.seat, state.promptId!, trimmed, salt);
      if (!this.alive || this.state?.matchId !== state.matchId || this.state?.round !== state.round || this.state?.phase !== 'question' || !this.state.connected) return false;
      if (!this.engine && (!this.accepted || !this.conn?.open || Date.now() - (this.hostClockOffset ?? 0) >= this.state.deadline)) return false;
      if (this.engine && !this.engine.commit(0, state.matchId, state.round, hash, Date.now())) return false;
      this.draft = { matchId: state.matchId, round: state.round, promptId: state.promptId!, input: trimmed, salt, hash };
      storageWrite(`kd-answer-${this.room}`, JSON.stringify(this.draft));
      if (this.engine) this.publish();
      else this.send({ type: 'commit', matchId: state.matchId, round: state.round, hash });
      return true;
    } finally { this.sending = false; }
  }

  hint(): Promise<boolean> {
    if (this.hintPending) return this.hintPending.promise;
    const s = this.state;
    if (!this.alive || !s?.connected || s.phase !== 'question' || s.committed[this.seat] || this.sending ||
        this.draft?.matchId === s.matchId && this.draft.round === s.round ||
        Date.now() - (this.hostClockOffset ?? 0) >= s.deadline) return Promise.resolve(false);
    if (this.engine) {
      const accepted = this.engine.hint(0, s.matchId, s.round, s.hintLevels[0], Date.now());
      this.publish();
      return Promise.resolve(accepted);
    }
    if (!this.accepted || !this.conn?.open) return Promise.resolve(false);
    let resolve!: (accepted: boolean) => void;
    const promise = new Promise<boolean>(done => { resolve = done; });
    this.hintPending = { matchId: s.matchId, round: s.round, expectedHintLevel: s.hintLevels[1],
      sentAt: Date.now(), promise, resolve, timer: setTimeout(() => this.finishHint(false), 6000) };
    this.sendHint();
    return promise;
  }

  private sendHint(): void {
    const p = this.hintPending;
    if (!p || !this.accepted || !this.conn?.open) return;
    p.sentAt = Date.now();
    this.send({ type: 'hint', matchId: p.matchId, round: p.round, expectedHintLevel: p.expectedHintLevel });
  }

  private finishHint(accepted: boolean): void {
    const pending = this.hintPending;
    if (!pending) return;
    this.hintPending = null;
    clearTimeout(pending.timer);
    pending.resolve(accepted);
  }

  private receive(state: DuelState): void {
    if (!this.alive) return;
    this.hostClockOffset ??= Date.now() - state.now;
    const previous = this.state;
    if (previous && previous.matchId === state.matchId && JSON.stringify(previous.settings) !== JSON.stringify(state.settings)) {
      this.fail('Room settings changed during the match. Create a new duel.'); return;
    }
    // Pin commitments; a changed hash after locking is a protocol error.
    if (previous && previous.matchId === state.matchId && previous.round === state.round) {
      for (const seat of [0, 1] as const) {
        if (previous.hashes[seat] && previous.hashes[seat] !== state.hashes[seat]) {
          this.fail('The room sent conflicting answers. Create a new duel.'); return;
        }
      }
    }
    this.state = state;
    const pendingHint = this.hintPending;
    if (pendingHint) {
      if (state.matchId !== pendingHint.matchId || state.round !== pendingHint.round) this.finishHint(false);
      else if (state.hintLevels[this.seat] > pendingHint.expectedHintLevel) this.finishHint(true);
      else if (state.phase !== 'question' || state.committed[this.seat]) this.finishHint(false);
    }
    if (this.draft && (this.draft.matchId !== state.matchId || this.draft.round !== state.round || ['result', 'finished'].includes(state.phase))) {
      this.draft = null;
      storageRemove(`kd-answer-${this.room}`);
    }
    this.callbacks.change(state);
    const draft = this.draft;
    if (draft && state.connected && state.phase === 'question' && !state.committed[this.seat]) {
      // Restore a sent commitment after a brief guest reconnect.
      if (!this.engine) this.send({ type: 'commit', matchId: draft.matchId, round: draft.round, hash: draft.hash });
    }
    const revealKey = draft ? `${draft.matchId}:${draft.round}` : '';
    if (draft && state.connected && state.phase === 'reveal' && state.hashes[this.seat] === draft.hash && !this.revealing && (!this.engine || this.hostRevealedKey !== revealKey)) {
      this.revealing = true;
      if (this.engine) {
        this.hostRevealedKey = revealKey;
        void this.engine.reveal(0, draft.matchId, draft.round, draft.input, draft.salt, Date.now()).then(accepted => {
          this.revealing = false;
          if (accepted) this.publish();
          else if (this.hostRevealedKey === revealKey) this.hostRevealedKey = '';
        });
      } else {
        this.send({ type: 'reveal', matchId: draft.matchId, round: draft.round, input: draft.input, salt: draft.salt });
        this.revealing = false;
      }
    }
  }

  private publish(): void {
    if (!this.engine || !this.alive || !this.serviceOpened) return;
    const state = this.engine.snapshot(Date.now());
    this.send({ type: 'state', version: this.version, state });
    this.receive(state);
  }

  private startReconnect(): void {
    const wasAccepted = this.accepted;
    if (wasAccepted && !this.peer?.open) this.serviceStarted = Date.now();
    this.accepted = false;
    this.reconnectStarted ??= Date.now();
    this.stage = this.state ? 'reconnecting' : 'connecting';
    this.callbacks.status(this.state ? 'Connection interrupted. Reconnecting…' : 'Could not connect yet. Retrying while the host keeps the room open…');
    if (this.engine) this.engine.connection(false, Date.now());
    else if (wasAccepted) {
      if (this.state && this.state.phase !== 'finished') {
        const now = Date.now() - (this.hostClockOffset ?? 0);
        this.state = { ...this.state, connected:false, reconnectUntil:now + GRACE_MS, now };
        this.callbacks.change(this.state);
      }
    }
    if (!this.engine) this.clearAttempt();
  }

  private clearAttempt(): void {
    const previous = this.conn;
    this.lastIce = previous?.peerConnection?.iceConnectionState ?? this.lastIce;
    this.lastConnection = previous?.peerConnection?.connectionState ?? this.lastConnection;
    this.conn = null;
    this.attemptStarted = null;
    this.handshakeStarted = null;
    this.nextRetry = Date.now() + RETRY_DELAY_MS;
    previous?.close();
  }

  private retryConnection(): void {
    this.startReconnect();
  }

  private fail(message: string): void {
    this.stage = 'failed';
    this.dispose(false);
    if (this.state) {
      this.state = { ...this.state, connected: false };
      this.callbacks.change(this.state);
    }
    this.callbacks.status('Connection stopped.');
    this.callbacks.error(message);
  }

  private tick(): void {
    if (!this.alive) return;
    const now = Date.now();
    if (this.hintPending && now - this.hintPending.sentAt >= 1000) this.sendHint();
    // Keep an established game alive even if signaling drops. Discovery is only
    // needed for a new data channel, and reconnect() can throw during retries.
    if (this.peer?.disconnected && !this.peer.destroyed && now >= this.nextServiceRetry) {
      this.nextServiceRetry = now + RETRY_DELAY_MS;
      try { this.peer.reconnect(); } catch { /* Retry after the peer finishes disconnecting. */ }
    }
    const serviceTimeout = this.state && (this.seat === 1 || this.guestToken) ? GRACE_MS + 8_000 : SIGNALING_TIMEOUT_MS;
    if (this.serviceStarted !== null && !this.peer?.open && !this.accepted && now - this.serviceStarted >= serviceTimeout) {
      this.fail('Could not reach the room service. Check your internet connection and try again.');
      return;
    }
    if (this.engine) {
      for (const [connection, timing] of this.pendingHost) {
        const expired = timing.opened === null ? now - timing.started >= CONNECT_TIMEOUT_MS : now - timing.opened >= HANDSHAKE_TIMEOUT_MS;
        if (expired) { this.pendingHost.delete(connection); connection.close(); }
      }
      this.engine.tick(now);
      if (this.accepted && now - this.lastSeen > 8_000) {
        if (!this.peer?.open) this.serviceStarted = now;
        this.accepted = false;
        this.stage = 'reconnecting';
        this.callbacks.status('Connection interrupted. Waiting for your friend to reconnect…');
        this.engine.connection(false, now);
        this.conn?.close();
      }
      if (now - this.lastBroadcast >= 500) { this.lastBroadcast = now; this.publish(); }
    } else {
      if (this.accepted && now - this.lastSeen > 6_000) this.startReconnect();
      if (this.accepted) this.send({ type: 'ping', sent: now });
      if (this.reconnectStarted !== null) {
        const elapsed = now - this.reconnectStarted;
        if (elapsed >= (this.state ? GRACE_MS + 8_000 : JOIN_TIMEOUT_MS)) {
          this.fail(this.state ? 'The host is no longer reachable. Ask for a new invite.' : this.lastError === 'peer-unavailable'
            ? 'The host room was not found. Keep the host tab open and ask for a fresh invite.'
            : this.handshakeStarted !== null || this.lastError === 'handshake-timeout' ? 'The connection opened, but the room did not respond. Both refresh and create a new room.'
            : 'Could not connect to your friend. Keep both game tabs open and try again. If it still fails, try another network or VPN server. See Connection help.');
          return;
        }
        if (this.attemptStarted !== null) {
          const expired = this.handshakeStarted !== null ? now - this.handshakeStarted >= HANDSHAKE_TIMEOUT_MS : now - this.attemptStarted >= CONNECT_TIMEOUT_MS;
          if (expired) {
            this.lastError = this.handshakeStarted !== null ? 'handshake-timeout' : 'connection-timeout';
            this.retryConnection();
          } else if (!this.slowHintShown && this.handshakeStarted === null && now - this.attemptStarted >= 6_000) {
            this.slowHintShown = true;
            this.callbacks.status('Still connecting to your friend… This can take a little longer on some networks. See Connection help.');
          }
        } else if (now >= this.nextRetry && this.peer?.open) this.connect();
      }
    }
  }

  private send(packet: object): void {
    if (this.alive && this.conn?.open) {
      try { this.conn.send(packet); } catch { this.startReconnect(); }
    }
  }

  private packet(value: unknown): Packet | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    try { if (JSON.stringify(value).length > 1_500_000) return null; } catch { return null; }
    return value as Packet;
  }

  private validSnapshot(value: unknown): value is DuelState {
    if (!value || typeof value !== 'object') return false;
    const s = value as DuelState;
    return validSettings(s.settings) && typeof s.matchId === 'string' && s.matchId.length <= 80 &&
      ['lobby', 'countdown', 'question', 'reveal', 'result', 'finished'].includes(s.phase) &&
      Number.isInteger(s.round) && s.round >= 0 && s.round <= PROMPT_IDS.length &&
      (s.promptId === null || typeof s.promptId === 'string' && !!promptById(s.promptId)) &&
      Array.isArray(s.names) && s.names.length === 2 && s.names.every(n => typeof n === 'string' && n.length <= 24) &&
      Array.isArray(s.hp) && s.hp.length === 2 && s.hp.every(h => Number.isFinite(h) && h >= 0 && h <= s.settings.startingHp) &&
      Array.isArray(s.hintUses) && s.hintUses.length === 2 && s.hintUses.every(n => Number.isSafeInteger(n) && n >= 0 && n <= PROMPT_IDS.length * 3) &&
      Array.isArray(s.hintLevels) && s.hintLevels.length === 2 && s.hintLevels.every((n, seat) => Number.isInteger(n) && n >= 0 && n <= 3 && n <= s.hintUses[seat]) &&
      Array.isArray(s.ready) && s.ready.length === 2 && s.ready.every(b => typeof b === 'boolean') &&
      Array.isArray(s.committed) && s.committed.length === 2 && s.committed.every(b => typeof b === 'boolean') &&
      Array.isArray(s.hashes) && s.hashes.length === 2 && s.hashes.every(h => h === null || typeof h === 'string' && /^[a-f0-9]{64}$/.test(h)) &&
      Array.isArray(s.history) && s.history.length <= PROMPT_IDS.length && s.history.every(r =>
        r && typeof r.promptId === 'string' && !!promptById(r.promptId) && Number.isInteger(r.round) &&
        Number.isFinite(r.damage) && r.damage >= 0 && r.damage <= 300 && [null, 0, 1].includes(r.loser) &&
        [1, 2, 3].includes(r.multiplier) && Array.isArray(r.results) && r.results.length === 2 && r.results.every(a =>
          a && typeof a.input === 'string' && a.input.length <= 160 && (a.answer === null || typeof a.answer === 'string') &&
          [0, 10, 15, 30, 60, 85, 100].includes(a.points))) &&
      Number.isFinite(s.now) && Number.isFinite(s.deadline) &&
      (s.reconnectUntil === null || Number.isFinite(s.reconnectUntil)) &&
      [null, 0, 1].includes(s.winner) && typeof s.connected === 'boolean' && typeof s.reason === 'string';
  }

  dispose(notify = true): void {
    if (!this.alive) return;
    if (notify) this.send(this.seat === 0 ? { type: 'ended' } : { type: 'leave', matchId: this.state?.matchId, round: this.state?.round });
    this.alive = false;
    this.finishHint(false);
    this.accepted = false;
    if (this.stage !== 'failed') this.stage = 'closed';
    clearInterval(this.interval);
    this.lastIce = this.conn?.peerConnection?.iceConnectionState ?? this.lastIce;
    this.lastConnection = this.conn?.peerConnection?.connectionState ?? this.lastConnection;
    for (const connection of this.pendingHost.keys()) connection.close();
    this.pendingHost.clear();
    this.conn?.close();
    this.peer?.destroy();
  }
}
