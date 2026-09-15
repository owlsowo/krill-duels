# Historical question data

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

The archive says it imports published official reveals and does not routinely human-review those records. We checked score values, page coverage, returned-list counts, uniqueness, and matching for all 83,346 canonical answers. Six lists had more returned records than the dated summary counter because they included older appearances; those complete public lists were retained with provenance. One non-answer editorial import note was excluded. Two museum-name pairs have accent variants with conflicting scores in the same source appearance; exact canonical spellings take priority, and ambiguous normalized aliases do not invent a score. Grouped canonical answer strings remain intact.

## Where Krillion's data comes from

[Krillion's official FAQ](https://krillion.io/faq) describes collecting answer sets from dictionaries, wiki pages, and encyclopedias, followed by merging and cleanup. Rarity scoring can use word/name familiarity data or LLM assistance with manual review. It does not identify a freely downloadable complete original database or promise infinitely many unique generated questions.

Additional public sources checked:

- [Krillion Companion](https://krillion.fun/data-sources/) reports 434 dated prompt appearances and 77,971 answer records. All 84 questions in its complete public practice payload already occur in this catalog.
- [Krillion Game search](https://krillion-game.com/search/) reports 461 prompts and 80,945 answers. Its public non-daily suggestions overlap this index and its dated daily archive covers the same period. No additional question candidate was identified.
- Targeted GitHub searches did not locate the original complete public database. No Outlier code, assets, or data were used.

The app links to its source for every completed question. This independent fan game makes no claim of affiliation, official grading, or current factual accuracy for historical records.
