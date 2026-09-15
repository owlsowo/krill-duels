import { PROMPT_IDS, promptById } from './data';
import { AnswerIndex } from './match';
import { shuffled } from './schedule';
import type { RoundResult } from './types';
import { DEFAULT_SETTINGS, settingsCopy, type DuelSettings } from './settings';
export { DEFAULT_SETTINGS, validSettings, type DuelSettings } from './settings';

export type Seat = 0 | 1;
export type Phase = 'lobby' | 'countdown' | 'question' | 'reveal' | 'result' | 'finished';
export const HP = 300;
export const QUESTION_MS = 25_000;
export const GRACE_MS = 30_000;
export const multiplier = (round: number): number => round >= 8 ? 3 : round >= 5 ? 2 : 1;

export interface DuelRound {
  round: number;
  promptId: string;
  results: [RoundResult, RoundResult];
  damage: number;
  loser: Seat | null;
  multiplier: number;
}

export interface DuelState {
  settings: DuelSettings;
  matchId: string;
  phase: Phase;
  round: number;
  promptId: string | null;
  names: [string, string];
  hp: [number, number];
  ready: [boolean, boolean];
  committed: [boolean, boolean];
  hashes: [string | null, string | null];
  connected: boolean;
  reconnectUntil: number | null;
  deadline: number;
  now: number;
  history: DuelRound[];
  winner: Seat | null;
  reason: string;
}

export const safeName = (value: string): string => value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24) || 'Player';

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
  private hashes: [string | null, string | null] = [null, null];
  private answers: [string | null, string | null] = [null, null];
  private pausedAt: number | null = null;
  private pool: string[];

  constructor(hostName: string, matchId: string = crypto.randomUUID(), pool = PROMPT_IDS, settings: DuelSettings = DEFAULT_SETTINGS) {
    if (!pool.length) throw new Error('The question catalog is empty.');
    this.pool = [...new Set(pool)];
    this.order = shuffled(this.pool);
    this.state = {
      settings: settingsCopy(settings),
      matchId, phase: 'lobby', round: 0, promptId: null,
      names: [safeName(hostName), 'Waiting for friend'], hp: [settings.startingHp, settings.startingHp],
      ready: [false, false], committed: [false, false], hashes: [null, null], connected: false,
      reconnectUntil: null, deadline: 0, now: 0, history: [], winner: null, reason: '',
    };
  }

  snapshot(now: number): DuelState {
    return structuredClone({ ...this.state, hashes: this.hashes, now });
  }

  join(name: string, now: number): void {
    this.tick(now);
    this.state.names[1] = safeName(name);
    this.connection(true, now);
  }

  connection(connected: boolean, now: number): void {
    if (connected === this.state.connected) return;
    this.state.connected = connected;
    if (!connected && this.state.phase !== 'finished') {
      this.pausedAt = now;
      this.state.reconnectUntil = now + GRACE_MS;
    } else if (connected && this.pausedAt !== null) {
      if (this.state.deadline) this.state.deadline += now - this.pausedAt;
      this.pausedAt = null;
      this.state.reconnectUntil = null;
    }
  }

  ready(seat: Seat, now: number): void {
    if (!this.state.connected || !['lobby', 'result', 'finished'].includes(this.state.phase)) return;
    this.state.ready[seat] = true;
    if (!this.state.ready.every(Boolean)) return;
    if (this.state.phase === 'finished') {
      const next = new DuelEngine(this.state.names[0], crypto.randomUUID(), this.pool, this.state.settings);
      next.join(this.state.names[1], now);
      this.state = next.state;
      this.order = next.order;
    }
    this.state.round += 1;
    this.state.promptId = null;
    this.state.ready = [false, false];
    this.state.committed = [false, false];
    this.hashes = [null, null];
    this.answers = [null, null];
    this.state.phase = 'countdown';
    this.state.deadline = now + 3_000;
  }

  commit(seat: Seat, matchId: string, round: number, hash: string, now: number): boolean {
    if (this.state.phase !== 'question' || !this.state.connected || now >= this.state.deadline ||
        matchId !== this.state.matchId || round !== this.state.round ||
        this.hashes[seat] !== null || !/^[a-f0-9]{64}$/.test(hash)) return false;
    this.hashes[seat] = hash;
    this.state.committed[seat] = true;
    if (this.state.committed.every(Boolean)) this.beginReveal(now);
    return true;
  }

  async reveal(seat: Seat, matchId: string, round: number, input: string, salt: string, now: number): Promise<boolean> {
    if (this.state.phase !== 'reveal' || !this.state.connected || matchId !== this.state.matchId || round !== this.state.round ||
        this.answers[seat] !== null || input.length > 160 || salt.length > 100 || now >= this.state.deadline) return false;
    const hash = await commitment(matchId, round, seat, this.state.promptId!, input, salt);
    // Re-check after digest: the host may have paused, timed out, or advanced meanwhile.
    if (this.state.phase !== 'reveal' || !this.state.connected || this.state.matchId !== matchId || this.state.round !== round || this.answers[seat] !== null) return false;
    if (hash !== this.hashes[seat]) return false;
    this.answers[seat] = input;
    if (this.answers.every(answer => answer !== null)) this.resolve();
    return true;
  }

  tick(now: number): void {
    if (this.state.phase === 'finished') return;
    if (this.pausedAt !== null) {
      if (now >= this.state.reconnectUntil!) this.forfeit(1, 'Friend disconnected for 30 seconds.');
      return;
    }
    if (now < this.state.deadline) return;
    if (this.state.phase === 'countdown') {
      this.state.phase = 'question';
      this.state.promptId = this.order[this.state.round - 1];
      this.state.deadline = now + this.state.settings.questionSeconds * 1000;
    } else if (this.state.phase === 'question') this.beginReveal(now);
    else if (this.state.phase === 'reveal') this.resolve();
  }

  forfeit(seat: Seat, reason = 'Opponent left the duel.'): void {
    if (this.state.phase === 'finished') return;
    this.state.winner = seat === 0 ? 1 : 0;
    this.state.reason = reason;
    this.state.phase = 'finished';
    this.state.ready = [false, false];
    this.state.deadline = 0;
    this.state.reconnectUntil = null;
    this.pausedAt = null;
  }

  private beginReveal(now: number): void {
    this.state.phase = 'reveal';
    this.state.deadline = now + 6_000;
    for (const seat of [0, 1] as const) if (!this.hashes[seat]) this.answers[seat] = '';
    if (this.answers.every(answer => answer !== null)) this.resolve();
  }

  private resolve(): void {
    const results = ([0, 1] as const).map(seat => scoreAnswer(this.state.promptId!, this.answers[seat] ?? '')) as [RoundResult, RoundResult];
    const difference = results[0].points - results[1].points;
    const loser: Seat | null = difference > 0 ? 1 : difference < 0 ? 0 : null;
    const factor = this.state.settings.damageScaling ? multiplier(this.state.round) : 1;
    const damage = Math.abs(difference) * factor;
    if (loser !== null) this.state.hp[loser] = Math.max(0, this.state.hp[loser] - damage);
    this.state.history.push({ round: this.state.round, promptId: this.state.promptId!, results, damage, loser, multiplier: factor });
    this.state.phase = 'result';
    this.state.deadline = 0;
    this.state.ready = [false, false];
    if (this.state.hp.includes(0) || this.state.round >= this.order.length) {
      const diff = this.state.hp[0] - this.state.hp[1];
      this.state.winner = this.state.hp.includes(0) ? (diff > 0 ? 0 : 1) : null;
      this.state.reason = this.state.hp.includes(0) ? 'Knockout!' : 'Every question played without a knockout. It’s a draw.';
      this.state.phase = 'finished';
    }
  }
}
