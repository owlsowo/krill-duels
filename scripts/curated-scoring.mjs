import { createHash } from 'node:crypto';

export const YEAR = 2025;
export const SCORING_VERSION = 'enwiki-human-2025-median-rank-v1';
export const MONTHS = Array.from({ length: 12 }, (_, index) => `${YEAR}${String(index + 1).padStart(2, '0')}0100`);
export const POLICY = {
  version: SCORING_VERSION,
  label: 'Estimated points from relative Wikipedia readership',
  project: 'en.wikipedia.org', access: 'all-access', agent: 'user', granularity: 'monthly',
  pageviewsLicense: 'CC0-1.0',
  window: { start: '2025-01-01', end: '2025-12-31', monthsRequired: 12 },
  metric: 'Median of the 12 monthly human pageview counts for the resolved canonical English Wikipedia article.',
  rank: 'For n answers, rarityRank = (number with greater median + (number tied - 1) / 2) / (n - 1). All-equal medians receive 10 points.',
  tiers: [
    { below: 0.25, score: 10 }, { below: 0.5, score: 30 },
    { below: 0.75, score: 60 }, { below: 0.9, score: 85 }, { below: null, score: 100 },
  ],
  missingData: 'Fail the build for the whole prompt if any answer lacks a valid identity or complete 12-month series. Request errors never become zero views.',
  redirectPolicy: 'Resolve supplied titles to their canonical articles and verify Wikidata identity. Measure the canonical title only; traffic recorded under other redirect titles is not added.',
  limitations: [
    'These are relative readership estimates within each question, not actual player-answer frequencies or universal rarity.',
    'English Wikipedia readership can reflect news, language, geography, and article-title changes; a full-year median reduces isolated spikes but does not remove these biases.',
    'The user traffic category excludes detected automated traffic; undetected automation may remain.',
    'No player traffic or external API is needed at runtime.',
  ],
  references: [
    'https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/reference/page-views.html',
    'https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/concepts/page-views.html',
    'https://www.mediawiki.org/wiki/API:Query#Resolving_redirects',
    'https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/documentation/access-policy.html',
  ],
};

export const normalizeTitle = value => value.replaceAll('_', ' ').trim();
const normalizeAnswer = value => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function resolutionUrl(article) {
  const url = new URL('https://en.wikipedia.org/w/api.php');
  for (const [key, value] of Object.entries({ action: 'query', format: 'json', formatversion: '2', redirects: '1', prop: 'pageprops', ppprop: 'wikibase_item|disambiguation', titles: normalizeTitle(article) })) url.searchParams.set(key, value);
  return url.href;
}

export function pageviewsUrl(article) {
  return `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia.org/all-access/user/${encodeURIComponent(normalizeTitle(article).replaceAll(' ', '_'))}/monthly/2025010100/2025123100`;
}

export function validateInputs(questions) {
  assert(Array.isArray(questions) && questions.length > 0 && questions.length <= 40, 'Expected 1–40 reviewed questions.');
  const ids = new Set(), prompts = new Set();
  for (const question of questions) {
    assert(typeof question.id === 'string' && /^curated-[a-z0-9-]+$/.test(question.id) && !ids.has(question.id), `Invalid or duplicate question ID: ${question.id}`);
    ids.add(question.id);
    for (const field of ['category', 'prompt', 'rules']) assert(typeof question[field] === 'string' && question[field].trim(), `${question.id}: missing ${field}`);
    assert(!prompts.has(normalizeAnswer(question.prompt)), `${question.id}: duplicate prompt`);
    prompts.add(normalizeAnswer(question.prompt));
    assert(/^\d{4}-\d{2}-\d{2}$/.test(question.reviewedAt ?? ''), `${question.id}: missing review date`);
    assert(Array.isArray(question.sources) && question.sources.length > 0, `${question.id}: missing factual sources`);
    for (const source of question.sources) assert(source.title && /^https:\/\//.test(source.url ?? ''), `${question.id}: invalid factual source`);
    assert(Array.isArray(question.answers) && question.answers.length >= 2 && question.answers.length <= 200, `${question.id}: expected 2–200 reviewed answers`);
    const entities = new Set(), accepted = new Map();
    for (const answer of question.answers) {
      assert(typeof answer.answer === 'string' && answer.answer.trim() && Array.isArray(answer.aliases), `${question.id}: invalid answer`);
      assert(/^Q[1-9]\d*$/.test(answer.entityId ?? '') && !entities.has(answer.entityId), `${question.id}: invalid or duplicate entity ${answer.entityId}`);
      entities.add(answer.entityId);
      assert(typeof answer.article === 'string' && normalizeTitle(answer.article) && !/[#|\n\r]/.test(answer.article), `${question.id}/${answer.answer}: invalid article title`);
      for (const name of [answer.answer, ...answer.aliases]) {
        assert(typeof name === 'string' && normalizeAnswer(name), `${question.id}: empty answer or alias`);
        const key = normalizeAnswer(name);
        assert(!accepted.has(key) || accepted.get(key) === answer.entityId, `${question.id}: ambiguous alias ${name}`);
        accepted.set(key, answer.entityId);
      }
    }
  }
  return questions;
}

export function resolveIdentity(answer, record) {
  assert(record && record.sourceUrl === resolutionUrl(answer.article) && record.retrievedAt, `${answer.answer}: missing cached title resolution`);
  const response = record.response;
  assert(response && !response.error && Array.isArray(response.query?.pages) && response.query.pages.length === 1, `${answer.answer}: invalid title-resolution response`);
  const page = response.query.pages[0];
  assert(!page.missing && !page.invalid && Number.isInteger(page.pageid) && page.ns === 0 && page.title, `${answer.answer}: article is missing or invalid`);
  assert(!Object.hasOwn(page.pageprops ?? {}, 'disambiguation'), `${answer.answer}: disambiguation page cannot establish an answer identity`);
  assert(page.pageprops?.wikibase_item === answer.entityId, `${answer.answer}: Wikidata identity mismatch (expected ${answer.entityId}, received ${page.pageprops?.wikibase_item ?? 'none'})`);
  const redirects = response.query.redirects ?? [];
  assert(redirects.every(redirect => !redirect.tofragment), `${answer.answer}: section redirect does not identify a standalone article`);
  return { title: page.title, entityId: page.pageprops.wikibase_item, pageId: page.pageid, redirects, normalized: response.query.normalized ?? [] };
}

export function validateMonthlyViews(title, record) {
  assert(record && record.sourceUrl === pageviewsUrl(title) && record.retrievedAt, `${title}: missing cached pageviews`);
  const items = record.response?.items;
  assert(Array.isArray(items) && items.length === 12, `${title}: expected complete 12-month ${YEAR} pageviews; received ${items?.length ?? 'no'} months`);
  const byMonth = new Map();
  for (const item of items) {
    assert(MONTHS.includes(item.timestamp) && !byMonth.has(item.timestamp), `${title}: missing, duplicate, or out-of-window month ${item.timestamp}`);
    assert(['en.wikipedia', 'en.wikipedia.org'].includes(item.project) && item.access === 'all-access' && item.agent === 'user' && item.granularity === 'monthly', `${title}: pageview project/filter mismatch`);
    assert(normalizeTitle(item.article ?? '') === normalizeTitle(title), `${title}: pageview article mismatch`);
    assert(Number.isSafeInteger(item.views) && item.views >= 0, `${title}: invalid pageview count for ${item.timestamp}`);
    byMonth.set(item.timestamp, item.views);
  }
  return MONTHS.map(month => ({ month: `${month.slice(0, 4)}-${month.slice(4, 6)}`, views: byMonth.get(month) }));
}

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  assert(sorted.length === 12 && sorted.every(value => Number.isFinite(value) && value >= 0), 'Median requires 12 valid monthly counts.');
  return (sorted[5] + sorted[6]) / 2;
}

export function estimateScores(medians) {
  assert(medians.length >= 2 && medians.every(value => Number.isFinite(value) && value >= 0), 'Ranking requires a complete valid metric for every answer.');
  if (medians.every(value => value === medians[0])) return medians.map(() => ({ score: 10, rarityRank: 0 }));
  return medians.map(value => {
    const greater = medians.filter(other => other > value).length;
    const tied = medians.filter(other => other === value).length;
    const rarityRank = (greater + (tied - 1) / 2) / (medians.length - 1);
    const score = POLICY.tiers.find(tier => tier.below === null || rarityRank < tier.below).score;
    return { score, rarityRank };
  });
}

export function buildCurated(questions, cache) {
  validateInputs(questions);
  assert(cache?.schemaVersion === 1 && cache.year === YEAR, `Expected schema 1 metrics cache for ${YEAR}.`);
  const prompts = [], provenance = [];
  for (const question of questions) {
    const evidence = question.answers.map(answer => {
      const resolution = cache.resolutions?.[normalizeTitle(answer.article)];
      const identity = resolveIdentity(answer, resolution);
      const pageviews = cache.pageviews?.[identity.title];
      const monthly = validateMonthlyViews(identity.title, pageviews);
      return { answer: answer.answer, entityId: answer.entityId, requestedArticle: answer.article, canonicalArticle: identity.title, articleUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(identity.title.replaceAll(' ', '_'))}`, medianMonthlyViews: median(monthly.map(item => item.views)), monthly, resolution: { sourceUrl: resolution.sourceUrl, retrievedAt: resolution.retrievedAt, ...identity }, pageviews: { sourceUrl: pageviews.sourceUrl, retrievedAt: pageviews.retrievedAt } };
    });
    const ranks = estimateScores(evidence.map(answer => answer.medianMonthlyViews));
    prompts.push({ id: question.id, category: question.category, prompt: question.prompt, source: question.sources[0].url, sourceDate: question.reviewedAt, rules: question.rules, reviewedAt: question.reviewedAt, scoring: 'estimated', scoringVersion: SCORING_VERSION, answers: question.answers.map(({ answer, aliases, entityId }, index) => ({ answer, aliases, entityId, score: ranks[index].score })) });
    provenance.push({ id: question.id, category: question.category, prompt: question.prompt, rules: question.rules, reviewedAt: question.reviewedAt, sources: question.sources, answers: evidence.map((answer, index) => ({ ...answer, ...ranks[index] })) });
  }
  return { prompts, provenance: { schemaVersion: 1, scoringVersion: SCORING_VERSION, inputsSha256: digest(questions), cacheSha256: digest(cache), policy: POLICY, questions: provenance } };
}
