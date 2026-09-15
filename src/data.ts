import catalog from './catalog.json';
import curated from './curated.json';
import { applyCatalogCorrections } from './catalog-corrections';
import type { Prompt } from './types';
export const ARCHIVE_PROMPTS: Prompt[] = applyCatalogCorrections(catalog);
export const CURATED_PROMPTS: Prompt[] = curated as Prompt[];
export const PROMPTS: Prompt[] = [...ARCHIVE_PROMPTS, ...CURATED_PROMPTS];
export const PROMPT_IDS = PROMPTS.map(p => p.id);
export const promptById = (id: string): Prompt | undefined => PROMPTS.find(p => p.id === id);
// Same bytes on both browsers: mixed releases are rejected before a room can start.
export async function catalogVersion(): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(PROMPTS)));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
