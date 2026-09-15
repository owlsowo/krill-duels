import { describe, expect, it } from 'vitest';
import context from '../data/prompt-hints.json';
import { PROMPTS, promptById } from '../src/data';
import { PracticeSession } from '../src/practice';
import { DuelEngine, scoreAnswer } from '../src/duel-engine';
import { normalize } from '../src/match';
import { answerPatterns, getHintGuide, getPromptHints, hintCost } from '../src/hints';
import { hintMarkup } from '../src/hint-display';

describe('actionable answer hints', () => {
  it('covers the entire playable bank with three hints, without missing or obsolete IDs', () => {
    expect(context.questions.map(q => q.promptId).sort()).toEqual(PROMPTS.map(q => q.id).sort());
    for (const prompt of PROMPTS) expect(getPromptHints(prompt.id), prompt.id).toHaveLength(3);
  });

  it('shows and unlocks all three hints for every real question in solo and duels', () => {
    for (const prompt of PROMPTS) {
      const solo = new PracticeSession(25, 0, [prompt.id]);
      const duel = new DuelEngine('Host', 'hint-catalog-check', [prompt.id]);
      duel.join('Guest', 0); duel.ready(0, 0); duel.ready(1, 0); duel.tick(3000);
      expect(duel.snapshot(3000).phase).toBe('question');
      for (let level = 0; level < 3; level++) {
        const free = hintMarkup(prompt.id, level, { cost:null });
        const paid = hintMarkup(prompt.id, level, { cost:hintCost(300, level), hp:300 });
        for (const html of [free, paid]) {
          expect(html, prompt.id).toContain('data-action="hint"');
          expect(html, prompt.id).not.toContain('disabled>');
        }
        expect(free).toContain('Free in solo practice');
        expect(solo.hint(1), prompt.id).toBe(true);
        expect(solo.snapshot().hintLevel).toBe(level + 1);
        expect(duel.hint(0, 'hint-catalog-check', 1, level, 3001), prompt.id).toBe(true);
      }
      expect(solo.snapshot().total).toBe(0);
      expect(duel.snapshot(3001).hp[0]).toBe(210);
      expect(solo.hint(2)).toBe(false);
      expect(duel.hint(0, 'hint-catalog-check', 1, 3, 3002)).toBe(false);
    }
  });

  it('guides every question toward a valid mid-scoring answer rather than an obscure jackpot', () => {
    expect(new Set(context.questions.map(q => q.promptId)).size).toBe(context.questions.length);
    expect(context.reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const item of context.questions) {
      const prompt = promptById(item.promptId)!;
      const guide = getHintGuide(item.promptId)!;
      const result = scoreAnswer(item.promptId, item.target);
      expect(result.answer, item.promptId).toBe(item.target);
      expect(result.points, item.promptId).toBe(guide.score);
      expect(guide.score, item.promptId).toBeGreaterThanOrEqual(30);
      expect(guide.score, item.promptId).toBeLessThanOrEqual(60);
      expect(normalize(prompt.prompt).includes(normalize(item.target)), item.promptId).toBe(false);
      expect(new Set(guide.patterns).size, item.promptId).toBe(3);
    }
  });

  it('adds correct letters to the same answer at every level, ending with just one missing character', () => {
    for (const item of context.questions) {
      const answer = Array.from(item.target.normalize('NFC'));
      const guide = getHintGuide(item.promptId)!;
      let previous: string[] | null = null;
      let blanks = answer.filter(character => /[\p{L}\p{N}]/u.test(character)).length;
      for (const pattern of guide.patterns) {
        const characters = Array.from(pattern);
        expect(characters.length, item.promptId).toBe(answer.length);
        const remaining = characters.filter(character => character === '_').length;
        expect(remaining, item.promptId).toBeLessThan(blanks);
        expect(remaining, item.promptId).toBeGreaterThan(0);
        for (let i = 0; i < answer.length; i++) {
          if (characters[i] !== '_') expect(characters[i], item.promptId).toBe(answer[i]);
          if (previous && previous[i] !== '_') expect(characters[i], item.promptId).toBe(previous[i]);
          if (!/[\p{L}\p{N}]/u.test(answer[i])) expect(characters[i], item.promptId).toBe(answer[i]);
        }
        previous = characters;
        blanks = remaining;
      }
      expect(blanks, item.promptId).toBe(1);
    }
  });

  it('handles accents, digits, apostrophes and short answers without giving away the whole target', () => {
    for (const answer of ['Café', 'Björk', '24K Magic', "A Bug’s Life", '東京大学', 'BOTTLE ROCKET']) {
      const patterns = answerPatterns(answer);
      expect(new Set(patterns).size).toBe(3);
      expect(patterns[2].match(/_/g)).toHaveLength(1);
      expect(patterns[2]).not.toBe(answer);
    }
    expect(answerPatterns('Cafe\u0301')).toEqual(answerPatterns('Café'));
    expect(answerPatterns('42')).toEqual([]);
    expect(answerPatterns('')).toEqual([]);
  });

  it('charges another 5% of starting HP per use, rounding damage upward', () => {
    expect([0, 1, 2, 3].map(uses => hintCost(300, uses))).toEqual([15, 30, 45, 60]);
    expect([0, 1, 2].map(uses => hintCost(101, uses))).toEqual([6, 11, 16]);
    expect(hintCost(10_000, 0)).toBe(500);
  });

  it('only renders unlocked hints, with the next cost beneath the button', () => {
    const id = 'archive-name-a-film-directed-by-wes-anderson';
    const guide = getHintGuide(id)!;
    const initial = hintMarkup(id, 0, { cost: 15, hp: 300 });
    expect(initial).toContain('</button><small id="hint-cost">Next hint: 15 HP damage</small>');
    expect(initial).toContain(`${guide.score}-point answer`);
    expect(initial).not.toContain('class="hint-pattern"');
    const next = hintMarkup(id, 1, { cost: 30, hp: 285 });
    expect(next).toContain('More letters');
    for (const word of guide.patterns[0].split(' ')) expect(next).toContain(`>${word}</span>`);
    expect(next).not.toContain('Bottle Rocket');
    expect(next).not.toContain('Bottl_');
    expect(next).not.toContain('Rock__');
    const done = hintMarkup(id, 3, { cost: 60, hp: 210 });
    expect(done).toContain('disabled>All hints shown');
    expect(done).not.toContain('60 HP');
    expect(hintMarkup(id, 0, { cost: 15, hp: 15 })).toContain('disabled>Hint');
    expect(hintMarkup(id, 0, { cost: null })).toContain('Free in solo practice');
    expect(hintMarkup(id, 0, { cost: null, pending: true })).toContain('disabled>Getting hint…');
    expect(hintMarkup('unknown-question', 0, { cost: 15, hp: 300 })).toBe('');
  });
});
