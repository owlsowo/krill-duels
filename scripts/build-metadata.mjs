import { mkdir, cp, writeFile, readFile } from 'node:fs/promises';
await mkdir('dist/.openai', { recursive: true });
// A registered Site supplies its own manifest. A fresh clone can still build
// and run locally; no project is created or selected by this build helper.
const hosting = await readFile('.openai/hosting.json', 'utf8').catch(error => {
  if (error.code !== 'ENOENT') throw error;
  return JSON.stringify({ d1: 'DB', r2: null });
});
await writeFile('dist/.openai/hosting.json', hosting);
await cp('drizzle', 'dist/.openai/drizzle', { recursive: true });
await writeFile('dist/server/wrangler.json', JSON.stringify({
  name: 'krill-duels-local', main: 'index.js', compatibility_date: '2026-05-15',
  assets: { directory: '../client', binding: 'ASSETS', run_worker_first: true },
  d1_databases: [{ binding: 'DB', database_name: 'site-creator-d1', database_id: '00000000-0000-4000-8000-000000000000' }],
}, null, 2));
