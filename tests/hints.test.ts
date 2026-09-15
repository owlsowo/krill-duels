import { describe, expect, it } from 'vitest';
import context from '../data/prompt-hints.json';
import { promptById } from '../src/data';
import { normalize } from '../src/match';
import { getPromptHints, hintCost } from '../src/hints';
import { hintMarkup } from '../src/hint-display';

describe('reviewed context hints', () => {
  it('has three distinct, sourced hints for known questions', () => {
    expect(new Set(context.questions.map(q => q.promptId)).size).toBe(context.questions.length);
    expect(context.reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const item of context.questions) {
      expect(promptById(item.promptId), item.promptId).toBeTruthy();
      expect(item.hints).toHaveLength(3);
      expect(new Set(item.hints).size).toBe(3);
      for (const hint of item.hints) {
        expect(hint.trim().length).toBeGreaterThan(20);
        expect(hint.length).toBeLessThanOrEqual(230);
      }
      expect(item.sources.length).toBeGreaterThan(0);
      for (const source of item.sources) expect(new URL(source).protocol).toBe('https:');
    }
  });

  it('does not name accepted answers or aliases in any hint', () => {
    for (const item of context.questions) {
      const prompt = promptById(item.promptId)!;
      const question = ` ${normalize(prompt.prompt)} `;
      const hints = item.hints.map(hint => ` ${normalize(hint)} `);
      for (const answer of prompt.answers) {
        for (const name of [answer.answer, ...answer.aliases]) {
          const key = normalize(name);
          // A title already present in the question (e.g. Harry Potter) isn't
          // newly disclosed. Short ordinary words need editorial review.
          if (key.length < 4 || question.includes(` ${key} `)) continue;
          expect(hints.some(hint => hint.includes(` ${key} `)), `${item.promptId}: ${name}`).toBe(false);
        }
      }
    }
  });

  it('charges another 5% of starting HP per use, rounding damage upward', () => {
    expect([0, 1, 2, 3].map(uses => hintCost(300, uses))).toEqual([15, 30, 45, 60]);
    expect([0, 1, 2].map(uses => hintCost(101, uses))).toEqual([6, 11, 16]);
    expect(hintCost(10_000, 0)).toBe(500);
  });

  it('only renders unlocked hints, with the next cost beneath the button', () => {
    const id = 'archive-name-a-film-directed-by-wes-anderson';
    const hints = getPromptHints(id);
    const initial = hintMarkup(id, 0, { cost: 15, hp: 300 });
    expect(initial).toContain('</button><small id="hint-cost">Next hint: 15 HP damage</small>');
    for (const hint of hints) expect(initial).not.toContain(hint);
    const next = hintMarkup(id, 1, { cost: 30, hp: 285 });
    expect(next).toContain('Better hint');
    expect(next).toContain(hints[0]);
    expect(next).not.toContain(hints[1]);
    expect(next).not.toContain(hints[2]);
    const done = hintMarkup(id, 3, { cost: 60, hp: 210 });
    expect(done).toContain('disabled>All hints shown');
    expect(done).not.toContain('60 HP');
    expect(hintMarkup(id, 0, { cost: 15, hp: 15 })).toContain('disabled>Hint');
    expect(hintMarkup(id, 0, { cost: null })).toContain('Free in solo practice');
    expect(hintMarkup(id, 0, { cost: null, pending: true })).toContain('disabled>Getting hint…');
    expect(hintMarkup('unknown-question', 0, { cost: 15, hp: 300 })).toBe('');
  });
});
