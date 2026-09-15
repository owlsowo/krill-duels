import { describe, expect, it } from 'vitest';
import { PROMPTS } from '../src/data';
import { AnswerIndex } from '../src/match';
import type { Prompt } from '../src/types';

function index(answers: string[]): AnswerIndex {
  return new AnswerIndex({
    id: 'spelling-fixture', category: 'Test', prompt: 'Spelling fixture', source: 'https://example.com',
    answers: answers.map(answer => ({ answer, aliases: [], score: 10 })),
  });
}

describe('prompt-local spelling suggestions', () => {
  it('corrects alluminum to each element question’s actual archive spelling without accepting the typo', () => {
    for (const [id, canonical] of [
      ['archive-name-a-chemical-element-lighter-than-iron', 'Aluminum'],
      ['archive-name-a-chemical-element-whose-name-ends-in-ium', 'Aluminium'],
    ]) {
      const prompt = PROMPTS.find(prompt => prompt.id === id)!;
      expect(prompt).toBeDefined();
      const answers = new AnswerIndex(prompt);
      expect(answers.match('alluminum')).toBeNull();
      expect(answers.suggest('alluminum')[0]).toBe(canonical);
      expect(answers.match('alluminum')).toBeNull();
      expect(answers.match(canonical)?.answer).toBe(canonical);
    }
  });

  it('handles an insertion, missing letter, substitution, and adjacent transposition', () => {
    const answers = index(['Copper', 'Aluminum']);
    for (const typo of ['coppeer', 'coper', 'coppar', 'copp er', 'coppre']) {
      expect(answers.suggest(typo)).toEqual(['Copper']);
    }
    expect(answers.suggest('alumiunm')).toEqual(['Aluminum']);
  });

  it('uses the existing case, accent, and full-width normalization while preserving canonical text', () => {
    const answers = index(['Jalapeño', 'Café']);
    expect(answers.suggest('  JALAPNEO  ')).toEqual(['Jalapeño']);
    expect(answers.suggest('ｊａｌａｐｎｅｏ')).toEqual(['Jalapeño']);
    for (const valid of ['JALAPENO', 'ｊａｌａｐｅｎｏ', 'cafe']) expect(answers.suggest(valid)).toEqual([]);
  });

  it('does not suggest alternatives for valid canonical answers or aliases', () => {
    const prompt: Prompt = {
      id: 'aliases', category: 'Test', prompt: 'Aliases', source: 'https://example.com',
      answers: [
        { answer: 'Aluminum', aliases: ['aluminium'], score: 10 },
        { answer: 'Café', aliases: [], score: 60 },
        { answer: 'Cafe', aliases: [], score: 100 },
      ],
    };
    const answers = new AnswerIndex(prompt);
    expect(answers.suggest('aluminium')).toEqual([]);
    expect(answers.suggest('Café')).toEqual([]);
    expect(answers.match('Café')?.score).toBe(60);
    expect(answers.suggest('Cafe')).toEqual([]);
    expect(answers.match('Cafe')?.score).toBe(100);
  });

  it('does not turn a known ambiguous alias into a spelling guess', () => {
    const answers = new AnswerIndex({
      id: 'ambiguous', category: 'Test', prompt: 'Ambiguous aliases', source: 'https://example.com',
      answers: [
        { answer: 'Alpha', aliases: ['shared'], score: 10 },
        { answer: 'Beta', aliases: ['shared'], score: 100 },
        { answer: 'Shored', aliases: [], score: 60 },
      ],
    });
    expect(answers.match('shared')).toBeNull();
    expect(answers.suggest('shared')).toEqual([]);
  });

  it('offers at most three unique canonical names in deterministic order independent of catalog order', () => {
    const names = ['Harry', 'Barry', 'Larry', 'Carry', 'Harry'];
    expect(index(names).suggest('parry')).toEqual(['Barry', 'Carry', 'Harry']);
    expect(index([...names].reverse()).suggest('parry')).toEqual(['Barry', 'Carry', 'Harry']);
    expect(index(['Aluminium', 'Aluminum']).suggest('alluminum')).toEqual(['Aluminum', 'Aluminium']);
  });

  it('rejects unrelated, very short, numeric, punctuation-only, and overly long input', () => {
    const answers = index(['Aluminum', 'Copper', 'Iron', 'Tin', 'Gold', '1994']);
    for (const input of ['', '!!!', '1234', '1995', 'irn', 'ti', 'go', 'pineapple', 'zzzzzzzz', 'a'.repeat(161)]) {
      expect(answers.suggest(input)).toEqual([]);
    }
    expect(answers.suggest('a'.repeat(160))).toEqual([]);
    expect(index(['Gold']).suggest('goads')).toEqual([]);
  });

  it('only suggests answers in the current question and uses canonical spellings as its dictionary', () => {
    expect(index(['Copper']).suggest('alluminum')).toEqual([]);
    const answers = new AnswerIndex({
      id: 'dictionary', category: 'Test', prompt: 'Canonical dictionary', source: 'https://example.com',
      answers: [{ answer: 'United States of America', aliases: ['America'], score: 10 }],
    });
    expect(answers.suggest('Amercia')).toEqual([]);
  });
});
