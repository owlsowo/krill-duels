import manifest from '../public/catalog-corrections.json';
import type { Answer, Prompt } from './types';

export const CATALOG_CORRECTIONS_VERSION = manifest.version;

interface Merge {
  canonical: string;
  members: { answer: string; score: number }[];
  score: number;
  entityId: string;
}

interface Correction {
  promptId: string;
  prompt?: string;
  rules: string;
  removals: { answer: string }[];
  merges: Merge[];
}

const corrections = new Map<string, Correction>(manifest.corrections.map(c => [c.promptId, c]));
const countryAliasPrompts = new Set(manifest.countryAliases.promptIds);

function withIdentity(answer: Answer, aliases: string[], entityId: string, score = answer.score): Answer {
  const combined = [...new Set([...answer.aliases, ...aliases])].filter(name => name !== answer.answer);
  if (answer.score === score && answer.entityId === entityId
      && combined.length === answer.aliases.length && combined.every((name, i) => name === answer.aliases[i])) {
    return answer;
  }
  return { ...answer, aliases: combined, entityId, score };
}

/** Apply only documented changes; share untouched objects with the historical catalog. */
export function applyCatalogCorrections(prompts: Prompt[]): Prompt[] {
  return prompts.map(prompt => {
    const correction = corrections.get(prompt.id);
    const addCountryAliases = countryAliasPrompts.has(prompt.id);
    if (!correction && !addCountryAliases) return prompt;

    let answers = prompt.answers;
    if (correction) {
      const removed = new Set(correction.removals.map(item => item.answer));
      const merged = new Map(correction.merges.flatMap(merge => merge.members.map(member => [member.answer, merge] as const)));
      answers = answers.flatMap(answer => {
        if (removed.has(answer.answer)) return [];
        const merge = merged.get(answer.answer);
        if (!merge) return [answer];
        if (answer.answer !== merge.canonical) return [];
        // Preserve any aliases belonging to the merged rows, including when called again.
        const aliases = prompt.answers.filter(row => merged.get(row.answer) === merge)
          .flatMap(row => [row.answer, ...row.aliases]);
        return [withIdentity(answer, aliases, merge.entityId, merge.score)];
      });
    }
    if (addCountryAliases) {
      const alias = manifest.countryAliases;
      answers = answers.map(answer => answer.answer === alias.canonical
        ? withIdentity(answer, alias.aliases, alias.entityId) : answer);
    }

    return {
      ...prompt,
      answers,
      ...(correction ? { prompt: correction.prompt ?? prompt.prompt, rules: correction.rules } : {}),
      // An alias-only review does not make the question's rarity scores reviewed.
      scoring: correction ? 'reviewed' : prompt.scoring ?? 'historical',
      scoringVersion: CATALOG_CORRECTIONS_VERSION,
      reviewedAt: manifest.reviewedAt,
    };
  });
}
