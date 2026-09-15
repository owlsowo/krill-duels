# Reviewed questions and estimated scores

The extra question inputs are hand-reviewed factual sets in `data/curated-questions.json`. Each answer names a Wikidata entity and an English Wikipedia article. Factual references establish membership; Wikipedia traffic only estimates relative familiarity for scoring.

## Reproduce without network access

From the repository root:

```sh
node scripts/build-curated.mjs --check
node scripts/build-curated.mjs
```

The first command checks that the committed outputs match the committed inputs and metrics. The second regenerates `src/curated.json` and `public/curated-provenance.json`. Both use only `data/pageviews-2025.json`; neither calls an external service. Ordinary app builds and gameplay do not fetch metrics.

To obtain missing source evidence after reviewing new inputs:

```sh
node scripts/build-curated.mjs --fetch
```

Fetches are sequential, separated by at least 250 ms, limited to 500 distinct input articles, and checkpointed after each verified article. Cached records are reused. Transient failures receive at most three attempts; HTTP errors and incomplete results never become zero counts. To deliberately replace an observation, remove its cached record and fetch again, then review the output diff. Do not edit raw counts to make a build pass.

## Frozen method

Version: `enwiki-human-2025-median-rank-v1`.

1. Resolve each supplied article title through the English Wikipedia Action API. Require a mainspace article with the exact supplied Wikidata entity. Reject missing pages, disambiguation pages, and section redirects.
2. Request **all-access, user, monthly** English Wikipedia pageviews for **January–December 2025**. Validate all twelve unique month timestamps, article, project, traffic filters, and nonnegative integer counts.
3. Take the median of the twelve monthly counts (mean of the sixth and seventh sorted values). Rank that median against the other accepted answers in the same question.
4. Let `greater` be the number of answers with a greater median, `tied` the number with the same median, and `n` the complete number of accepted answers. Compute `(greater + (tied - 1) / 2) / (n - 1)`. Equal metrics get equal ranks and points, regardless of input order.
5. Ranks below `0.25`, `0.5`, `0.75`, and `0.9` receive **10**, **30**, **60**, and **85** points; other ranks receive **100**. If all medians are equal, every answer receives **10**. There is no subjective 15-point tier.

If any answer lacks valid identity or complete metrics, the entire build fails. A failed fetch or missing month is never interpreted as an unpopular answer. Complete series containing actual zero observations are valid; an all-zero question still receives the all-equal treatment.

The cache retains the exact API responses, source URLs, and retrieval timestamps. The public provenance records factual sources, canonical titles, resolved identities and redirect chains, twelve raw monthly counts per answer, medians, ranks, assigned points, formula, version, source-data hashes, and limitations. Stable cached inputs produce byte-identical outputs.

## What the estimate means

Points describe **relative English Wikipedia readership within this question**. They are not measured player-answer frequencies, percentages, or a universal rarity scale. Editorial changes, article scope, news, geography, English-language bias, and undetected automation can influence readership. A median reduces one-off spikes without eliminating these effects.

Only the resolved canonical title is measured. Traffic separately recorded under alternate redirect titles is not added. A title move can therefore affect the historical series. The identity check prevents accidentally scoring an input redirect page as though it were the intended article.

Source documentation:

- [Pageview API reference](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/reference/page-views.html)
- [Pageview definition, automated traffic, and redirects](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/concepts/page-views.html)
- [Action API redirect resolution](https://www.mediawiki.org/wiki/API:Query#Resolving_redirects)
- [API access and CC0 data license](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/documentation/access-policy.html)

Tests: `npx vitest run tests/curated-scoring.test.mjs` covers ties, all-equal metrics, spikes, identity mismatches, redirects, missing/duplicated months, wrong traffic filters, malformed counts, and deterministic provenance.
