export interface Answer { answer: string; aliases: string[]; score: number }
export interface Prompt { id: string; category: string; prompt: string; source: string; sourceDate?: string; answers: Answer[] }
export interface RoundResult { promptId: string; input: string; answer: string | null; points: number }
