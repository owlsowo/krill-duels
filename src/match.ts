import type { Answer, Prompt } from './types';

export function normalize(input: string): string {
  return input.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/^\s*(AB|A|B|O)\s*-\s*$/i, '$1 negative')
    .replace(/^\s*(AB|A|B|O)\s*\+\s*$/i, '$1 positive')
    .replace(/♀/g, ' female ').replace(/♂/g, ' male ').replace(/&/g, ' and ')
    .toLowerCase().replace(/['’]/g, '').replace(/[^\p{L}\p{N}+#]+/gu, ' ').trim().replace(/\s+/g, ' ')
    .replace(/^the /, '');
}

/** Exact canonical names and explicit aliases avoid turning a wrong short answer into a hit. */
export class AnswerIndex {
  private names = new Map<string, Answer | null>();
  constructor(prompt: Prompt) {
    for (const answer of prompt.answers) {
      for (const alias of [answer.answer, ...answer.aliases]) {
        const key = normalize(alias);
        if (!key) continue;
        if (this.names.has(key) && this.names.get(key) !== answer) this.names.set(key, null);
        else this.names.set(key, answer);
      }
    }
  }
  match(input: string): Answer | null { const key = normalize(input); return key ? this.names.get(key) ?? null : null; }
}
