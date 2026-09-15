import { GRACE_MS, type DuelState } from './duel-engine';

export interface TimerDisplay { seconds: number; percent: number }

/** The answer clock never borrows the separate reveal deadline. */
export function questionTimer(phase: string, deadline: number, questionSeconds: number, reference: number): TimerDisplay {
  const duration = questionSeconds * 1000;
  const remaining = phase === 'question' ? Math.min(duration, Math.max(0, deadline - reference)) : 0;
  return { seconds: Math.ceil(remaining / 1000), percent: duration > 0 ? remaining / duration * 100 : 0 };
}

type ClockState = Pick<DuelState, 'phase' | 'deadline' | 'connected' | 'reconnectUntil' | 'settings'>;

export function duelRemaining(state: ClockState, localNow: number, offset: number): number {
  const reference = !state.connected && state.reconnectUntil !== null
    ? state.reconnectUntil - GRACE_MS : localNow - offset;
  return Math.max(0, state.deadline - reference);
}

export function duelTimer(state: ClockState, localNow: number, offset: number): TimerDisplay {
  return questionTimer(state.phase, duelRemaining(state, localNow, offset), state.settings.questionSeconds, 0);
}

export function clockMarkup(timer: TimerDisplay): string {
  return `<div class="clock"><span id="seconds">${timer.seconds}</span><small>SEC</small></div>`;
}

/** Seed width before insertion/focus can trigger layout; later ticks animate from here. */
export function timerMarkup(timer: TimerDisplay): string {
  return `<div class="timer-track" aria-hidden="true"><div id="timer-fill" style="width:${timer.percent}%"></div></div>`;
}
