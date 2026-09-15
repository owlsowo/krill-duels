import { describe, expect, it } from 'vitest';
import { ARCHIVE_PROMPTS, CURATED_PROMPTS, PROMPTS, promptById } from '../src/data';
import { AnswerIndex, normalize } from '../src/match';

describe('playable question bank integrity', () => {
  it('contains unique complete questions with accepted scored canonical answers', () => {
    expect(new Set(PROMPTS.map(p => p.id)).size).toBe(PROMPTS.length);
    expect(new Set(PROMPTS.map(p => normalize(p.prompt))).size).toBe(PROMPTS.length);
    const scores = new Set<number>();
    for (const prompt of PROMPTS) {
      expect(new URL(prompt.source).protocol).toBe('https:');
      expect(prompt.answers.length).toBeGreaterThan(0);
      const index = new AnswerIndex(prompt);
      const normalizedOwners = new Map<string, string>();
      expect(index.match('')).toBeNull(); expect(index.match('   ')).toBeNull();
      for (const answer of prompt.answers) {
        expect(index.match(answer.answer)).toEqual(answer);
        expect(index.match(`  ${answer.answer.toUpperCase()}  `)).toEqual(answer);
        expect([10,15,30,60,85,100]).toContain(answer.score);
        for (const name of [answer.answer, ...answer.aliases]) {
          expect(index.match(name), `${prompt.id}: ${name}`).toEqual(answer);
          const key = normalize(name);
          const owner = normalizedOwners.get(key);
          expect(owner === undefined || owner === answer.answer, `${prompt.id}: conflicting name ${name}`).toBe(true);
          normalizedOwners.set(key, answer.answer);
        }
        scores.add(answer.score);
      }
    }
    expect([...scores].sort((a,b) => a-b)).toEqual([10,15,30,60,85,100]);
  });

  it('keeps the historical bank and an explicitly estimated, source-backed expansion', () => {
    expect(ARCHIVE_PROMPTS).toHaveLength(461);
    expect(CURATED_PROMPTS.length).toBeGreaterThanOrEqual(20);
    expect(PROMPTS.length).toBe(ARCHIVE_PROMPTS.length + CURATED_PROMPTS.length);
    for (const prompt of ARCHIVE_PROMPTS) expect(prompt.source).toMatch(/^https:\/\/krillionanswers.com\/questions\//);
    for (const prompt of CURATED_PROMPTS) {
      expect(prompt.scoring).toBe('estimated');
      expect(prompt.scoringVersion).toBeTruthy();
      expect(prompt.reviewedAt).toBeTruthy();
      expect(prompt.rules).toBeTruthy();
      expect(prompt.answers.every(answer => answer.entityId)).toBe(true);
      expect(new Set(prompt.answers.map(answer => answer.entityId)).size).toBe(prompt.answers.length);
      expect(prompt.answers.some(answer => answer.score === 15)).toBe(false);
    }
  });

  it('includes complete NASA landing and astronaut sets, with eligible aliases only', () => {
    const apollo = promptById('curated-apollo-moon-landings')!;
    expect(apollo.answers.map(answer => answer.answer)).toEqual([11,12,14,15,16,17].map(number => `Apollo ${number}`));
    const missions = new AnswerIndex(apollo);
    expect(missions.match('11')?.answer).toBe('Apollo 11');
    expect(missions.match('Apollo-17')?.answer).toBe('Apollo 17');
    expect(missions.match('Apollo 13')).toBeNull(); expect(missions.match('Apollo 10')).toBeNull();
    const mercury = promptById('curated-mercury-seven')!;
    expect(mercury.answers.map(answer => answer.answer)).toEqual(['Scott Carpenter','Gordon Cooper','John Glenn','Gus Grissom','Wally Schirra','Alan Shepard','Deke Slayton']);
    const astronauts = new AnswerIndex(mercury);
    expect(astronauts.match('Slayton')?.answer).toBe('Deke Slayton');
    expect(astronauts.match('Virgil Ivan Grissom')?.answer).toBe('Gus Grissom');
    expect(astronauts.match('Walter Marty Schirra Jr.')?.answer).toBe('Wally Schirra');
    expect(astronauts.match('Neil Armstrong')).toBeNull();
    expect(astronauts.match('John')).toBeNull();
  });
});
