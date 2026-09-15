import { describe, expect, it } from 'vitest';
import { PROMPTS } from '../src/data';
import { AnswerIndex, normalize } from '../src/match';

describe('published archive integrity', () => {
  it('contains unique complete questions with accepted scored canonical answers', () => {
    expect(new Set(PROMPTS.map(p => p.id)).size).toBe(PROMPTS.length);
    expect(new Set(PROMPTS.map(p => normalize(p.prompt))).size).toBe(PROMPTS.length);
    const scores = new Set<number>();
    for (const prompt of PROMPTS) {
      expect(prompt.source).toMatch(/^https:\/\/krillionanswers.com\/questions\//);
      expect(prompt.answers.length).toBeGreaterThan(0);
      const index = new AnswerIndex(prompt);
      expect(index.match('')).toBeNull(); expect(index.match('   ')).toBeNull();
      for (const answer of prompt.answers) {
        expect(index.match(answer.answer)).toEqual(answer);
        expect(index.match(`  ${answer.answer.toUpperCase()}  `)).toEqual(answer);
        expect([10,15,30,60,85,100]).toContain(answer.score);
        scores.add(answer.score);
      }
    }
    expect([...scores].sort((a,b) => a-b)).toEqual([10,15,30,60,85,100]);
  });
});
