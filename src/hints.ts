import context from '../data/prompt-hints.json';
import { promptById } from './data';

export const HINTS_VERSION = context.version;
export interface HintGuide {
  score: number;
  wordLengths: readonly number[];
  patterns: readonly string[];
  hints: readonly string[];
}
const none: readonly string[] = Object.freeze([]);
const guides = new Map<string, HintGuide>();
const isCharacter = (character: string): boolean => /[\p{L}\p{N}]/u.test(character);
const stopWords = new Set(['a', 'an', 'the', 'of', 'and', 'in', 'on', 'to', 'at', 'for', 'with']);

/** Three cumulative spelling clues. Keep a meaningful character hidden even at level three. */
export function answerPatterns(answer: string): readonly string[] {
  const characters = Array.from(answer.normalize('NFC'));
  const words: number[][] = [];
  for (let i = 0; i < characters.length; i++) {
    if (!isCharacter(characters[i])) continue;
    if (i === 0 || !isCharacter(characters[i - 1])) words.push([]);
    words.at(-1)!.push(i);
  }
  const total = words.reduce((sum, word) => sum + word.length, 0);
  if (total < 4) return none;
  const meaningful = words.filter(word => !stopWords.has(word.map(i => characters[i]).join('').toLowerCase()));
  const longest = [...(meaningful.length ? meaningful : words)].sort((a, b) => b.length - a.length)[0];
  const vowels = longest.slice(1).filter(i => /[aeiou]/i.test(characters[i].normalize('NFD')[0]));
  const hidden = vowels.at(-1) ?? longest.at(-1)!;
  // Reveal word initials, then prefixes in parallel. The reserved missing letter
  // belongs to a substantive word, not just an article which the matcher ignores.
  const order: number[] = [];
  for (let depth = 0; depth < Math.max(...words.map(word => word.length)); depth++) {
    for (const word of words) {
      const index = word[depth];
      if (index !== undefined && index !== hidden) order.push(index);
    }
  }
  const first = Math.min(total - 3, Math.max(1, Math.floor(total * .4)));
  const second = Math.min(total - 2, Math.max(first + 1, Math.floor(total * .7)));
  return Object.freeze([first, second, total - 1].map(count => {
    const revealed = new Set(order.slice(0, count));
    return characters.map((character, index) => !isCharacter(character) || revealed.has(index) ? character : '_').join('');
  }));
}

for (const entry of context.questions) {
  const answer = promptById(entry.promptId)?.answers.find(answer => answer.answer === entry.target);
  if (!answer) continue;
  const patterns = answerPatterns(answer.answer);
  if (patterns.length !== 3) continue;
  const wordLengths = Object.freeze(answer.answer.normalize('NFC').split(/\s+/u).map(word => Array.from(word).filter(isCharacter).length).filter(Boolean));
  const lengthText = wordLengths.join(' + ');
  const hints = Object.freeze(patterns.map((pattern, level) =>
    `Hint ${level + 1}/3: one ${answer.score}-point answer; word lengths ${lengthText}. ${pattern}`));
  guides.set(entry.promptId, Object.freeze({ score:answer.score, wordLengths, patterns, hints }));
}

export function getHintGuide(promptId: string): HintGuide | undefined { return guides.get(promptId); }

/** Gameplay and accessibility use the same purchased spelling clues. */
export function getPromptHints(promptId: string): readonly string[] {
  return guides.get(promptId)?.hints ?? none;
}

/** Each purchased hint adds another 5% of starting HP to the next price. */
export function hintCost(startingHp: number, priorUses: number): number {
  return Math.ceil(startingHp * (priorUses + 1) / 20);
}
