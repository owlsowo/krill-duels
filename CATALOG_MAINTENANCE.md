# Maintaining the question bank

Answer eligibility and answer points are separate decisions. A low-readership article does not prove its subject belongs in a question, and a valid answer does not imply any particular rarity.

## Historical questions and corrections

`src/catalog.json` and `public/data-provenance.json` preserve the imported historical records. Do not overwrite them to hide a correction. `src/catalog-corrections.ts` applies reviewed changes when the playable catalog loads; `public/catalog-corrections.json` records their reasons and evidence. Corrected questions are labeled **Reviewed archive** in the game. Unchanged scores remain historical editorial grades, including the special 15-point and 100-point choices.

Use one canonical answer with explicit aliases for equivalent names. A synonym must satisfy the question's naming rules; do not automatically add every country abbreviation to a spelling, length, or initial-letter question. Ambiguous aliases must not resolve to a convenient score. Preserve the conservative typo-suggestion limits in `src/match.ts`; the question bank is not a hint generator.

## New reviewed questions

Author new entries in `data/curated-questions.json`:

- Define an independently useful question with a manageable, complete answer set. Check the existing bank for equivalent questions, not just identical wording.
- Record factual sources, the review date, and precise inclusion rules. Specify a completed date range for changing lists. Missing database statements do not establish that an answer is invalid.
- Give each answer a verified Wikidata entity ID, its English Wikipedia article title, and unambiguous accepted aliases. Multiple names for one entity share one score within a question.
- Review every accepted entity against the stated rules. Article existence establishes identity, not eligibility.
- Keep accepted examples and answer lists out of `rules`: the game displays that text before the player answers.

## Reproducible estimated scores

The new bank uses the `enwiki-human-2025-median-rank-v1` scoring policy. This is an estimate of familiarity relative to the other eligible answers in a question. It is not a player survey or an official Krillion grade.

The build resolves each supplied article title to its canonical English Wikipedia article and checks the Wikidata identity. It requires all twelve monthly human/all-access pageview counts for January–December 2025. The median monthly count reduces the influence of a single news spike. Each answer's rank uses the number of answers with larger medians and half the other answers tied with it, divided by the number of other answers. Rank thresholds of 0.25, 0.50, 0.75, and 0.90 map to 10, 30, 60, 85, and 100 points. Equal metrics earn equal points; if every metric is equal, every answer earns 10.

Missing months, failed requests, identity mismatches, and disambiguation pages stop generation. They never become zero views or an automatic 100-point answer. The cache stores actual API responses, source URLs, and retrieval times; generated provenance includes raw monthly counts, medians, ranks, policy, factual sources, and input/cache hashes.

Canonical-title readership omits traffic recorded under other redirect names. Page moves, news, geography, language, and undetected automated traffic can affect the estimate. Do not present these scores as universal obscurity or measured answer probabilities. Keep the scoring window fixed for a release. A new measurement window or formula requires a new scoring version and review.

### Commands

```sh
# Fetch only missing evidence for reviewed inputs, with bounded requests.
npm run catalog:fetch

# Rebuild solely from the checked-in cache; no network requests.
npm run catalog:build

# Verify generated outputs are identical to the inputs and frozen cache.
npm run catalog:check

# Verify matching, corrections, scoring edge cases, and both game engines.
npm test
npm run build
```

Commit `data/curated-questions.json`, `data/pageviews-2025.json`, `src/curated.json`, and `public/curated-provenance.json` together. Normal tests and builds check these files offline. Gameplay makes no requests to Wikipedia or Wikidata. Both players' catalog hashes include the playable corrections and new questions, preventing different releases from silently disagreeing on scores.

## Future calibration

Before replacing the estimated model with player measurements, collect first-answer responses with scores hidden and record the audience and sample sizes. Ordinary rare-answer gameplay encourages intentionally obscure choices and is a biased familiarity sample. Unseen answers and small samples must not automatically receive maximum rarity.

## Source terms

- Wikidata structured data is [CC0](https://www.wikidata.org/wiki/Wikidata:Licensing).
- Wikimedia Analytics API data is [CC0](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/documentation/access-policy.html).
- Factual eligibility references are retained per question. Their prose and site assets are not copied into the game.
- The original archive files retain their separate source attribution and are not relicensed by these additions.
