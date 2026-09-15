export interface Answer { answer: string; aliases: string[]; score: number; entityId?: string }
export interface Prompt {
  id: string;
  category: string;
  prompt: string;
  source: string;
  sourceDate?: string;
  answers: Answer[];
  scoring?: 'historical' | 'reviewed' | 'estimated';
  scoringVersion?: string;
  rules?: string;
  reviewedAt?: string;
}
export interface RoundResult { promptId: string; input: string; answer: string | null; points: number }
