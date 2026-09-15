import { describe, expect, it } from 'vitest';
import { promptById } from '../src/data';
import { scoreAnswer } from '../src/duel-engine';
import { AnswerIndex } from '../src/match';

describe('ordinary alternate names across the question bank', () => {
  // Real player inputs, independent of the correction manifest, guard against
  // removing a valid alternate name while leaving the manifest self-consistent.
  it.each([
    ['archive-name-a-country-in-africa', "Cote d'Ivoire", 'Ivory Coast'],
    ['archive-name-a-country-in-africa', 'Cape Verde', 'Cabo Verde'],
    ['archive-name-a-country-in-the-european-union', 'Czech Republic', 'Czechia'],
    ['archive-name-a-country-in-asia', 'UAE', 'United Arab Emirates'],
    ['archive-name-a-famous-museum', 'Museum of Modern Art', 'MoMA'],
    ['archive-name-a-famous-museum', 'The Metropolitan Museum of Art', 'The Met'],
    ['archive-name-a-vegetable', 'aubergine', 'Eggplant'],
    ['archive-name-a-vegetable', 'courgette', 'Zucchini'],
    ['archive-name-a-legume', 'garbanzo bean', 'Chickpea'],
    ['archive-name-a-human-hormone', 'epinephrine', 'Adrenaline'],
    ['archive-name-a-species-of-wild-cat', 'puma', 'Cougar'],
    ['archive-name-a-premier-league-club', 'Man Utd', 'Manchester United'],
    ['archive-name-a-video-game-console', 'NES', 'Nintendo Entertainment System'],
    ['archive-name-a-video-game-console', 'Mega Drive', 'Sega Genesis'],
    ['archive-name-a-walt-disney-animation-studios-feature-film', 'Zootropolis', 'Zootopia'],
    ['archive-name-a-movie-starring-harrison-ford', 'A New Hope', 'Star Wars'],
    ['archive-name-a-harry-potter-character', 'Albus Dumbledore', 'Dumbledore'],
    ['archive-name-a-microsoft-application', 'Word', 'Microsoft Word'],
    ['archive-name-a-microsoft-application', 'VS Code', 'Visual Studio Code'],
    ['archive-name-a-google-product', 'Docs', 'Google Docs'],
    ['archive-name-a-programming-language', 'JS', 'JavaScript'],
    ['archive-name-a-programming-language', 'C sharp', 'C#'],
    ['archive-name-a-computer-operating-system', 'Linux Mint', 'Mint'],
  ])('accepts %s / %s at the existing answer’s score', (id, input, canonical) => {
    const prompt = promptById(id)!;
    const answer = prompt.answers.find(row => row.answer === canonical)!;
    expect(answer).toBeDefined();
    // The solo engine and both duel transports use this same scoring function.
    expect(scoreAnswer(id, input)).toMatchObject({ answer: canonical, points: answer.score });
    expect(new AnswerIndex(prompt).suggest(input)).toEqual([]);
  });

  it('accepts dotted country abbreviations in the curated NATO question without changing estimated scores', () => {
    const prompt = promptById('curated-nato-founding-countries')!;
    const index = new AnswerIndex(prompt);
    for (const name of ['USA', 'U.S.', 'U.S.A.']) expect(index.match(name)).toBe(index.match('United States'));
    for (const name of ['UK', 'U.K.', 'United Kingdom of Great Britain and Northern Ireland']) {
      expect(index.match(name)).toBe(index.match('United Kingdom'));
    }
    expect(prompt.scoring).toBe('estimated');
    expect(prompt.scoringVersion).toBe('enwiki-human-2025-median-rank-v1');
  });

  it('respects the exact letter and suffix rules of spelling questions', () => {
    for (const [id, input] of [
      ['archive-name-a-chemical-element-whose-name-ends-in-ium', 'Aluminum'],
      ['archive-name-a-country-whose-name-starts-with-i', "Cote d'Ivoire"],
      ['archive-name-a-country-whose-name-ends-in-the-letter-a', 'Czech Republic'],
      ['archive-name-an-animal-whose-name-starts-with-k', 'Orca'],
      ['archive-name-an-animal-that-has-a-g-in-its-name', 'Puma'],
    ]) {
      expect(promptById(id), id).toBeDefined();
      expect(scoreAnswer(id, input), `${id}: ${input}`).toMatchObject({ answer: null, points: 0 });
    }
    expect(scoreAnswer('archive-name-a-chemical-element-whose-name-ends-in-ium', 'Caesium').answer).toBe('Cesium');
    expect(scoreAnswer('archive-name-an-animal-whose-name-starts-with-h', 'Hippo').answer).toBe('Hippopotamus');
  });

  it('keeps shared product names local and preserves different languages and programs', () => {
    expect(scoreAnswer('archive-name-a-microsoft-application', 'Forms').answer).toBe('Microsoft Forms');
    expect(scoreAnswer('archive-name-a-google-product', 'Forms').answer).toBe('Google Forms');
    const languages = new AnswerIndex(promptById('archive-name-a-programming-language')!);
    expect(languages.match('Java')).not.toBe(languages.match('JS'));
    expect(languages.match('C')).not.toBe(languages.match('C sharp'));
    const apps = new AnswerIndex(promptById('archive-name-a-microsoft-application')!);
    expect(apps.match('Visual Studio')).not.toBe(apps.match('VS Code'));
    expect(scoreAnswer('archive-name-a-famous-ship-real-or-fictional', 'Killer whale').answer).toBeNull();
  });
});
