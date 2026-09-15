import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { buildCurated, normalizeTitle, resolutionUrl, pageviewsUrl, resolveIdentity, validateInputs, validateMonthlyViews, YEAR } from './curated-scoring.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
if ([...args].some(arg => !['--fetch', '--check'].includes(arg))) throw new Error('Usage: node scripts/build-curated.mjs [--fetch] [--check]');
if (args.has('--fetch') && args.has('--check')) throw new Error('--check is offline; run --fetch separately.');
const inputPath = resolve(root, 'data/curated-questions.json');
const cachePath = resolve(root, `data/pageviews-${YEAR}.json`);
const questions = validateInputs(JSON.parse(await readFile(inputPath, 'utf8')));
let cache;
try { cache = JSON.parse(await readFile(cachePath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; cache = { schemaVersion: 1, year: YEAR, resolutions: {}, pageviews: {} }; }
if (cache.schemaVersion !== 1 || cache.year !== YEAR) throw new Error('Metrics cache version/window mismatch.');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
async function save(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, json(value));
  await rename(`${path}.tmp`, path);
}

if (args.has('--fetch')) {
  const answers = [...new Map(questions.flatMap(question => question.answers).map(answer => [normalizeTitle(answer.article), answer])).values()];
  if (answers.length > 500) throw new Error('Refusing more than 500 distinct articles in one reviewed catalog fetch.');
  let requestCount = 0;
  async function fetchRecord(sourceUrl) {
    for (let attempt = 0; attempt < 3; attempt++) {
      await delay(attempt ? 1000 * 2 ** attempt : 250);
      requestCount++;
      let response;
      try { response = await fetch(sourceUrl, { headers: { 'User-Agent': 'KrillDuelsCatalog/1.0 (https://github.com/owlsowo/krill-duels)', Accept: 'application/json' }, signal: AbortSignal.timeout(20000) }); }
      catch (error) { if (attempt === 2) throw error; continue; }
      if (!response.ok) {
        if ((response.status === 429 || response.status >= 500) && attempt < 2) continue;
        throw new Error(`HTTP ${response.status} fetching ${sourceUrl}; no zero-value fallback was recorded.`);
      }
      const result = await response.json();
      if (result.error) throw new Error(`API error fetching ${sourceUrl}: ${JSON.stringify(result.error)}`);
      return { sourceUrl, retrievedAt: new Date().toISOString(), response: result };
    }
    throw new Error(`Failed to fetch ${sourceUrl}`);
  }
  // Sequential, at most four starts per second; checkpoint each completed article.
  for (let index = 0; index < answers.length; index++) {
    const answer = answers[index], key = normalizeTitle(answer.article);
    if (!cache.resolutions[key]) cache.resolutions[key] = await fetchRecord(resolutionUrl(answer.article));
    const identity = resolveIdentity(answer, cache.resolutions[key]);
    if (!cache.pageviews[identity.title]) cache.pageviews[identity.title] = await fetchRecord(pageviewsUrl(identity.title));
    validateMonthlyViews(identity.title, cache.pageviews[identity.title]);
    await save(cachePath, cache);
    if ((index + 1) % 25 === 0 || index + 1 === answers.length) console.log(`Verified ${index + 1}/${answers.length} article series (${requestCount} requests).`);
  }
}

const result = buildCurated(questions, cache);
for (const [relativePath, value] of [['src/curated.json', result.prompts], ['public/curated-provenance.json', result.provenance]]) {
  const path = resolve(root, relativePath);
  if (args.has('--check')) {
    const existing = await readFile(path, 'utf8');
    if (existing !== json(value)) throw new Error(`${relativePath} is stale; run node scripts/build-curated.mjs offline to regenerate.`);
  } else await save(path, value);
}
console.log(`${args.has('--check') ? 'Verified' : 'Built'} ${result.prompts.length} estimated questions with ${result.prompts.reduce((sum, prompt) => sum + prompt.answers.length, 0)} scored answers from complete ${YEAR} metrics.`);
