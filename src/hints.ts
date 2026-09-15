import context from '../data/prompt-hints.json';

export const HINTS_VERSION = context.version;
const hints = new Map(context.questions.map(question => [question.promptId, Object.freeze([...question.hints])]));
const none: readonly string[] = Object.freeze([]);

/** Reviewed context only: never derive hints from accepted answers at runtime. */
export function getPromptHints(promptId: string): readonly string[] {
  return hints.get(promptId) ?? none;
}

/** Each purchased hint adds another 5% of starting HP to the next price. */
export function hintCost(startingHp: number, priorUses: number): number {
  return Math.ceil(startingHp * (priorUses + 1) / 20);
}
