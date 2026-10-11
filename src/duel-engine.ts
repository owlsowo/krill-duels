import { PROMPT_IDS, promptById } from './data';
import { AnswerIndex } from './match';
import { shuffled } from './schedule';
import type { RoundResult } from './types';
import { DEFAULT_SETTINGS, settingsCopy, type DuelSettings } from './settings';
import { getPromptHints, hintCost } from './hints';
export { DEFAULT_SETTINGS, validSettings, type DuelSettings } from './settings';

export type Seat = number;
export type Phase = 'lobby' | 'countdown' | 'question' | 'reveal' | 'result' | 'finished';
export const HP = 300;
export const QUESTION_MS = 25_000;
export const GRACE_MS = 30_000;
export const multiplier = (round: number): number => round >= 8 ? 3 : round >= 5 ? 2 : 1;

export interface DuelRound {
  round: number;
  promptId: string;
  results: RoundResult[];
  /** Per-seat damage this round (0 when that seat tied for highest or was already out). */
  damages: number[];
  /** Convenience for 1v1 UI/tests: sole seat that took damage, else null. */
  loser: Seat | null;
  /** Convenience: damage taken by `loser`, or 0. */
  damage: number;
  multiplier: number;
}

export interface DuelState {
  settings: DuelSettings;
  matchId: string;
  phase: Phase;
  round: number;
  promptId: string | null;
  names: string[];
  hp: number[];
  /** True once a player has claimed this seat. Seat 0 starts joined. */
  joined: boolean[];
  /** Live presence per seat. */
  online: boolean[];
  hintUses: number[];
  hintLevels: number[];
  ready: boolean[];
  committed: boolean[];
  hashes: (string | null)[];
  /** True when every seat is filled and every joined seat is online. */
  connected: boolean;
  reconnectUntil: number | null;
  deadline: number;
  now: number;
  history: DuelRound[];
  winner: Seat | null;
  reason: string;
}

/** Private server storage. Never send this object in a room response. */
export interface StoredEngine {
  schema: 2;
  state: DuelState;
  order: string[];
  pool: string[];
  /** Absent in rooms saved before session-wide question rotation. */
  nextPromptIndex?: number;
  hashes: (string | null)[];
  answers: (string | null)[];
  pausedAt: number | null;
}

export const safeName = (value: string): string => value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24) || 'Player';

const waitingLabel = (count: number): string => count === 2 ? 'Waiting for friend' : 'Waiting for player';

function seatsOf(count: number): number[] {
  return Array.from({ length: count }, (_, seat) => seat);
}

function filled<T>(count: number, value: T): T[] {
  return Array.from({ length: count }, () => value);
}

export async function commitment(matchId: string, round: number, seat: Seat, promptId: string, input: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(['krill-duels-v1', matchId, round, seat, promptId, input, salt]));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export function scoreAnswer(promptId: string, input: string): RoundResult {
  const prompt = promptById(promptId);
  const answer = prompt ? new AnswerIndex(prompt).match(input) : null;
  return { promptId, input, answer: answer?.answer ?? null, points: answer?.score ?? 0 };
}

/** Host-owned state; unexposed commitments/answers never appear in snapshots. */
export class DuelEngine {
  private state: DuelState;
  private order: string[];
  private nextPromptIndex = 0;
  private hashes: (string | null)[] = [];
  private answers: (string | null)[] = [];
  private pausedAt: number | null = null;
  private pool: string[];

  constructor(hostName: string, matchId: string = crypto.randomUUID(), pool = PROMPT_IDS, settings: DuelSettings = DEFAULT_SETTINGS) {
    if (!pool.length) throw new Error('The question catalog is empty.');
    this.pool = [...new Set(pool)];
    this.order = shuffled(this.pool);
    const n = settings.playerCount;
    this.hashes = filled(n, null);
    this.answers = filled(n, null);
    this.state = {
      settings: settingsCopy(settings),
      matchId, phase: 'lobby', round: 0, promptId: null,
      names: seatsOf(n).map(seat => seat === 0 ? safeName(hostName) : waitingLabel(n)),
      hp: filled(n, settings.startingHp),
      joined: seatsOf(n).map(seat => seat === 0),
      online: seatsOf(n).map(seat => seat === 0),
      hintUses: filled(n, 0), hintLevels: filled(n, 0),
      ready: filled(n, false), committed: filled(n, false), hashes: filled(n, null),
      connected: false, reconnectUntil: null, deadline: 0, now: 0, history: [], winner: null, reason: '',
    };
    this.refreshConnected();
  }

  private count(): number { return this.state.settings.playerCount; }
  private seats(): number[] { return seatsOf(this.count()); }
  private validSeat(seat: Seat): boolean {
    return Number.isInteger(seat) && seat >= 0 && seat < this.count();
  }
  private living(): number[] {
    return this.seats().filter(seat => this.state.joined[seat] && this.state.hp[seat] > 0);
  }
  private refreshConnected(): void {
    const full = this.state.joined.every(Boolean);
    const present = this.seats().every(seat => !this.state.joined[seat] || this.state.online[seat]);
    this.state.connected = full && present;
  }

  snapshot(now: number): DuelState {
    return structuredClone({ ...this.state, hashes: this.hashes, now });
  }

  store(now = this.state.now): StoredEngine {
    return structuredClone({ schema: 2, state: { ...this.state, now }, order: this.order, pool: this.pool, nextPromptIndex: this.nextPromptIndex,
      hashes: this.hashes, answers: this.answers, pausedAt: this.pausedAt });
  }

  static restore(saved: StoredEngine | (Omit<StoredEngine, 'schema'> & { schema: 1 })): DuelEngine {
    if (saved.schema !== 1 && saved.schema !== 2) throw new Error('Unsupported room storage version');
    const legacy = saved.schema === 1;
    const state = structuredClone(saved.state) as DuelState;
    if (!state.settings.playerCount) state.settings = { ...state.settings, playerCount: 2 };
    const n = state.settings.playerCount;
    if (legacy || !Array.isArray(state.joined) || !Array.isArray(state.online)) {
      state.joined = seatsOf(n).map(seat => {
        if (seat === 0) return true;
        const name = state.names[seat];
        return typeof name === 'string' && name !== waitingLabel(n) && name !== 'Waiting for friend';
      });
      if (n === 2 && state.phase !== 'lobby') state.joined[1] = true;
      // Schema 1 used a single connected flag for the guest seat.
      state.online = seatsOf(n).map(seat => seat === 0 ? true : seat === 1 ? !!state.connected : !!state.joined[seat]);
    }
    while (state.names.length < n) state.names.push(waitingLabel(n));
    if (!Array.isArray(state.hp)) state.hp = filled(n, state.settings.startingHp);
    if (!Array.isArray(state.hintUses)) state.hintUses = filled(n, 0);
    if (!Array.isArray(state.hintLevels)) state.hintLevels = filled(n, 0);
    if (!Array.isArray(state.ready)) state.ready = filled(n, false);
    if (!Array.isArray(state.committed)) state.committed = filled(n, false);
    if (!Array.isArray(state.hashes)) state.hashes = filled(n, null);
    if (!Array.isArray(state.joined)) state.joined = seatsOf(n).map(seat => seat === 0);
    if (!Array.isArray(state.online)) state.online = seatsOf(n).map(seat => seat === 0);
    for (const key of ['hp', 'hintUses', 'hintLevels', 'ready', 'committed', 'hashes'] as const) {
      const list = state[key] as unknown[];
      while (list.length < n) list.push(key === 'hp' ? state.settings.startingHp : key === 'hashes' ? null : key === 'ready' || key === 'committed' ? false : 0);
    }
    while (state.joined.length < n) state.joined.push(false);
    while (state.online.length < n) state.online.push(false);
    for (const round of state.history) {
      if (!Array.isArray(round.damages)) {
        round.damages = seatsOf(n).map(seat => seat === round.loser ? round.damage : 0);
      }
      if (!Array.isArray(round.results)) round.results = [];
      while (round.results.length < n) round.results.push({ promptId: round.promptId, input: '', answer: null, points: 0 });
    }
    const engine = new DuelEngine(state.names[0], state.matchId, saved.pool, state.settings);
    engine.state = state;
    engine.state.hintUses ??= filled(n, 0);
    engine.state.hintLevels ??= filled(n, 0);
    engine.refreshConnected();
    engine.order = [...saved.order];
    engine.nextPromptIndex = saved.nextPromptIndex ?? (saved.state.promptId === null
      ? Math.max(0, saved.state.round - 1) : saved.state.round);
    if (!Number.isInteger(engine.nextPromptIndex) || engine.nextPromptIndex < 0 || engine.nextPromptIndex > engine.order.length) {
      throw new Error('Invalid saved question position');
    }
    engine.hashes = [...saved.hashes];
    engine.answers = [...saved.answers];
    while (engine.hashes.length < n) engine.hashes.push(null);
    while (engine.answers.length < n) engine.answers.push(null);
    engine.pausedAt = saved.pausedAt;
    return engine;
  }

  abandon(): void {
    this.state.winner = null;
    this.state.reason = 'Everyone disconnected. Create a new room to play again.';
    this.state.phase = 'finished';
    this.state.ready = filled(this.count(), false);
    this.state.deadline = 0;
    this.state.reconnectUntil = null;
    this.pausedAt = null;
  }

  /** Claim the next open seat, or reattach the first offline seat. Returns seat index, or -1 if full. */
  join(name: string, now: number): number {
    this.tick(now);
    const open = this.seats().find(index => !this.state.joined[index]);
    if (open !== undefined) {
      this.state.names[open] = safeName(name);
      this.state.joined[open] = true;
      this.state.online[open] = true;
      this.refreshConnected();
      if (this.pausedAt !== null && this.state.connected) {
        if (this.state.deadline) this.state.deadline += now - this.pausedAt;
        this.pausedAt = null;
        this.state.reconnectUntil = null;
      }
      return open;
    }
    const offline = this.seats().find(index => this.state.joined[index] && !this.state.online[index]);
    if (offline === undefined) return -1;
    this.rejoin(offline, name, now);
    this.connection(offline, true, now);
    return offline;
  }

  /** Refresh a seated player's name after the room validates their session token. */
  rejoin(seat: Seat, name: string, _now?: number): void {
    if (!this.validSeat(seat) || !this.state.joined[seat]) return;
    this.state.names[seat] = safeName(name);
  }

  /** Mark presence. `connection(online, now)` updates every non-host joined seat (legacy 1v1). */
  connection(connected: boolean, now: number): void;
  connection(seat: Seat, connected: boolean, now: number): void;
  connection(seatOrConnected: Seat | boolean, connectedOrNow: boolean | number, maybeNow?: number): void {
    if (typeof seatOrConnected === 'boolean') {
      const connected = seatOrConnected;
      const now = connectedOrNow as number;
      for (const seat of this.seats()) {
        if (seat !== 0 && this.state.joined[seat]) this.connection(seat, connected, now);
      }
      return;
    }
    const seat = seatOrConnected;
    const connected = connectedOrNow as boolean;
    const now = maybeNow!;
    if (!this.validSeat(seat) || !this.state.joined[seat] || this.state.online[seat] === connected) return;
    this.state.online[seat] = connected;
    this.refreshConnected();
    if (!connected && this.state.phase !== 'finished' && this.state.joined.every(Boolean)) {
      if (this.pausedAt === null) {
        this.pausedAt = now;
        this.state.reconnectUntil = now + GRACE_MS;
      }
    } else if (connected && this.state.connected && this.pausedAt !== null) {
      if (this.state.deadline) this.state.deadline += now - this.pausedAt;
      this.pausedAt = null;
      this.state.reconnectUntil = null;
    }
  }

  ready(seat: Seat, now: number): void {
    if (!this.validSeat(seat) || !this.state.joined[seat] ||
        !['lobby', 'result', 'finished'].includes(this.state.phase)) return;
    // Rematch only needs seated players; in-progress rounds still require a live room.
    if (this.state.phase !== 'finished' && !this.state.connected) return;
    if (this.state.phase !== 'lobby' && this.state.phase !== 'finished' && this.state.hp[seat] <= 0) return;
    this.state.ready[seat] = true;
    const needed = this.state.phase === 'lobby' || this.state.phase === 'finished'
      ? this.seats().filter(index => this.state.joined[index])
      : this.living();
    if (!needed.every(index => this.state.ready[index])) return;
    if (this.state.phase === 'finished') {
      const n = this.count();
      this.state = {
        ...this.state, matchId: crypto.randomUUID(), round: 0, promptId: null,
        hp: filled(n, this.state.settings.startingHp),
        hintUses: filled(n, 0), hintLevels: filled(n, 0),
        history: [], winner: null, reason: '', reconnectUntil: null,
      };
      this.pausedAt = null;
      if (this.nextPromptIndex === this.order.length) {
        this.order = shuffled(this.pool);
        this.nextPromptIndex = 0;
      }
    }
    this.state.round += 1;
    this.state.promptId = null;
    this.state.ready = filled(this.count(), false);
    this.state.committed = filled(this.count(), false);
    this.state.hintLevels = filled(this.count(), 0);
    this.hashes = filled(this.count(), null);
    this.answers = filled(this.count(), null);
    this.state.phase = 'countdown';
    this.state.deadline = now + 3_000;
  }

  hint(seat: Seat, matchId: string, round: number, expectedHintLevel: number, now: number): boolean {
    const s = this.state;
    if (!this.validSeat(seat) || !s.joined[seat] || matchId !== s.matchId || round !== s.round ||
        !Number.isInteger(expectedHintLevel) || expectedHintLevel < 0 || expectedHintLevel >= 3) return false;
    if (expectedHintLevel < s.hintLevels[seat]) return true;
    if (expectedHintLevel !== s.hintLevels[seat] || s.phase !== 'question' || !s.connected ||
        now >= s.deadline || s.committed[seat] || !s.promptId || s.hp[seat] <= 0 ||
        expectedHintLevel >= Math.min(3, getPromptHints(s.promptId).length)) return false;
    const cost = hintCost(s.settings.startingHp, s.hintUses[seat]);
    if (!Number.isSafeInteger(cost) || cost <= 0 || cost >= s.hp[seat]) return false;
    s.hp[seat] -= cost;
    s.hintUses[seat] += 1;
    s.hintLevels[seat] += 1;
    return true;
  }

  commit(seat: Seat, matchId: string, round: number, hash: string, now: number): boolean {
    if (!this.validSeat(seat) || !this.state.joined[seat] || this.state.hp[seat] <= 0 ||
        this.state.phase !== 'question' || !this.state.connected || now >= this.state.deadline ||
        matchId !== this.state.matchId || round !== this.state.round ||
        this.hashes[seat] !== null || !/^[a-f0-9]{64}$/.test(hash)) return false;
    this.hashes[seat] = hash;
    this.state.committed[seat] = true;
    if (this.living().every(index => this.state.committed[index])) this.beginReveal(now);
    return true;
  }

  async reveal(seat: Seat, matchId: string, round: number, input: string, salt: string, now: number): Promise<boolean> {
    if (!this.validSeat(seat) || !this.state.joined[seat] ||
        this.state.phase !== 'reveal' || !this.state.connected || matchId !== this.state.matchId || round !== this.state.round ||
        this.answers[seat] !== null || input.length > 160 || salt.length > 100 || now >= this.state.deadline) return false;
    const hash = await commitment(matchId, round, seat, this.state.promptId!, input, salt);
    if (this.state.phase !== 'reveal' || !this.state.connected || this.state.matchId !== matchId || this.state.round !== round || this.answers[seat] !== null) return false;
    if (hash !== this.hashes[seat]) return false;
    this.answers[seat] = input;
    if (this.living().every(index => this.answers[index] !== null)) this.resolve();
    return true;
  }

  tick(now: number): void {
    if (this.state.phase === 'finished') return;
    if (this.pausedAt !== null) {
      if (now >= this.state.reconnectUntil!) {
        const missing = this.seats().filter(seat => this.state.joined[seat] && !this.state.online[seat]);
        if (missing.length === this.state.joined.filter(Boolean).length) this.abandon();
        else {
          for (const seat of missing) {
            this.eliminate(seat, seat === 1 && this.count() === 2
              ? 'Friend disconnected for 30 seconds.'
              : `${this.state.names[seat]} disconnected for 30 seconds.`);
          }
        }
      }
      return;
    }
    if (now < this.state.deadline) return;
    if (this.state.phase === 'countdown') {
      this.state.phase = 'question';
      this.state.promptId = this.order[this.nextPromptIndex++];
      this.state.deadline = now + this.state.settings.questionSeconds * 1000;
      // Knocked-out seats auto-skip the question phase.
      for (const seat of this.seats()) {
        if (this.state.joined[seat] && this.state.hp[seat] <= 0) {
          this.state.committed[seat] = true;
          this.hashes[seat] = null;
          this.answers[seat] = '';
        }
      }
      if (this.living().length === 0) this.finishFromHp('Knockout!');
      else if (this.living().every(seat => this.state.committed[seat])) this.beginReveal(now);
    } else if (this.state.phase === 'question') this.beginReveal(now);
    else if (this.state.phase === 'reveal') this.resolve();
  }

  forfeit(seat: Seat, reason = 'Opponent left the duel.'): void {
    if (this.state.phase === 'finished' || !this.validSeat(seat)) return;
    if (this.state.phase === 'lobby' && seat !== 0) {
      this.state.joined[seat] = false;
      this.state.online[seat] = false;
      this.state.names[seat] = waitingLabel(this.count());
      this.state.ready[seat] = false;
      this.state.hp[seat] = this.state.settings.startingHp;
      this.refreshConnected();
      return;
    }
    this.eliminate(seat, reason);
  }

  private eliminate(seat: Seat, reason: string): void {
    if (this.state.phase === 'finished') return;
    const others = this.seats().filter(index =>
      index !== seat && this.state.joined[index] && this.state.hp[index] > 0);
    // Classic 1v1 leave/disconnect: end the match without rewriting HP bars.
    if (others.length <= 1) {
      this.state.winner = others.length === 1 ? others[0] : null;
      this.state.reason = reason.includes('disconnect') || reason.includes('Opponent left')
        ? reason
        : others.length === 1
          ? `${this.state.names[seat]} left. ${this.state.names[others[0]]} wins.`
          : reason;
      this.state.phase = 'finished';
      this.state.ready = filled(this.count(), false);
      this.state.deadline = 0;
      this.state.reconnectUntil = null;
      this.pausedAt = null;
      return;
    }
    // Free-for-all: knock the seat out and keep playing.
    this.state.hp[seat] = 0;
    this.state.online[seat] = false;
    this.refreshConnected();
    if (this.pausedAt !== null && this.state.connected) {
      if (this.state.deadline) this.state.deadline += (this.state.now || Date.now()) - this.pausedAt;
      this.pausedAt = null;
      this.state.reconnectUntil = null;
    }
  }

  private beginReveal(now: number): void {
    this.state.phase = 'reveal';
    this.state.deadline = now + 6_000;
    for (const seat of this.seats()) {
      if (!this.state.joined[seat] || this.state.hp[seat] <= 0) {
        this.answers[seat] = this.answers[seat] ?? '';
        continue;
      }
      if (!this.hashes[seat]) this.answers[seat] = '';
    }
    if (this.living().every(seat => this.answers[seat] !== null)) this.resolve();
  }

  private resolve(): void {
    const active = this.living();
    const results = this.seats().map(seat => {
      if (!this.state.joined[seat] || this.state.hp[seat] <= 0) {
        return { promptId: this.state.promptId!, input: '', answer: null, points: 0 };
      }
      return scoreAnswer(this.state.promptId!, this.answers[seat] ?? '');
    });
    const factor = this.state.settings.damageScaling ? multiplier(this.state.round) : 1;
    const best = active.length ? Math.max(...active.map(seat => results[seat].points)) : 0;
    const damages = this.seats().map(seat => {
      if (!active.includes(seat) || results[seat].points >= best) return 0;
      return (best - results[seat].points) * factor;
    });
    for (const seat of this.seats()) {
      if (damages[seat] > 0) this.state.hp[seat] = Math.max(0, this.state.hp[seat] - damages[seat]);
    }
    const hit = this.seats().filter(seat => damages[seat] > 0);
    const loser = hit.length === 1 ? hit[0] : null;
    const damage = loser !== null ? damages[loser] : hit.length ? Math.max(...hit.map(seat => damages[seat])) : 0;
    this.state.history.push({
      round: this.state.round, promptId: this.state.promptId!, results, damages, damage, loser, multiplier: factor,
    });
    this.state.phase = 'result';
    this.state.deadline = 0;
    this.state.ready = filled(this.count(), false);
    const alive = this.living();
    if (alive.length <= 1 || this.nextPromptIndex >= this.order.length) {
      this.finishFromHp(alive.length <= 1 ? 'Knockout!' :
        'Every question in this room has been played. It’s a draw; play again to start a fresh shuffle.');
    }
  }

  private finishFromHp(knockoutReason: string): void {
    const alive = this.living();
    if (alive.length === 1) {
      this.state.winner = alive[0];
      this.state.reason = knockoutReason;
    } else {
      // Catalog exhaustion (or mutual knockouts) is a draw while more than one survivor remains.
      this.state.winner = null;
      this.state.reason = alive.length === 0 && knockoutReason === 'Knockout!'
        ? 'Knockout!'
        : knockoutReason.includes('question') || alive.length > 1
          ? 'Every question in this room has been played. It’s a draw; play again to start a fresh shuffle.'
          : knockoutReason;
    }
    this.state.phase = 'finished';
  }
}
