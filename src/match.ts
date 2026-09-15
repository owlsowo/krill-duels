import type { Answer, Prompt } from './types';

const foldCase = (input: string): string => input.toLowerCase().replace(/ß/g, 'ss').replace(/ı/g, 'i').replace(/ς/g, 'σ');
const canonicalKey = (input: string): string => foldCase(input.normalize('NFC')).trim().replace(/\s+/g, ' ');

export function normalize(input: string): string {
  return foldCase(input.normalize('NFKD')).replace(/[\u0300-\u036f]/g, '')
    .replace(/^\s*(AB|A|B|O)\s*-\s*$/i, '$1 negative')
    .replace(/^\s*(AB|A|B|O)\s*\+\s*$/i, '$1 positive')
    .replace(/♀/g, ' female ').replace(/♂/g, ' male ').replace(/&/g, ' and ')
    .toLowerCase().replace(/['’]/g, '').replace(/[^\p{L}\p{N}+#]+/gu, ' ').trim().replace(/\s+/g, ' ')
    .replace(/^the /, '');
}

/** Banded edit distance, counting an adjacent letter swap as one typo. */
function typoDistance(input: string[], candidate: string[], limit: number): number {
  if (Math.abs(input.length - candidate.length) > limit) return limit + 1;
  let previous = Array.from({ length: candidate.length + 1 }, (_, index) => Math.min(index, limit + 1));
  let beforePrevious = previous;
  for (let row = 1; row <= input.length; row++) {
    const current = Array<number>(candidate.length + 1).fill(limit + 1);
    current[0] = Math.min(row, limit + 1);
    let minimum = current[0];
    for (let column = Math.max(1, row - limit); column <= Math.min(candidate.length, row + limit); column++) {
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + Number(input[row - 1] !== candidate[column - 1]),
      );
      if (row > 1 && column > 1 && input[row - 1] === candidate[column - 2] && input[row - 2] === candidate[column - 1]) {
        current[column] = Math.min(current[column], beforePrevious[column - 2] + 1);
      }
      minimum = Math.min(minimum, current[column]);
    }
    if (minimum > limit) return limit + 1;
    beforePrevious = previous;
    previous = current;
  }
  return previous[candidate.length];
}

/** Exact canonical names and explicit aliases avoid turning a wrong short answer into a hit. */
export class AnswerIndex {
  private exact = new Map<string, Answer | null>();
  private names = new Map<string, Answer | null>();
  private canonical: string[];
  private suggestionCandidates: { answer: string; letters: string[] }[] | null = null;
  constructor(prompt: Prompt) {
    this.canonical = [...new Set(prompt.answers.map(answer => answer.answer))];
    for (const answer of prompt.answers) {
      const exactKey = canonicalKey(answer.answer);
      if (exactKey) {
        if (this.exact.has(exactKey) && this.exact.get(exactKey) !== answer) this.exact.set(exactKey, null);
        else this.exact.set(exactKey, answer);
      }
      for (const alias of [answer.answer, ...answer.aliases]) {
        const key = normalize(alias);
        if (!key) continue;
        if (this.names.has(key) && this.names.get(key) !== answer) this.names.set(key, null);
        else this.names.set(key, answer);
      }
    }
  }
  match(input: string): Answer | null {
    const exactKey = canonicalKey(input);
    if (this.exact.has(exactKey)) return this.exact.get(exactKey) ?? null;
    const key = normalize(input);
    return key ? this.names.get(key) ?? null : null;
  }

  /** Suggest spellings to confirm; suggestions never change matching or scoring. */
  suggest(input: string): string[] {
    if (input.length > 160 || this.match(input)) return [];
    const key = normalize(input);
    const letters = Array.from(key);
    // Avoid guessing tiny names, numbers, or an already-known ambiguous alias.
    if (letters.length < 4 || letters.length > 160 || !/\p{L}/u.test(key) || this.names.has(key)) return [];
    this.suggestionCandidates ??= this.canonical.map(answer => ({ answer, letters: Array.from(normalize(answer)) }))
      .filter(candidate => candidate.letters.length >= 4 && candidate.letters.length <= 160);
    const suggestions: { answer: string; distance: number; lengthDifference: number }[] = [];
    for (const candidate of this.suggestionCandidates) {
      const limit = Math.min(letters.length, candidate.letters.length) >= 8 ? 2 : 1;
      const distance = typoDistance(letters, candidate.letters, limit);
      if (distance > 0 && distance <= limit) {
        suggestions.push({ answer: candidate.answer, distance, lengthDifference: Math.abs(letters.length - candidate.letters.length) });
      }
    }
    return suggestions.sort((a, b) => a.distance - b.distance || a.lengthDifference - b.lengthDifference ||
      (a.answer < b.answer ? -1 : a.answer > b.answer ? 1 : 0)).slice(0, 3).map(candidate => candidate.answer);
  }
}
