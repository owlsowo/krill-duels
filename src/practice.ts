import { PROMPT_IDS } from './data';
import { scoreAnswer } from './duel-engine';
import { shuffled } from './schedule';
import { TIME_OPTIONS } from './settings';
import type { RoundResult } from './types';
export interface PracticeState {
  phase: 'question' | 'result' | 'finished';
  round: number;
  promptId: string;
  questionSeconds: number;
  deadline: number;
  total: number;
  history: RoundResult[];
  questionCount: number;
}
/** Local single-player session. Never opens a network room. */
export class PracticeSession {
  private state: PracticeState;
  private order: string[];
  constructor(questionSeconds = 25, now = Date.now(), pool = PROMPT_IDS) {
    if (!(TIME_OPTIONS as readonly number[]).includes(questionSeconds)) throw new Error('Unsupported timer.');
    if (!pool.length) throw new Error('No practice questions available.');
    this.order = shuffled([...new Set(pool)]);
    this.state = { phase:'question', round:1, promptId:this.order[0], questionSeconds, deadline:now+questionSeconds*1000, total:0, history:[], questionCount:this.order.length };
  }
  snapshot(): PracticeState { return structuredClone(this.state); }
  submit(input: string, now = Date.now()): boolean {
    if (this.state.phase !== 'question') return false;
    if (now >= this.state.deadline) { this.finishRound(''); return false; }
    this.finishRound(input.trim().slice(0,160)); return true;
  }
  tick(now = Date.now()): boolean {
    if (this.state.phase !== 'question' || now < this.state.deadline) return false;
    this.finishRound(''); return true;
  }
  next(now = Date.now()): boolean {
    if (this.state.phase !== 'result') return false;
    this.state.round++;
    this.state.promptId = this.order[this.state.round-1];
    this.state.phase = 'question';
    this.state.deadline = now + this.state.questionSeconds*1000;
    return true;
  }
  private finishRound(input: string): void {
    const result = scoreAnswer(this.state.promptId,input);
    this.state.history.push(result);
    this.state.total += result.points;
    this.state.phase = this.state.round === this.order.length ? 'finished' : 'result';
    this.state.deadline = 0;
  }
}
