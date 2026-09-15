# Maintaining the question bank

Answer eligibility and answer points are separate decisions. A low-readership article does not prove its subject belongs in a question, and a valid answer does not imply any particular rarity.

## Historical questions and corrections

`src/catalog.json` and `public/data-provenance.json` preserve the imported historical records. Do not overwrite them to hide a correction. `src/catalog-corrections.ts` applies reviewed changes when the playable catalog loads; `public/catalog-corrections.json` records their reasons and evidence. Corrected questions are labeled **Reviewed archive** in the game. Unchanged scores remain historical editorial grades, including the special 15-point and 100-point choices.

Use one canonical answer with explicit aliases for equivalent names. A synonym must satisfy the question's naming rules; do not automatically add every country abbreviation to a spelling, length, or initial-letter question. Ambiguous aliases must not resolve to a convenient score. Preserve the conservative typo-suggestion limits in `src/match.ts`; the question bank is not a hint generator.

For missing alternate names, add a question-specific entry to `answerAliases` in the correction manifest. Record the existing canonical answer, accepted aliases, stable identity, reason and factual sources. Alias-only additions keep the canonical name, historical score and historical scoring label. For example, “Ship of Theseus” and “Theseus's ship” identify the same answer in the famous-ship question; this is an explicit synonym, not a spelling-distance exception. Do not strip ship prefixes or reorder words globally. Run the catalog tests to catch aliases that collide with another answer.

The [September 2026 alternate-name audit](data/ALIAS_AUDIT.md) records the broader review, examples and unresolved ambiguities. For each new batch, verify that proposed names actually reject before the change, combine proposals before checking normalized-name collisions, and test ordinary player inputs independently of the manifest. Review the same entity across all relevant questions while preserving each question’s existing score. Update curated aliases in their reviewed input and regenerate them with `catalog:build`; they do not use the historical correction overlay.

## New reviewed questions

The original reviewed sets stay in `data/curated-questions.json`. Author additions as small packs under `data/question-packs/`; the build combines them in filename order after the original sets. To start a draft:

```sh
node scripts/new-question-pack.mjs your-pack-name
```

This creates `data/question-drafts/your-pack-name.json` with `status: "draft"` and incomplete review fields. Drafts are outside the build inputs, and the command refuses to overwrite existing files. It does not research facts, invent identities or generate publishable questions.

Before promoting a pack:

- Define an independently useful question with a manageable, complete answer set. Check the existing bank for equivalent questions, not just identical wording.
- Record factual sources, the review date, and precise inclusion rules. Specify a completed date range for changing lists. Missing database statements do not establish that an answer is invalid.
- Give each answer a verified Wikidata entity ID, its English Wikipedia article title, and unambiguous accepted aliases. Multiple names for one entity share one score within a question.
- Review every accepted entity against the stated rules. Article existence establishes identity, not eligibility.
- Keep accepted examples and answer lists out of `rules`: the game displays that text before the player answers.

The pack envelope has `schemaVersion: 1`, a lowercase hyphenated `id` matching the filename, a descriptive `title`, `status: "reviewed"`, and a `questions` array. Each question uses the original input schema: `id` beginning `curated-`, `category`, `prompt`, `rules`, `reviewedAt`, `sources` (title and HTTPS URL), and `answers` (canonical `answer`, `aliases`, exact verified `entityId`, and English Wikipedia `article`). Record source retrieval dates too. See `data/question-packs/nasa-history.json` for a complete example.

After manual source review, set `status` to `reviewed` and move the file into `data/question-packs/`. The build rejects active drafts, malformed packs, duplicate question IDs and normalized question text across all reviewed inputs and the original/corrected archive. It also rejects conflicting aliases within an answer set. Different wording for the same question still needs manual overlap review. Limits are 100 packs, 100 questions per pack, 2,000 reviewed questions overall, 200 answers per question and 2 MiB per reviewed input file; they bound mistakes without imposing the old 40-question ceiling.

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

Commit the reviewed input changes in `data/curated-questions.json` or `data/question-packs/`, `data/pageviews-2025.json`, `src/curated.json`, and `public/curated-provenance.json` together. Provenance records each input file's hash and each pack's question IDs. Normal tests and builds check these files offline. Gameplay makes no requests to Wikipedia or Wikidata. Both players' catalog hashes include the playable corrections, new questions and reviewed hint content, preventing different releases from silently disagreeing.

## Reviewed context hints

`data/prompt-hints.json` supplies exactly three progressively more specific context hints for every playable question. New question packs must include corresponding entries in this hint file before release. Write useful background or narrowing context from reliable factual sources; never generate clues by exposing answer names, prefixes or sampled answer lists. `tests/hints.test.ts` rejects literal accepted-name leaks. That mechanical check cannot assess whether a clue is useful, progressively specific or an indirect giveaway, so manual review remains required. The regression suite requires full catalog coverage and checks that every actual question renders and unlocks all three levels in both practice and duels. Hint content participates in the exact catalog hash used by both players.

## Future calibration

Before replacing the estimated model with player measurements, collect first-answer responses with scores hidden and record the audience and sample sizes. Ordinary rare-answer gameplay encourages intentionally obscure choices and is a biased familiarity sample. Unseen answers and small samples must not automatically receive maximum rarity.

## Source terms

- Wikidata structured data is [CC0](https://www.wikidata.org/wiki/Wikidata:Licensing).
- Wikimedia Analytics API data is [CC0](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/documentation/access-policy.html).
- Factual eligibility references are retained per question. Their prose and site assets are not copied into the game.
- The original archive files retain their separate source attribution and are not relicensed by these additions.
