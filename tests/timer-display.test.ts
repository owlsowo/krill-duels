import { describe, expect, it } from 'vitest';
import { clockMarkup, duelRemaining, duelTimer, questionTimer, timerMarkup } from '../src/timer-display';
import { DEFAULT_SETTINGS, GRACE_MS, type DuelState } from '../src/duel-engine';

const state = (overrides: Partial<DuelState> = {}) => ({
  phase: 'question' as const, deadline: 25_000, connected: true, reconnectUntil: null,
  settings: DEFAULT_SETTINGS, ...overrides,
});

describe('answer timer rendering', () => {
  it('seeds recreated clock and bar with elapsed time before any paint or focus', () => {
    for (const [now, seconds, percent] of [[10_000, 15, 60], [12_500, 13, 50]]) {
      const duel = duelTimer(state(), now, 0);
      const solo = questionTimer('question', 25_000, 25, now);
      expect(duel).toEqual(solo);
      expect(clockMarkup(duel)).toContain(`id="seconds">${seconds}</span>`);
      expect(timerMarkup(duel)).toContain(`id="timer-fill" style="width:${percent}%"`);
      expect(timerMarkup(solo)).not.toContain('width:100%');
    }
  });

  it('never uses the new reveal deadline to refill the answer bar', () => {
    const reveal = state({ phase: 'reveal', deadline: 26_000 });
    expect(duelRemaining(reveal, 20_000, 0)).toBe(6_000);
    for (const now of [20_000, 22_000, 25_999]) {
      const timer = duelTimer(reveal, now, 0);
      expect(timer).toEqual({ seconds: 0, percent: 0 });
      expect(timerMarkup(timer)).toContain('style="width:0%"');
      expect(clockMarkup(timer)).toContain('id="seconds">0</span>');
    }
    expect(questionTimer('result', 25_000, 25, 20_000)).toEqual({ seconds: 0, percent: 0 });
  });

  it('uses server time and freezes the same remaining time across disconnected rerenders', () => {
    const before = duelTimer(state(), 11_000, 1_000);
    const paused = state({ connected: false, reconnectUntil: 10_000 + GRACE_MS });
    expect(before).toEqual({ seconds: 15, percent: 60 });
    expect(duelTimer(paused, 11_000, 1_000)).toEqual(before);
    expect(duelTimer(paused, 29_000, 1_000)).toEqual(before);
    const resumed = state({ deadline: 43_000 });
    expect(duelTimer(resumed, 29_000, 1_000)).toEqual(before);
    expect(duelTimer(resumed, 34_000, 1_000)).toEqual({ seconds: 10, percent: 40 });
  });

  it('clamps expiry and clock corrections but gives the next question its full timer', () => {
    expect(questionTimer('question', 25_000, 25, 25_001)).toEqual({ seconds: 0, percent: 0 });
    expect(questionTimer('question', 25_000, 25, -1_000)).toEqual({ seconds: 25, percent: 100 });
    expect(questionTimer('question', 55_000, 25, 30_000)).toEqual({ seconds: 25, percent: 100 });
    expect(duelRemaining(state({ phase: 'countdown', deadline: 3_000 }), 1_000, 0)).toBe(2_000);
  });
});
