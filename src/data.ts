import catalog from './catalog.json';
import type { Prompt } from './types';
export const PROMPTS: Prompt[] = catalog;
export const PROMPT_IDS = PROMPTS.map(p => p.id);
export const promptById = (id: string): Prompt | undefined => PROMPTS.find(p => p.id === id);
// Same bytes on both browsers: mixed releases are rejected before a room can start.
export async function catalogVersion(): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(PROMPTS)));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
