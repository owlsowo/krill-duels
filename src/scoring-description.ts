import type { Prompt } from './types';

const historicalLabels: Record<number, string> = { 0: 'Miss', 10: 'Plankton', 15: 'Too clever', 30: 'Schooler', 60: 'Rare', 85: 'Deep cut', 100: 'One in a Krillion' };
const estimatedLabels: Record<number, string> = { 0: 'Miss', 10: 'Most familiar', 30: 'Familiar', 60: 'Less familiar', 85: 'Uncommon', 100: 'Least familiar' };

export function scoreLabel(points: number, prompt?: Prompt | null): string {
  return (prompt?.scoring === 'estimated' ? estimatedLabels : historicalLabels)[points] ?? `${points} points`;
}

export function scoringLabel(prompt?: Prompt | null): string {
  return prompt?.scoring === 'estimated' ? 'Estimated rarity' : prompt?.scoring === 'reviewed' ? 'Reviewed archive' : 'Historical scores';
}

export function scoringExplanation(prompt: Prompt): string {
  if (prompt.scoring === 'estimated') return 'Based on 2025 English Wikipedia readership, compared within this question. Less-read answers earn more points; ties earn the same. This estimates familiarity, not how often players choose an answer.';
  if (prompt.scoring === 'reviewed') return 'Historical scores with documented corrections to answer rules and equivalent names. These remain editorial grades, not measured player rarity.';
  return 'Historical editorial grades. The top answer can reward a satisfying choice as well as obscurity, so these are not a strict ranking of player familiarity.';
}
