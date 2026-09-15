import { catalogVersion } from './data';
import { safeName, type DuelState, type Seat } from './duel-engine';
import { DEFAULT_SETTINGS, type DuelSettings } from './settings';

type Callbacks = { change: (state: DuelState) => void; status: (message: string) => void; error: (message: string) => void };
type Command = { action: 'create' | 'join' | 'poll' | 'ready' | 'answer' | 'hint' | 'leave'; [key: string]: unknown };
interface Reply { protocol: number; revision: number; state: DuelState; accepted: boolean }
export const roomFromHash = (): string | null => {
  const id = new URLSearchParams(location.hash.slice(1)).get('room');
  return id && /^[a-f0-9]{24}$/.test(id) ? id : null;
};
const read = (key: string): string | null => { try { return sessionStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string): void => { try { sessionStorage.setItem(key, value); } catch { /* Optional session recovery. */ } };
class RoomError extends Error { constructor(message: string, readonly code: string, readonly permanent: boolean) { super(message); } }

/** Both players use the website's HTTPS API; no browser-to-browser route is required. */
export class DuelRoom {
  readonly room: string;
  readonly seat: Seat;
  state: DuelState | null = null;
  hostClockOffset: number | null = null;
  private token: string;
  private version = '';
  private alive = true;
  private opened = false;
  private stage = 'idle';
  private lastError: string | null = null;
  private attempts = 0;
  private revision = -1;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private controllers = new Set<AbortController>();
  private queue: Promise<unknown> = Promise.resolve();
  private clockSamples: { rtt: number; offset: number }[] = [];
  private failureSince: number | null = null;
  private readyPending = false;
  private answerPending = false;
  private hintPending: Promise<boolean> | null = null;
  private lastStatus = '';
  private now(): number { return Date.now(); }

  constructor(private name: string, room: string | null, private callbacks: Callbacks, private settings: DuelSettings = DEFAULT_SETTINGS) {
    this.name = safeName(name);
    this.room = room ?? crypto.randomUUID().replaceAll('-', '').slice(0, 24);
    this.seat = room && read(`kd-https-host-${room}`) !== '1' ? 1 : 0;
    this.token = read(`kd-https-token-${this.room}`) || crypto.randomUUID().replaceAll('-', '');
    write(`kd-https-token-${this.room}`, this.token);
    if (this.seat === 0) write(`kd-https-host-${this.room}`, '1');
  }
  get invite(): string { return `${location.origin}${location.pathname}#room=${this.room}`; }
  diagnostics(): object {
    return { app: 'krill-duels', protocol: 4, transport: 'https', role: this.seat === 0 ? 'host' : 'guest',
      stage: this.stage, attempts: this.attempts, accepted: this.opened,
      connection: this.stage === 'connected' ? 'connected' : this.stage, lastError: this.lastError };
  }
  private status(value: string): void {
    if (value !== this.lastStatus) { this.lastStatus = value; this.callbacks.status(value); }
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => undefined);
    return next;
  }
  async open(): Promise<void> {
    if (!this.alive || this.version) return;
    this.stage = 'connecting';
    this.version = `krill-https-4:${await catalogVersion()}`;
    if (!this.alive) return;
    await this.enqueue(() => this.exchange({ action: this.seat === 0 ? 'create' : 'join', name: this.name, settings: this.settings }));
    this.schedule();
  }
  private schedule(): void {
    if (!this.alive) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.enqueue(() => this.exchange({ action: this.opened ? 'poll' : this.seat === 0 ? 'create' : 'join', name: this.name, settings: this.settings }))
        .finally(() => this.schedule());
    }, this.failureSince !== null ? 1500 : 750);
  }
  private accept(reply: Reply, start: number, end: number): void {
    if (!this.alive || reply.revision <= this.revision) return;
    if (reply.protocol !== 4 || !Number.isSafeInteger(reply.revision) || !reply.state || !Number.isFinite(reply.state.now)) {
      throw new RoomError('The room returned an unexpected response. Both refresh and try again.', 'invalid-response', true);
    }
    this.revision = reply.revision;
    this.clockSamples.push({ rtt: end - start, offset: (start + end) / 2 - reply.state.now });
    this.clockSamples = this.clockSamples.slice(-8);
    this.hostClockOffset = this.clockSamples.reduce((best, sample) => sample.rtt < best.rtt ? sample : best).offset;
    this.state = reply.state;
    this.stage = 'connected'; this.opened = true; this.failureSince = null; this.lastError = null;
    this.callbacks.change(reply.state);
    this.status(reply.state.connected ? 'Connected to your friend.' : reply.state.phase === 'lobby' ? 'Room open. Send the invite to your friend.' : reply.state.phase === 'finished' ? 'Duel complete.' : 'Connection interrupted. Waiting for both players to reconnect…');
  }
  private async request(c: Command): Promise<{ reply: Reply; start: number; end: number }> {
    if (!this.alive) throw new RoomError('Room closed.', 'closed', true);
    const controller = new AbortController(); this.controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 6000);
    const start = this.now(); this.attempts++;
    try {
      const response = await fetch('/api/duel', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
        body: JSON.stringify({ ...c, room: this.room, seat: this.seat, version: this.version }), cache: 'no-store', signal: controller.signal });
      let data: Reply & { error?: string; code?: string };
      try { data = await response.json(); } catch { throw new RoomError('The room service did not respond. Trying again…', 'invalid-response', false); }
      if (!response.ok) throw new RoomError(data.error || 'The room could not respond. Trying again…', data.code || `http-${response.status}`, response.status >= 400 && response.status < 500 && response.status !== 429);
      return { reply: data, start, end: this.now() };
    } finally { clearTimeout(timeout); this.controllers.delete(controller); }
  }
  private async exchange(c: Command): Promise<boolean> {
    if (!this.alive) return false;
    try {
      const { reply, start, end } = await this.request(c);
      this.accept(reply, start, end);
      return this.alive && reply.accepted;
    } catch (cause) {
      if (!this.alive) return false;
      const fault = cause instanceof RoomError ? cause : new RoomError('Connection interrupted. Trying to reconnect…', 'request-failed', false);
      this.lastError = fault.code;
      this.failureSince ??= this.now();
      this.stage = 'reconnecting';
      if (fault.permanent || this.now() - this.failureSince >= (this.opened ? 42_000 : 25_000)) {
        this.stage = 'failed';
        this.callbacks.error(fault.permanent ? fault.message : 'Could not reach the room. Keep both tabs open and try reconnecting, or try another network or VPN server.');
        this.dispose(false);
      } else {
        if (this.state?.connected) { this.state = { ...this.state, connected: false }; this.callbacks.change(this.state); }
        this.status(this.opened ? 'Connection interrupted. Trying to reconnect…' : 'Still connecting to the room…');
      }
      return false;
    }
  }
  ready(): void {
    const s = this.state;
    if (!this.alive || !s?.connected || this.readyPending || !['lobby', 'result', 'finished'].includes(s.phase)) return;
    this.readyPending = true;
    void this.enqueue(() => this.exchange({ action: 'ready', matchId: s.matchId, round: s.round, phase: s.phase }))
      .finally(() => { this.readyPending = false; });
  }
  async submit(input: string): Promise<boolean> {
    const s = this.state;
    if (!this.alive || !s?.connected || s.phase !== 'question' || this.answerPending || input.length > 160) return false;
    this.answerPending = true;
    try { return await this.enqueue(() => this.exchange({ action: 'answer', matchId: s.matchId, round: s.round, input })); }
    finally { this.answerPending = false; }
  }
  hint(): Promise<boolean> {
    if (this.hintPending) return this.hintPending;
    const s = this.state;
    if (!this.alive || !s?.connected || s.phase !== 'question' || this.answerPending || s.committed[this.seat] ||
        this.now() - (this.hostClockOffset ?? 0) >= s.deadline) return Promise.resolve(false);
    // Capture the level before joining the request queue. Retrying this command
    // after a lost response can only acknowledge the same purchase.
    const command: Command = { action: 'hint', matchId: s.matchId, round: s.round, expectedHintLevel: s.hintLevels[this.seat] };
    this.hintPending = this.enqueue(() => this.exchange(command)).finally(() => { this.hintPending = null; });
    return this.hintPending;
  }
  dispose(notify = true): void {
    if (!this.alive) return;
    this.alive = false;
    clearTimeout(this.timer);
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    if (notify && this.version) {
      void fetch('/api/duel', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
        body: JSON.stringify({ action: 'leave', room: this.room, seat: this.seat, version: this.version }), keepalive: true }).catch(() => undefined);
    }
  }
}
