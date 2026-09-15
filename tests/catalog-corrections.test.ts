import { describe, expect, it } from 'vitest';
import rawCatalog from '../src/catalog.json';
import manifest from '../public/catalog-corrections.json';
import { applyCatalogCorrections, CATALOG_CORRECTIONS_VERSION } from '../src/catalog-corrections';
import { AnswerIndex, normalize } from '../src/match';
import type { Prompt } from '../src/types';

const historical: Prompt[] = rawCatalog;
const corrected = applyCatalogCorrections(historical);
const find = (id: string, prompts = corrected) => prompts.find(p => p.id === id)!;
const gasId = 'archive-name-a-gas';
const birdId = 'archive-name-a-bird-that-cannot-fly';
const museumId = 'archive-name-a-famous-museum';
const countryId = 'archive-name-a-country-whose-english-name-contains-j-k-or-v';

describe('reviewed historical catalog overlay', () => {
  it('is deterministic and idempotent and preserves the raw catalog and untouched objects', () => {
    const original = JSON.stringify(historical);
    const again = applyCatalogCorrections(historical);
    expect(again).toEqual(corrected);
    expect(applyCatalogCorrections(corrected)).toEqual(corrected);
    expect(JSON.stringify(historical)).toBe(original);
    const touched = new Set([...manifest.corrections.map(c => c.promptId), ...manifest.countryAliases.promptIds]);
    for (const prompt of historical) {
      if (!touched.has(prompt.id)) expect(find(prompt.id)).toBe(prompt);
    }
    const untouchedMuseum = find(museumId, historical).answers.find(a => a.answer === 'The Louvre')!;
    expect(untouchedMuseum).toBeDefined();
    expect(find(museumId).answers.find(a => a.answer === 'The Louvre')).toBe(untouchedMuseum);
    expect(find(museumId, historical).answers).toHaveLength(505);
    expect(find(gasId, historical).answers).toHaveLength(31);
    expect(find(birdId, historical).answers).toHaveLength(72);
  });

  it('gives indistinguishable museum spellings one answer and one reviewed score', () => {
    const prompt = find(museumId);
    expect(prompt.answers).toHaveLength(503);
    const index = new AnswerIndex(prompt);
    for (const [names, score, entityId] of [
      [["Musee d'Orsay", "Musée d'Orsay", 'Musée d’Orsay', "MUSEE D'ORSAY"], 30, 'museum:musee-d-orsay'],
      [['Museo Nacional de Antropologia', 'Museo Nacional de Antropología', 'MUSEO NACIONAL DE ANTROPOLOGIA'], 60, 'label:museo-nacional-de-antropologia'],
    ] as const) {
      const first = index.match(names[0]);
      expect(first?.score).toBe(score);
      expect(first?.entityId).toBe(entityId);
      for (const name of names) expect(index.match(name)).toBe(first);
    }
    const owners = new Map<string, string>();
    for (const answer of prompt.answers) {
      for (const name of [answer.answer, ...answer.aliases]) {
        const key = normalize(name);
        expect(owners.get(key) ?? answer.answer).toBe(answer.answer);
        owners.set(key, answer.answer);
      }
    }
  });

  it('restricts the gas prompt to the eleven elements and merges the radon historical name', () => {
    const prompt = find(gasId);
    expect(prompt.answers.map(a => a.answer).sort()).toEqual([
      'Argon', 'Chlorine', 'Fluorine', 'Helium', 'Hydrogen', 'Krypton', 'Neon', 'Nitrogen', 'Oxygen', 'Radon', 'Xenon',
    ]);
    const index = new AnswerIndex(prompt);
    expect(index.match('Radium emanation')).toBe(index.match('Radon'));
    expect(index.match('Radium emanation')?.score).toBe(85);
    for (const name of ['Acetylene', 'Ethylene', 'Freon', 'Carbon dioxide', 'Mustard gas', 'Ozone', 'Water vapor']) {
      expect(index.match(name)).toBeNull();
      expect(index.suggest(name)).toEqual([]);
    }
    expect(prompt.rules).toContain('20°C');
    expect(prompt.rules).toContain('standard atmospheric pressure');
  });

  it('states the reviewed bird scope and records support for every original entry', () => {
    const prompt = find(birdId);
    expect(prompt.prompt).toBe('Name a flightless or weak-flying wild bird (living or extinct)');
    expect(prompt.rules).toContain('mature adults');
    expect(prompt.rules).toContain('established groups');
    expect(prompt.answers).toHaveLength(71);
    const index = new AnswerIndex(prompt);
    expect(index.match('Chicken')).toBeNull();
    expect(index.suggest('Chicken')).toEqual([]);
    for (const name of ['Dodo', 'Kagu', 'Giant coot', 'Makira woodhen', 'Steamer duck', 'Roviana rail']) {
      expect(index.match(name)?.score).toBe(find(birdId, historical).answers.find(a => a.answer === name)?.score);
    }
    // These are different species despite their similar names.
    expect(index.match('Pink-legged rail')).not.toBe(index.match("Woodford's rail"));
    const review = manifest.corrections.find(c => c.promptId === birdId)!;
    expect(review.answerReviews!.map(a => a.answer).sort()).toEqual(find(birdId, historical).answers.map(a => a.answer).sort());
    for (const row of review.answerReviews!) expect(row.sources.length).toBeGreaterThan(0);
    expect(review.answerReviews!.filter(row => row.decision === 'retain').map(row => row.answer).sort())
      .toEqual(prompt.answers.map(a => a.answer).sort());
  });

  it('enforces the literal J/K/V country-name rule', () => {
    const prompt = find(countryId);
    expect(prompt.answers).toHaveLength(41);
    expect(new AnswerIndex(prompt).match('Czech Republic')).toBeNull();
    for (const answer of prompt.answers) expect(answer.answer).toMatch(/[jkv]/i);
  });

  it('adds explicit USA identity aliases only to reviewed entity questions, without changing scores', () => {
    const aliases = manifest.countryAliases;
    expect(aliases.promptIds).toHaveLength(17);
    for (const id of aliases.promptIds) {
      const original = find(id, historical).answers.find(a => a.answer === 'United States')!;
      const index = new AnswerIndex(find(id));
      for (const alias of aliases.aliases) {
        expect(index.match(alias)).toBe(index.match('United States'));
        expect(index.match(alias)?.score).toBe(original.score);
        expect(index.suggest(alias)).toEqual([]);
      }
      expect(index.match('America')).toBeNull();
      expect(find(id).scoring).toBe('historical');
    }
    const spellingQuestion: Prompt = {
      id: 'unreviewed-spelling-question', category: 'Test', prompt: 'Name a country whose name ends with S',
      source: 'https://example.org', answers: [{ answer: 'United States', aliases: [], score: 30 }],
    };
    const [unchanged] = applyCatalogCorrections([spellingQuestion]);
    expect(unchanged).toBe(spellingQuestion);
    expect(new AnswerIndex(unchanged).match('USA')).toBeNull();
  });

  it('matches the public removal, merge, score, source and version record exactly', () => {
    for (const correction of manifest.corrections) {
      const before = find(correction.promptId, historical);
      const after = find(correction.promptId);
      expect(after.scoring).toBe('reviewed');
      expect(after.scoringVersion).toBe(CATALOG_CORRECTIONS_VERSION);
      expect(after.reviewedAt).toBe(manifest.reviewedAt);
      expect(after.rules).toBe(correction.rules);
      expect(correction.sources.length).toBeGreaterThan(0);
      const deletedNames = new Set<string>();
      for (const removal of correction.removals) {
        expect(before.answers.find(a => a.answer === removal.answer)?.score).toBe(removal.score);
        expect(after.answers.some(a => a.answer === removal.answer)).toBe(false);
        expect(removal.reason).toBeTruthy();
        expect(removal.sources.length).toBeGreaterThan(0);
        deletedNames.add(removal.answer);
      }
      for (const merge of correction.merges) {
        const canonical = after.answers.find(a => a.answer === merge.canonical)!;
        expect(canonical.score).toBe(merge.score);
        for (const member of merge.members) {
          expect(before.answers.find(a => a.answer === member.answer)?.score).toBe(member.score);
          expect(new AnswerIndex(after).match(member.answer)).toBe(canonical);
          if (member.answer !== merge.canonical) deletedNames.add(member.answer);
        }
      }
      expect(after.answers.length).toBe(before.answers.length - deletedNames.size);
    }
    const gasReview = manifest.corrections.find(c => c.promptId === gasId)!;
    expect(gasReview.answerReviews!.map(a => a.answer).sort()).toEqual(find(gasId, historical).answers.map(a => a.answer).sort());
  });
});
