# Hint gameplay evaluation — 2026-09-15

## Problem and change

The previous 487-question hint set mainly described categories. For example, knowing that Wes Anderson uses carefully composed shots does not help someone name one of his films.

Hints now select one reviewed accepted answer worth 30 or 60 points and progressively reveal its spelling. The first hint reveals roughly 40% of its letters/digits, the second roughly 70%, and the third all but one character. The target stays the same. Its score is visible before purchase, and independently chosen answers remain valid.

Example: `Bo____ Ro____` → `Bott__ Rock__` → `Bottl_ Rocket`.

## Gameplay simulation

- Sample: 24 real questions spanning films, geography, people, food, technology, literature, science and other subjects.
- Baseline review: a model received the old question/hint text without the answer bank. It rated 22 of 24 opening hints as generic. These are qualitative judgments, not a human study.
- Revised test: a fresh model received only the first-stage file, saved its guesses, then received the second stage and finally the third. Earlier guesses were frozen before the next stage. It received neither accepted-answer lists nor future clues.
- The resulting 72 stage/guess pairs were replayed through the actual `PracticeSession` and `DuelEngine`, including commitment/reveal scoring. All matched valid answers at the displayed score, with the expected hint HP charges and round damage.
- All 24 first-stage guesses were already correct for this model. This demonstrates concrete guidance for a knowledgeable model, not a measured improvement in novice solve rate. In the old-hint baseline, the model already had valid initial answers for 23 of 24 questions.

## Browser gameplay

Headless Chrome loaded the actual application with a fixed pool of the same 24 questions; no answer or hint logic was replaced. Local PeerJS signaling connected two real WebRTC browser contexts for duel checks.

- Completed one continuous 24-question solo run at a 390px mobile viewport, alternating one, two and three hint purchases before submitting recorded model guesses.
- Checked real duel controls at 1280px and 390px: 15/30/45 HP purchases, per-player clue separation, correct scoring and the next question's 60 HP price.
- Typed drafts and deadlines survived purchases. New questions reset the clue level; costs continued through the match.
- No page exceptions or horizontal overflow across 26 viewport checks. Inspected mobile and desktop screenshots.
- The automated suite separately covers rematch cost resets, repeated purchase requests, insufficient HP and deadline restrictions.

## Catalog and limits

All 487 selected targets resolve against the corrected answer catalog: 146 score 30 points and 341 score 60. Every question has three strictly growing patterns. Full catalog tests check the exact target, score, character positions, punctuation and final single blank. UI and accessible text expose only purchased letters; status tools expose only purchased stages.

Targets received a broad editorial review, including replacing misleading historical rows chosen by the initial heuristic. That is not a fresh factual audit of every underlying archive question. Clue generation makes no factual claims beyond the existing accepted target and its spelling.

Costs retain the agreed escalation. At 300 HP, all three initial purchases cost 90 HP, so buying every hint is not always profitable. Compared with blanking, a first 15-HP hint rescuing 30 or 60 points improves the HP margin by 15 or 45 at 1× damage. A full 90-HP rescue can be worse at 1×; later damage multipliers change that tradeoff. The displayed score and next price make the choice inspectable.

Human feedback is still needed on recognition difficulty. Letters now offer a direct route to a valid answer even when category background was unhelpful, but first-stage usefulness depends on familiarity with that answer.
