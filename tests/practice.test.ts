import { describe, expect, it } from 'vitest';
import { PracticeSession } from '../src/practice';
import { PROMPTS, promptById } from '../src/data';

describe('solo practice', () => {
  it('scores immediately, reveals only completed answers, and ignores duplicate submissions', () => {
    const game = new PracticeSession(45,1000,[PROMPTS[0].id,PROMPTS[1].id]);
    const state = game.snapshot();
    const answer = promptById(state.promptId)!.answers[0];
    expect(state.deadline).toBe(46_000);
    expect(state.history).toEqual([]);
    expect(game.submit(answer.answer,1200)).toBe(true);
    expect(game.snapshot().phase).toBe('result');
    expect(game.snapshot().total).toBe(answer.score);
    expect(game.submit(answer.answer,1300)).toBe(false);
    expect(game.snapshot().history).toHaveLength(1);
  });
  it('keeps questions unique and finishes after the whole supplied bank', () => {
    const pool = PROMPTS.slice(0,20).map(p=>p.id);
    const game = new PracticeSession(15,0,[...pool,pool[0]]);
    const seen = new Set<string>();
    for (let i=0;i<20;i++) {
      const state = game.snapshot();
      expect(seen.has(state.promptId)).toBe(false); seen.add(state.promptId);
      const answer = promptById(state.promptId)!.answers[0];
      expect(game.submit(answer.answer,i*20_000+1)).toBe(true);
      expect(game.next((i+1)*20_000)).toBe(i<19);
    }
    expect(game.snapshot().phase).toBe('finished');
    expect(game.snapshot().history).toHaveLength(20);
    expect(game.snapshot().total).toBeGreaterThan(0);
  });
  it('makes timeouts and skips zero points without adding repeated results', () => {
    const game = new PracticeSession(25,0,PROMPTS.slice(0,3).map(p=>p.id));
    expect(game.tick(24999)).toBe(false);
    expect(game.submit('too late',25000)).toBe(false);
    expect(game.tick(30000)).toBe(false);
    expect(game.snapshot().history).toHaveLength(1);
    expect(game.snapshot().total).toBe(0);
    expect(game.next(40000)).toBe(true);
    expect(game.submit('',41000)).toBe(true);
    expect(game.snapshot().total).toBe(0);
  });
});
