# Krill Duels

A free, independent rare-answer trivia battle for two friends.

**[Play Krill Duels](https://owlsowo.github.io/krill-duels/)**

Create a room, copy the invite link, and send it to a friend. Both players press Ready to receive the same randomly selected question. Rarer answers earn more points; the score difference damages the lower scorer's HP.

## Rules

- Start with **300 HP** each and **25 seconds** per question.
- Published archive scores: **10, 15, 30, 60, 85, or 100** points. A skipped or missing answer scores zero.
- Damage is the absolute score difference, multiplied by **1× in rounds 1–4**, **2× in rounds 5–7**, and **3× from round 8**.
- Continue until a knockout. There is no seven- or fifteen-round limit. If both survive every question in the selected catalog, the match is a draw.
- Each match shuffles the catalog without repeating a question. Both players press Ready between rounds; a rematch uses a fresh shuffle.
- Case, accents, and ordinary punctuation are normalized. Unlisted answers can be retried while time remains. Ambiguous shortened names are not guessed.

## Questions and provenance

The included catalog contains **48 distinct questions and 2,800 scored answers** from [Krillion Answers](https://krillionanswers.com/), retrieved September 15, 2026. Each selected question includes its complete published scored answer list; this is a selected historical catalog, **not the complete archive or the original paid Unlimited database**.

Questions cover geography, movies, sports, and general knowledge. Only short question text, canonical answers, and recorded scores/tiers are retained. Suggestions, quips, editorial prose, page code, artwork, and broad search-keyword aliases are excluded. Some public question lists merge multiple appearances; historical scores may differ from the current official game and can contain archive errors.

The game serves its own bundled catalog. It does not access Krillion during gameplay, require a Krillion account, or unlock a paid mode. It does not use Outlier code, assets, or data.

See [DATA_SOURCES.md](DATA_SOURCES.md) and [the detailed provenance](public/data-provenance.json). This fan project is not affiliated with or endorsed by Krillion or Krillion Answers.

## How rooms work

The static website is hosted on GitHub Pages. [PeerJS](https://peerjs.com/) provides room discovery through its public signaling service; browsers exchange gameplay state using WebRTC. No game account or custom backend is required.

**Keep both game tabs open.** The host's tab owns the room, timing, and scoring. Closing or refreshing the host tab ends the room. A guest can reconnect to the same invite in the same browser session; a brief disconnect pauses the round for up to 30 seconds before forfeiture.

Some school, work, VPN, or restrictive NAT networks can block direct browser connections. This project does not configure a paid TURN relay; try a different network if the room cannot connect. Availability depends on the signaling service and browser connection support.

Answer commitments are exchanged before answers are revealed, so a regular client cannot wait to see the other answer before choosing. This is casual play: the catalog and code are public, and the host is trusted. It is not a server-authoritative ranked or anti-cheat system.

Names are stored in local browser preferences; a guest reconnection token and pending answer are kept in session storage. Room IDs are random and carried in the invite's URL fragment. Only share your invite with the intended opponent.

## Development

Requires Node.js 24 or newer.

```sh
npm ci
npm run dev
npm test
npm run build
```

GitHub Actions runs the tests, builds the static app, and publishes `dist` to GitHub Pages on pushes to `main`. Pages must use **GitHub Actions** as its source. Vite uses relative asset paths so the game works under the repository subpath.

## Verification

The test suite covers the host state machine, all score tiers, hidden and delayed reveals, duplicate/stale packets, deadline races, rounds beyond 15, unique question scheduling, pool exhaustion, rematches, 29-second reconnects, and every imported canonical answer. The two-player protocol tests use an in-memory PeerJS transport; they do not prove connectivity between every pair of real networks. Production HTML and assets are also checked after deployment.

Optional imperative WebMCP tools share the visible interface's state and actions when a browser supports `document.modelContext`. The adapter has unit-level contract checks. No supported live WebMCP browser context was available for end-to-end verification; ordinary play does not depend on it.

## License

Original application code is MIT-licensed; see [LICENSE](LICENSE). That license does not relicense the third-party archive data in `src/catalog.json` or `public/data-provenance.json`. Those files retain their source attribution; the archive did not publish an explicit reusable dataset license in the terms reviewed. Dependency licenses remain with their respective authors.
