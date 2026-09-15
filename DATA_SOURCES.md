# Question data

The playable bank combines the historical archive below, a documented correction overlay, and a reviewed expansion with estimated scores. Raw source records remain intact. See [catalog maintenance](CATALOG_MAINTENANCE.md) for adding questions and reproducing the scores.

## Historical archive

- Archive: [Krillion Answers](https://krillionanswers.com/)
- Archive methodology: [Data sources](https://krillionanswers.com/data-sources/)
- Terms reviewed: [Terms of use](https://krillionanswers.com/terms/)
- Retrieval date: September 15, 2026
- Included: **461 distinct prompts and 83,346 published scored canonical answers**
- Coverage: all question pages in the cached public archive index; all 56 question URLs in the public sitemap are covered
- Skipped question pages: zero
- Excluded: unscored suggestions, quips, prose, page implementation, art, keyword aliases, and one obvious editorial import artifact

The archive's rare-answer summary contains only selected rare previews. The game instead uses full scored answer lists served by the public question pages. Per-question URLs, public data endpoints, expected and returned counts, retrieval details, appearance IDs, and original response hashes are retained in `public/data-provenance.json`.

The index contained 616 dated appearances and 462 exact prompt spellings. One punctuation variant collapses into an existing question, giving 461 distinct question pages. This covers the indexed public archive at retrieval time; it does not claim access to the original Unlimited database or future additions. Thirteen lists combine records from multiple appearances. `sourceDate` describes the latest appearance listed by the archive, not a uniform date for every answer's score.

The archive says it imports published official reveals and does not routinely human-review those records. We checked score values, page coverage, returned-list counts, uniqueness, and matching for all 83,346 canonical answers. Six lists had more returned records than the dated summary counter because they included older appearances; those complete public lists were retained with provenance. One non-answer editorial import note was excluded. Two museum-name pairs have accent variants with conflicting scores in the same source appearance. The raw records preserve that conflict; the playable correction overlay groups indistinguishable spelling variants at one documented score. Other grouped canonical answer strings remain intact.

## Where Krillion's data comes from

[Krillion's official FAQ](https://krillion.io/faq) describes collecting answer sets from dictionaries, wiki pages, and encyclopedias, followed by merging and cleanup. Rarity scoring can use word/name familiarity data or LLM assistance with manual review. It does not identify a freely downloadable complete original database or promise infinitely many unique generated questions.

Additional public sources checked:

- [Krillion Companion](https://krillion.fun/data-sources/) reports 434 dated prompt appearances and 77,971 answer records. All 84 questions in its complete public practice payload already occur in this catalog.
- [Krillion Game search](https://krillion-game.com/search/) reports 461 prompts and 80,945 answers. Its public non-daily suggestions overlap this index and its dated daily archive covers the same period. No additional question candidate was identified.
- Targeted GitHub searches did not locate the original complete public database. No Outlier code, assets, or data were used.

The app links to its source for every completed question. This independent fan game makes no claim of affiliation, official grading, or current factual accuracy for historical records.

## Reviewed corrections

`src/catalog-corrections.ts` applies `public/catalog-corrections.json` without rewriting the archive. The manifest records removed entries, merged labels, retained scores, explicit aliases, revised rules and supporting sources. Changes cover museum spelling conflicts, element-versus-compound eligibility, the flightless-bird question’s scope, the J/K/V spelling rule, and reviewed country-name alternatives. The overlay does not establish the factual accuracy of all remaining historical records.

Historical grades remain editorial. Duplicate-label merges use the lower recorded score as a conservative reviewed choice, not a new popularity measurement. The live game labels affected prompts **Reviewed archive** and keeps their source links.

## New factual sets and estimated rarity

The reviewed expansion contains **26 questions and 252 accepted entities within those questions**, across literature, music, film, television, institutions, geography, space, science, mathematics, history and sport. The original 24 reviewed sets remain in `data/curated-questions.json`; additional reviewed packs live in `data/question-packs/`. The generated playable bank is `src/curated.json`.

The NASA history pack adds the six Apollo missions that landed astronauts on the Moon and the seven astronauts originally selected for Project Mercury. Membership and formal-name aliases were checked against [NASA's Apollo program overview](https://www.nasa.gov/the-apollo-program/), [Mercury Seven biographies](https://www.nasa.gov/history/mercury-seven-astronaut-biographies/) and [selection history](https://www.nasa.gov/history/60-years-ago-nasa-introduces-mercury-7-astronauts/). The latter set includes Deke Slayton, who was selected for Mercury but did not fly a Mercury mission. Apollo 13 is excluded because it did not land. These questions were written from factual sources; NASA prose, images and logos are not bundled.

Every answer has a verified Wikidata identity and a resolved English Wikipedia article. Eligibility comes from each question’s cited factual sources, not from the existence of its Wikipedia page. Clear rules define dates, categories, exclusions and accepted alternate names.

Scores are estimates of relative English Wikipedia readership within each question, using the median of twelve monthly human/all-access counts during **2025**. They are not survey results, player-answer probabilities, or official Krillion grades. The build rejects missing metrics rather than treating them as rare. Equal metrics get equal points; the subjective 15-point tier is not used for new questions.

`data/pageviews-2025.json` preserves the raw API responses and `public/curated-provenance.json` records the full scoring policy, per-answer monthly counts, medians, ranks, source URLs, identities and snapshot hashes. [Scoring documentation](scripts/CURATED_SCORING.md) describes the exact formula and its limitations. Builds and gameplay use the frozen data locally; there are no Wikipedia requests during a game.

Wikidata structured facts and Wikimedia Analytics data are CC0 under their [respective](https://www.wikidata.org/wiki/Wikidata:Licensing) [terms](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/documentation/access-policy.html). This does not relicense the separate historical archive.

The companion at [krillionio.com](https://krillionio.com/) was inspected for question ideas: 42 free prompts, many narrower variants of existing themes, with editorial scoring. Its scores, page prose and implementation were not imported into this expansion.
