import Peer, { type DataConnection } from 'peerjs';
import { catalogVersion, promptById, PROMPT_IDS } from './data';
import { commitment, DuelEngine, GRACE_MS, type DuelState, type Seat, safeName } from './duel-engine';
import { DEFAULT_SETTINGS, validSettings, type DuelSettings } from './settings';

type Draft = { matchId: string; round: number; promptId: string; input: string; salt: string; hash: string };
type Callbacks = { change: (state: DuelState) => void; status: (message: string) => void; error: (message: string) => void };
type Packet = Record<string, unknown>;
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
  private interval = 0;
  private draft: Draft | null = null;
  private revealing = false;
  private sending = false;
  private hostRevealedKey = '';

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

  async open(): Promise<void> {
    this.callbacks.status(this.seat === 0 ? 'Opening your room…' : 'Joining your friend…');
    this.version = `krill-duels-2:${await catalogVersion()}`;
    if (!this.alive) return;
    this.peer = this.seat === 0 ? new Peer(`kd-${this.room}`) : new Peer();
    this.peer.on('open', () => {
      if (!this.alive) return;
      this.callbacks.status(this.seat === 0 ? 'Room open. Send your invite link.' : 'Connecting to your friend…');
      if (this.seat === 1 && !this.accepted) this.connect();
      else this.publish();
    });
    this.peer.on('connection', connection => {
      if (!this.alive || this.seat !== 0) { connection.close(); return; }
      this.wireHost(connection);
    });
    this.peer.on('disconnected', () => {
      if (this.alive && this.peer && !this.peer.destroyed) this.peer.reconnect();
    });
    this.peer.on('error', error => {
      if (!this.alive) return;
      if (error.type === 'peer-unavailable' && this.seat === 1) {
        if (!this.conn?.open || !this.accepted) this.startReconnect();
        return;
      }
      if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(error.type)) {
        this.callbacks.status('Connection interrupted. Reconnecting…');
        if (!this.conn?.open || !this.accepted) this.startReconnect();
        return;
      }
      this.callbacks.error(error.type === 'browser-incompatible'
        ? 'This browser cannot connect live rooms. Try a recent Chrome, Safari, Firefox, or Edge browser.'
        : 'The room could not connect. Try again, or try a different network.');
    });
    this.interval = window.setInterval(() => this.tick(), 250);
    this.reconnectStarted = Date.now();
  }

  private connect(): void {
    if (!this.peer || this.peer.disconnected || this.peer.destroyed || !this.alive) return;
    this.retryAttempts++;
    this.nextRetry = Date.now() + 2_000;
    // Binary serialization chunks long match histories; PeerJS JSON is limited to 16 KB.
    const connection = this.peer.connect(`kd-${this.room}`, { reliable: true, serialization: 'binary' });
    const previous = this.conn;
    this.conn = connection;
    previous?.close();
    this.accepted = false;
    connection.on('open', () => {
      if (this.conn !== connection || !this.alive) return;
      connection.send({ type: 'hello', version: this.version, name: this.name, token: this.token });
      this.lastSeen = Date.now();
    });
    connection.on('data', value => {
      if (this.conn !== connection || !this.alive) return;
      const packet = this.packet(value);
      if (!packet) return;
      this.lastSeen = Date.now();
      if (packet.type === 'reject') {
        this.callbacks.error(typeof packet.reason === 'string' ? packet.reason : 'The room is unavailable.');
        this.dispose(false);
      } else if (packet.type === 'state' && packet.version === this.version && this.validSnapshot(packet.state)) {
        this.accepted = true;
        this.reconnectStarted = null;
        this.callbacks.status('Connected');
        this.receive(packet.state as DuelState);
      } else if (packet.type === 'pong' && typeof packet.sent === 'number' && typeof packet.now === 'number') {
        const arrived = Date.now();
        const rtt = arrived - packet.sent;
        if (Number.isFinite(packet.now) && rtt >= 0 && rtt < 8_000) {
          this.clockSamples.push({ rtt, offset: (packet.sent + arrived) / 2 - packet.now });
          this.clockSamples = this.clockSamples.slice(-12);
          this.hostClockOffset = this.clockSamples.reduce((best, sample) => sample.rtt < best.rtt ? sample : best).offset;
        }
      } else if (packet.type === 'ended') {
        this.callbacks.error('The host closed this room. Ask your friend for a new invite.');
        this.dispose(false);
      }
    });
    connection.on('close', () => { if (this.conn === connection && this.alive) this.startReconnect(); });
    connection.on('error', () => { if (this.conn === connection && this.alive) this.startReconnect(); });
  }

  private wireHost(connection: DataConnection): void {
    let authenticated = false;
    const timeout = window.setTimeout(() => { if (!authenticated) connection.close(); }, 6_000);
    connection.on('data', value => {
      if (!this.alive) return;
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
        clearTimeout(timeout);
        const previous = this.conn;
        this.conn = connection;
        previous?.close();
        this.guestToken = packet.token;
        this.accepted = true;
        this.lastSeen = Date.now();
        this.reconnectStarted = null;
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
      clearTimeout(timeout);
      if (this.conn !== connection || !this.alive || !authenticated) return;
      this.accepted = false;
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

  private receive(state: DuelState): void {
    if (!this.alive) return;
    this.hostClockOffset ??= Date.now() - state.now;
    const previous = this.state;
    if (previous && previous.matchId === state.matchId && JSON.stringify(previous.settings) !== JSON.stringify(state.settings)) {
      this.callbacks.error('Room settings changed during the match. Create a new duel.');
      this.dispose(false); return;
    }
    // Pin commitments; a changed hash after locking is a protocol error.
    if (previous && previous.matchId === state.matchId && previous.round === state.round) {
      for (const seat of [0, 1] as const) {
        if (previous.hashes[seat] && previous.hashes[seat] !== state.hashes[seat]) {
          this.callbacks.error('The room sent conflicting answers. Create a new duel.');
          this.dispose(false); return;
        }
      }
    }
    this.state = state;
    if (this.draft && (this.draft.matchId !== state.matchId || this.draft.round !== state.round || ['result', 'finished'].includes(state.phase))) {
      this.draft = null;
      storageRemove(`kd-answer-${this.room}`);
    }
    this.callbacks.change(state);
    const draft = this.draft;
    if (draft && state.phase === 'question' && !state.committed[this.seat]) {
      // Restore a sent commitment after a brief guest reconnect.
      if (!this.engine) this.send({ type: 'commit', matchId: draft.matchId, round: draft.round, hash: draft.hash });
    }
    const revealKey = draft ? `${draft.matchId}:${draft.round}` : '';
    if (draft && state.phase === 'reveal' && state.hashes[this.seat] === draft.hash && !this.revealing && (!this.engine || this.hostRevealedKey !== revealKey)) {
      this.revealing = true;
      if (this.engine) {
        this.hostRevealedKey = revealKey;
        void this.engine.reveal(0, draft.matchId, draft.round, draft.input, draft.salt, Date.now()).then(accepted => { this.revealing = false; if (accepted) this.publish(); });
      } else {
        this.send({ type: 'reveal', matchId: draft.matchId, round: draft.round, input: draft.input, salt: draft.salt });
        this.revealing = false;
      }
    }
  }

  private publish(): void {
    if (!this.engine || !this.alive) return;
    const state = this.engine.snapshot(Date.now());
    this.send({ type: 'state', version: this.version, state });
    this.receive(state);
  }

  private startReconnect(): void {
    const wasAccepted = this.accepted;
    this.accepted = false;
    this.reconnectStarted ??= Date.now();
    this.callbacks.status('Connection interrupted. Reconnecting…');
    if (this.engine) this.engine.connection(false, Date.now());
    else if (wasAccepted) {
      if (this.state && this.state.phase !== 'finished') {
        const now = Date.now() - (this.hostClockOffset ?? 0);
        this.state = { ...this.state, connected:false, reconnectUntil:now + GRACE_MS, now };
        this.callbacks.change(this.state);
      }
      this.conn?.close();
    }
  }

  private tick(): void {
    if (!this.alive) return;
    const now = Date.now();
    if (this.engine) {
      this.engine.tick(now);
      if (this.accepted && now - this.lastSeen > 8_000) {
        this.accepted = false;
        this.engine.connection(false, now);
        this.conn?.close();
      }
      if (now - this.lastBroadcast >= 500) { this.lastBroadcast = now; this.publish(); }
      if (this.reconnectStarted && !this.peer?.open && now - this.reconnectStarted > 25_000) {
        this.callbacks.error('Could not reach the room service. Try again, or use a different network.'); this.dispose(false);
      }
    } else {
      if (this.accepted && now - this.lastSeen > 6_000) this.startReconnect();
      if (this.accepted) this.send({ type: 'ping', sent: now });
      if (this.reconnectStarted) {
        const elapsed = now - this.reconnectStarted;
        if (elapsed > (this.state ? GRACE_MS + 8_000 : 25_000)) {
          this.callbacks.error(this.state ? 'The host is no longer reachable. Ask for a new invite.' : 'Could not join. The host must keep the room open; some school, office, or VPN networks block direct connections. Try another network.');
          this.dispose(false);
        } else if (now >= this.nextRetry && this.peer?.open && (!this.conn?.open || this.retryAttempts > 1)) this.connect();
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
    clearInterval(this.interval);
    this.conn?.close();
    this.peer?.destroy();
  }
}
