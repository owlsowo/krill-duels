import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { draftQuestionPack } from './question-packs.mjs';

if (process.argv.length !== 3) throw new Error('Usage: node scripts/new-question-pack.mjs <pack-id>');
const draft = draftQuestionPack(process.argv[2]);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const path = resolve(root, 'data/question-drafts', `${draft.id}.json`);
await mkdir(dirname(path), { recursive: true });
await writeFile(path, `${JSON.stringify(draft, null, 2)}\n`, { flag: 'wx' });
console.log(`Created data/question-drafts/${draft.id}.json (not playable).`);
console.log('Manually review authoritative membership sources, complete answers, identities, aliases and overlap. Then set status to reviewed and move the file to data/question-packs/; fetch and review the frozen scoring output.');
