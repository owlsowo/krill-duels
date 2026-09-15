# Alternate-name audit — 15 September 2026

## Finding

The imported bank often stored only one display name for an answer. Case and punctuation normalization could not recognize genuine alternatives such as **Word / Microsoft Word**, **aubergine / eggplant**, or **NES / Nintendo Entertainment System**. Relaxing typo matching would not be a reliable fix for these names.

We scanned all **485 playable questions and 83,561 answer entries** at baseline commit `8732e7dcabf80d7ae41d1ea9abbead1ab24427b5`. Only **41 questions** had any explicit aliases before this pass. That is an inventory finding, not evidence that all the other questions need aliases.

## Changes

- **82 historical questions:** 325 newly accepted name-to-answer mappings across 221 existing answer rows and 101 reviewed identities. Repeated aliases in different questions count separately; the archive additions contain 147 distinct input strings.
- **1 curated question:** four missing forms for United States and United Kingdom in the NATO founding-members question.
- **Total: 83 questions, 329 accepted-name mappings added.** No answer rows, canonical display names, or scores changed.
- Each historical mapping is recorded in `public/catalog-corrections.json` under `answerAliases`, release `reviewed-2026-09-15.3`, with a reason and factual sources. Curated changes live in `data/curated-questions.json`; the frozen 2025 scoring outputs were regenerated offline.

| Area | Examples now accepted |
| --- | --- |
| Countries | Côte d’Ivoire, Cape Verde, East Timor, Czech Republic/Czechia, Türkiye, UAE, UK |
| Museums | Museum of Modern Art → MoMA; Metropolitan Museum of Art → The Met; V&A → Victoria and Albert Museum |
| Food | aubergine → Eggplant; courgette → Zucchini; rocket → Arugula; garbanzo bean → Chickpea; broad bean → Fava bean |
| Science and animals | aluminium, sulphur, caesium, epinephrine, noradrenaline, hippo, puma, killer whale |
| Sports | Man Utd, Man City, Spurs in the Premier League question, LA Clippers |
| Film and characters | Zootropolis; Avengers Assemble; A New Hope; Albus Dumbledore; Rubeus Hagrid |
| Consoles | NES, SNES, PS1, PS3, PSP, PS Vita, Mega Drive |
| Software | Word, Excel, VS Code, Docs, JS, TS, C sharp, F sharp, Golang, Linux Mint, ChromeOS |

## Review method and checks

1. Inventory every question and answer, then target common regional spellings, alternate titles, abbreviations, full names and missing product-name variants.
2. Review the selected entities across their exact occurrences in the bank. Confirm identity using official publishers, institutions, standards bodies, government references, scientific organizations or classification authorities. Sources are attached to each mapping; this audit did not copy external answer banks or source prose.
3. Evaluate each proposed input with the actual `AnswerIndex` before editing. All 325 historical mappings rejected in the baseline and resolve to their intended existing answer after the combined change. Check proposals together to catch collisions between independently reviewed groups.
4. Preserve each question’s own score. For example, Raiders of the Lost Ark keeps 10 in the Harrison Ford question and 30 in the Spielberg question.
5. Run permanent catalog-wide checks and independent player-input regressions. Canonical answers, alias identity, preserved scores, idempotent corrections, spelling-rule boundaries, distinct programs/languages and local product names are covered. Solo play and duels share the tested scoring function.

## Boundaries and unresolved cases

This was an automated inventory plus a targeted source review, not a full factual or semantic review of every one of the 83,561 answer entries. More legitimate names may still be missing.

- Names must satisfy the prompt. **Aluminum** remains invalid for a name ending in **-ium**; **Caesium** is valid. **Puma** is not added to an animal-name question requiring G, and **Orca** is not added to one requiring K. Many country-name questions were excluded conservatively rather than expanding their accepted spellings automatically.
- Do not infer aliases from generic words, global word reordering, arbitrary surnames, publisher-prefix stripping, or relaxed spelling distance. **Java / JavaScript**, **Visual Studio / Visual Studio Code**, and **ChromeOS / ChromiumOS** remain distinct.
- **Korea**, **Congo**, **America**, **England**, **Panther**, bare **Manchester**, and **PSX** need context; this pass adds no such guesses. Existing unrelated aliases are not claimed to have been fully re-reviewed.
- The museum bank has unresolved semantic duplicates or broader labels, including **Whitney / Whitney Museum of American Art**, **Guggenheim / Solomon R. Guggenheim Museum**, and **Getty / Getty Center**. Some carry different scores; merging them needs a separate identity and scoring decision.
- No existing Philosopher’s Stone / Sorcerer’s Stone answer was found to alias. Missing entities require answer-set review. Likewise, this pass does not validate the inherited eligibility of every item, such as Resident Evil in a PlayStation-exclusive-game question.

For the complete accepted mappings and their evidence, see the correction manifest. This report’s counts refer to this release’s additions, not the pre-existing ship or United States aliases.
