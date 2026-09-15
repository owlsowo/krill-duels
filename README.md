# Krill Duels

Free rare-answer trivia for solo practice or a private battle with a friend.

**[Play the HTTPS edition](https://krill-duels-play.owlsowo1.chatgpt.site/)**

[Original GitHub Pages edition](https://owlsowo.github.io/krill-duels/)

Choose **Solo practice** to play immediately, or **Create duel** to set your rules and send an invite link to a friend. Both duel players press Ready to receive the same randomly selected question. Rarer answers earn more points; the score difference damages the lower scorer's HP.

## Rules

- Set **100–10,000 starting HP** and **15, 25, 45, 60, or 90 seconds** per question. Defaults are 300 HP and 25 seconds. Both players share the host's settings, which stay fixed for the match and rematch.
- Published archive scores: **10, 15, 30, 60, 85, or 100** points. A skipped or missing answer scores zero.
- Choose **steady 1× damage**, or increasing damage: **1× in rounds 1–4**, **2× in rounds 5–7**, and **3× from round 8**. Damage is the absolute score difference times that multiplier.
- Continue until a knockout. There is no seven- or fifteen-round limit. If both survive every question in the catalog, the match is a draw.
- Each match shuffles the catalog without repeating a question. Both players press Ready between rounds; a rematch uses a fresh shuffle.
- Canonical spellings take priority. Case, accents, and ordinary punctuation are normalized when unambiguous. Unlisted answers can be retried while time remains; ambiguous shortened names are not guessed. A few archive spelling variants carry conflicting historical scores, so their exact published spellings keep their recorded score.
- **Spelling suggestions:** an unrecognized answer can offer up to three close spellings from the current question. Select a suggestion, then press **Lock in** to confirm; the timer keeps running. For example, `alluminum` can suggest `Aluminum` (or `Aluminium` when that is the archive spelling). Suggestions run locally, handle small typos and adjacent letter swaps, and do not change scoring or automatically submit an answer. Very short or unrelated guesses receive no suggestions.
- **Solo practice** uses the selected timer, tracks total points, and shows answer scores immediately. Skip or time out for zero points, then advance when ready. Complete the bank without repeats, or return to setup whenever you like; no room or live connection is required after the site loads.

## Questions and provenance

The catalog contains **461 distinct questions and 83,346 scored answers** from [Krillion Answers](https://krillionanswers.com/), retrieved September 15, 2026. It covers every normalized question page in the public archive index and every question URL in its public sitemap, with zero skipped pages. Repeated appearances are deduplicated. This is the complete indexed public archive at retrieval time, **not the original paid Unlimited database**.

Questions cover geography, movies, sports, and general knowledge. Only short question text, canonical answers, and recorded scores/tiers are retained. Suggestions, quips, editorial prose, page code, artwork, and broad search-keyword aliases are excluded. Thirteen public question lists merge multiple appearances; historical scores may differ from the current official game and can contain archive errors.

The game serves its own bundled catalog. It does not access Krillion during gameplay, require a Krillion account, or unlock a paid mode. It does not use Outlier code, assets, or data.

See [DATA_SOURCES.md](DATA_SOURCES.md) and [the detailed provenance](public/data-provenance.json). This fan project is not affiliated with or endorsed by Krillion or Krillion Answers.

## How this HTTPS edition works

This edition runs the game through its own website API at `/api/duel`. Both players use ordinary HTTPS requests; there is no browser-to-browser connection or dependency on PeerJS, STUN, or TURN. Both players must use invites from the same site. The original GitHub Pages edition remains a separate room network.

The server owns the shuffle, timer, and scoring. D1 persists rooms so different Worker instances see the same game. Updates use an atomic revision check; duplicate answers cannot replace a lock, and older responses cannot overwrite newer state. Only public game snapshots leave the server. Submitted answers and future question order stay private until the round resolves.

Keep both tabs open while playing. A player missing for 12 seconds pauses the round, with a further 30 seconds to reconnect. Refreshing preserves your seat in the same browser tab; choosing Leave forfeits it. If both players disappear past the grace period, the duel ends as a draw. Rooms expire after one hour of inactivity and are removed during subsequent room creation. No account is required. Names, answers and game state are temporarily stored in the room database; seat secrets remain in browser session storage and are stored only as hashes on the server.

This is casual play between friends. The question catalog is public, and this does not try to prevent a player from looking up answers.

## Development

Requires Node.js 24 or newer.

```sh
npm ci
npm test
npm run build
node node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_nasty_pete_wisdom.sql
npm run start
```

The build preserves the original vanilla TypeScript/Vite interface. Static assets go in `dist/client` and the Worker entrypoint in `dist/server/index.js`. Sites provisions the logical `DB` binding from `.openai/hosting.json` and applies the generated SQL migrations. The Wrangler database ID is a local-development placeholder.

## Verification

SQL-backed API tests cover simultaneous Ready and answer requests, atomic-update conflicts, exactly-once results, hidden drafts, stale commands, late deadlines, host/guest disconnects, rematches, expired rooms, and session authentication. Browser checks run two independent Chrome sessions with WebRTC blocked, including a full round and narrow-screen solo spelling suggestions. These checks do not reproduce the friend's China network; that final reachability check must happen there.

The existing practice, scoring, catalog, and spelling tests remain included. Spelling suggestions handle only small typos, require a separate Lock in confirmation, and are never a general answer-hint search.

## License

Original application code is MIT-licensed; see [LICENSE](LICENSE). That license does not relicense the third-party archive data in `src/catalog.json` or `public/data-provenance.json`. Those files retain their source attribution; the archive did not publish an explicit reusable dataset license in the terms reviewed. Dependency licenses remain with their respective authors. Fonts are served with the game to avoid an external Google Fonts request; their OFL notices are preserved in [font-licenses.txt](public/font-licenses.txt).
