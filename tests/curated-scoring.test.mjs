import { describe, expect, it } from 'vitest';
import { buildCurated, estimateScores, median, MONTHS, normalizeTitle, pageviewsUrl, resolutionUrl, resolveIdentity, SCORING_VERSION, validateInputs, validateMonthlyViews } from '../scripts/curated-scoring.mjs';

function fixture() {
  const answers = ['One', 'Two', 'Three', 'Four', 'Five'].map((answer, index) => ({ answer, aliases: [`Alias ${answer}`], entityId: `Q${index + 1}`, article: answer }));
  const questions = [{ id: 'curated-test', category: 'Test', prompt: 'Name a fixture answer.', rules: 'Five fixture entities.', reviewedAt: '2026-09-15', sources: [{ title: 'Fixture source', url: 'https://example.org/facts' }], answers }];
  const cache = { schemaVersion: 1, year: 2025, resolutions: {}, pageviews: {} };
  for (const [index, answer] of answers.entries()) {
    cache.resolutions[answer.article] = { sourceUrl: resolutionUrl(answer.article), retrievedAt: '2026-09-15T00:00:00.000Z', response: { query: { pages: [{ pageid: index + 1, ns: 0, title: answer.article, pageprops: { wikibase_item: answer.entityId } }] } } };
    cache.pageviews[answer.article] = { sourceUrl: pageviewsUrl(answer.article), retrievedAt: '2026-09-15T00:00:00.000Z', response: { items: MONTHS.map(timestamp => ({ project: 'en.wikipedia', article: answer.article, granularity: 'monthly', timestamp, access: 'all-access', agent: 'user', views: (5 - index) * 100 })) } };
  }
  return { questions, cache };
}

describe('estimated readership scoring', () => {
  it('uses the whole-year median so an isolated news spike does not choose the tier', () => {
    expect(median([10, 12, 8, 11, 9, 10, 100000, 10, 8, 12, 10, 10])).toBe(10);
    expect(median([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])).toBe(6.5);
  });

  it('ranks relative to the complete prompt and emits only supported estimated tiers', () => {
    expect(estimateScores([500, 400, 300, 200, 100]).map(item => item.score)).toEqual([10, 30, 60, 85, 100]);
  });

  it('gives ties the same score independent of input order', () => {
    const values = [100, 10, 30, 10, 100, 30, 50];
    const scored = estimateScores(values);
    expect(scored[0]).toEqual(scored[4]); expect(scored[1]).toEqual(scored[3]); expect(scored[2]).toEqual(scored[5]);
    expect(estimateScores([...values].reverse()).reverse()).toEqual(scored);
  });

  it('does not manufacture rarity when every answer has equal readership, including true zero counts', () => {
    expect(estimateScores([23, 23, 23])).toEqual(Array(3).fill({ score: 10, rarityRank: 0 }));
    expect(estimateScores([0, 0]).map(item => item.score)).toEqual([10, 10]);
  });

  it('rejects missing metrics instead of treating them as zero', () => {
    expect(() => estimateScores([100, undefined])).toThrow('complete valid metric');
    expect(() => estimateScores([100, NaN])).toThrow('complete valid metric');
  });
});

describe('identity and full-year evidence validation', () => {
  it('resolves a redirect and measures its verified canonical title', () => {
    const { questions, cache } = fixture();
    const answer = questions[0].answers[0];
    answer.article = 'Old_Title';
    const record = cache.resolutions.One;
    record.sourceUrl = resolutionUrl(answer.article);
    record.response.query.redirects = [{ from: 'Old Title', to: 'One' }];
    cache.resolutions[normalizeTitle(answer.article)] = record;
    const result = buildCurated(questions, cache);
    expect(result.provenance.questions[0].answers[0].canonicalArticle).toBe('One');
    expect(result.provenance.questions[0].answers[0].pageviews.sourceUrl).toBe(pageviewsUrl('One'));
  });

  it('rejects wrong entities, missing pages, disambiguation pages, and section redirects', () => {
    for (const mutation of [
      record => { record.response.query.pages[0].pageprops.wikibase_item = 'Q999'; },
      record => { record.response.query.pages[0].missing = true; },
      record => { record.response.query.pages[0].pageprops.disambiguation = ''; },
      record => { record.response.query.redirects = [{ from: 'Old', to: 'One', tofragment: 'Section' }]; },
    ]) {
      const { questions, cache } = fixture();
      mutation(cache.resolutions.One);
      expect(() => resolveIdentity(questions[0].answers[0], cache.resolutions.One)).toThrow();
    }
  });

  it('rejects missing, repeated, and out-of-window monthly observations', () => {
    for (const mutation of [
      items => items.pop(),
      items => { items[11].timestamp = MONTHS[0]; },
      items => { items[11].timestamp = '2026010100'; },
    ]) {
      const { cache } = fixture();
      mutation(cache.pageviews.One.response.items);
      expect(() => validateMonthlyViews('One', cache.pageviews.One)).toThrow();
    }
  });

  it('rejects traffic-filter mixups, wrong article series, and invalid counts', () => {
    for (const [field, value] of [['agent', 'all-agents'], ['access', 'desktop'], ['granularity', 'daily'], ['project', 'fr.wikipedia'], ['article', 'Different'], ['views', -1], ['views', null], ['views', '10']]) {
      const { cache } = fixture();
      cache.pageviews.One.response.items[0][field] = value;
      expect(() => validateMonthlyViews('One', cache.pageviews.One)).toThrow();
    }
  });

  it('accepts a complete observed zero series and normalizes month ordering', () => {
    const { cache } = fixture();
    for (const item of cache.pageviews.One.response.items) item.views = 0;
    cache.pageviews.One.response.items.reverse();
    const monthly = validateMonthlyViews('One', cache.pageviews.One);
    expect(monthly).toHaveLength(12);
    expect(monthly[0]).toEqual({ month: '2025-01', views: 0 });
    expect(monthly[11]).toEqual({ month: '2025-12', views: 0 });
  });

  it('fails the entire prompt when any one answer has absent or failed-request data', () => {
    for (const mutation of [
      cache => { delete cache.pageviews.Five; },
      cache => { cache.pageviews.Five.response = { type: 'not-found', status: 404 }; },
      cache => { cache.pageviews.Five.response.items.splice(0, 1); },
    ]) {
      const { questions, cache } = fixture(); mutation(cache);
      expect(() => buildCurated(questions, cache)).toThrow(/Five/);
    }
  });

  it('rejects ambiguous input aliases and duplicate answer identities', () => {
    const { questions } = fixture();
    questions[0].answers[1].aliases.push('ONE');
    expect(() => validateInputs(questions)).toThrow('ambiguous alias');
    questions[0].answers[1].aliases.pop();
    questions[0].answers[1].entityId = 'Q1';
    expect(() => validateInputs(questions)).toThrow('duplicate entity');
  });

  it('builds byte-stable outputs from cached evidence with explicit formula and source series', () => {
    const { questions, cache } = fixture();
    const result = buildCurated(questions, cache);
    expect(JSON.stringify(buildCurated(questions, cache))).toBe(JSON.stringify(result));
    expect(result.prompts[0].scoring).toBe('estimated');
    expect(result.prompts[0].scoringVersion).toBe(SCORING_VERSION);
    expect(result.provenance.policy.redirectPolicy).toContain('not added');
    expect(result.provenance.questions[0].answers.every(answer => answer.monthly.length === 12)).toBe(true);
    expect(result.provenance.inputsSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.provenance.cacheSha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
