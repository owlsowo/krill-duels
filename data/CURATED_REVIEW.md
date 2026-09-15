# Curated question review

Reviewed 15 September 2026. The first release contains **24 new prompts and 239 answer entities**. These are independently written, finite questions with explicit eligibility rules. They do not reuse Krillion or answer-archive editorial scores.

## What the input records mean

`curated-questions.json` is the reviewed input to the scoring build. Each prompt contains its eligibility references and retrieval date. Each answer has a display name, conservative accepted aliases, a Wikidata entity ID and an English Wikipedia article title. The title identifies the subject whose public pageview history is used by the separate scorer; it does not itself prove eligibility.

The article titles and Wikidata IDs were resolved through the English Wikipedia MediaWiki API (`action=query`, `prop=pageprops`, `redirects=1`), then independently rechecked by the scoring build. All 239 titles resolved to individual, unambiguous articles with Wikidata IDs. IDs were retrieved, never guessed. Missing Wikidata statements were not interpreted as evidence that an answer is ineligible.

Answer eligibility was checked against the listed organization, publisher, government, award body, scientific authority or specialist institution. Only facts and names are recorded; source explanations, illustrations, editorial rankings and full tables are not copied. Wikidata's structured entity data is published under [CC0](https://www.wikidata.org/wiki/Wikidata:Licensing). That license is not a claim about the prose or media on the separate eligibility-reference sites. See [the scoring documentation](../scripts/CURATED_SCORING.md) for metric provenance and limitations.

## Scope checks

| Set | Answers | Review boundary |
| --- | ---: | --- |
| Austen novels | 6 | Six completed major novels; short fiction and unfinished works excluded. No publication-year ambiguity. |
| Narnia books | 7 | Original C. S. Lewis novels, checked against the official collection description. |
| Booker winners | 26 | Award years 2000–2024; both 2019 joint winners included. International Booker excluded. |
| ABBA albums | 9 | Original studio albums through 2025; compilations, live releases and reissues excluded. |
| Henry VIII's wives | 6 | The six queens consort, including annulled marriages; standard Catherine/Katherine spellings accepted. |
| Original numbered Doctor actors | 14 | Every original actor in the official First–Fifteenth Doctor profiles. David Tennant occupies two numbered roles but one answer. Recastings and unnumbered incarnations excluded. |
| Mission: Impossible films | 8 | Theatrical films from 1996–2025; distinctive subtitles and commonly used film numbers accepted. |
| Animated feature Oscar winners | 24 | Winners individually checked in the Academy's **ceremony** pages for 2002–2025, rather than inferring winners from nominations or film years. |
| UN principal organs | 6 | UN Charter organs, including the suspended Trusteeship Council. |
| EU institutions | 7 | Treaty institutions; the two councils remain separate, and the European Court of Justice alone is not equated with the whole CJEU institution. |
| Canada | 13 | Ten provinces and three territories. |
| Australia | 8 | Six states and two self-governing mainland territories. Jervis Bay and external territories excluded. |
| NATO founders | 12 | Signatories on 4 April 1949. |
| Space Shuttle orbiters | 5 | Orbiters that reached space; Enterprise excluded because its flights were atmospheric tests. |
| Great Observatories | 4 | NASA's original four-program set, not every large space telescope. |
| Essential amino acids | 9 | Indispensable adult dietary amino acids, excluding conditionally essential ones. |
| Nucleobases | 5 | Canonical DNA/RNA bases, excluding modified bases and nucleosides. |
| Cranial nerves | 12 | Conventional I–XII names, excluding individual branches and the terminal nerve. |
| Millennium problems | 7 | Original Clay Institute list; Poincare included even though solved. |
| Phanerozoic periods | 12 | Global ICS v2026/06 periods. Carboniferous is one period; its subperiods do not become extra answers. |
| Rock Hall inaugural performers | 10 | 1986 Performer category, excluding early influences and non-performer awards. The Everly Brothers count as one act. |
| F1 constructors | 15 | Title-winning chassis constructors through 2025, including BRM. FIA historical results through 2024 plus final official 2025 standings close the time range. Sponsor/engine variants do not create extra entities. |
| Nobel categories | 6 | Five original categories plus the economic sciences memorial prize, which the prompt explicitly includes. |
| Bear species | 8 | International Association for Bear Research and Management species list; subspecies and hybrids excluded. |

## Reuse and maintenance

The original 461 archived prompt texts were checked for equivalent intent before choosing these sets. Broad existing topics may contain some of the same entities, but none asks the same new question. Numbered symphonies and a narrower Premier League club subset were replaced with distinct named-answer subjects.

For updates, review the complete eligible set against the source and the stated boundary before editing answers. Then rerun the scorer, which checks article identity, aliases and complete cached metrics. A successful metric fetch establishes usable popularity data, not factual membership. The English Wikipedia pageview estimate is not a measured human recall rate, worldwide familiarity survey or official Krillion score. Narrow answer sets can still span very different levels of actual recall.
