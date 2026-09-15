# Krill Duels

Free rare-answer trivia for solo practice or a private battle with a friend.

**[Play Krill Duels](https://owlsowo.github.io/krill-duels/)** · **[Alternate HTTPS version](https://krill-duels-play.owlsowo1.chatgpt.site/)**

Choose **Solo practice** to play immediately, or **Create duel** to set your rules and send an invite link to a friend. Both duel players press Ready to receive the same randomly selected question. Rarer answers earn more points; the score difference damages the lower scorer's HP.

## Rules

- Set **100–10,000 starting HP** and **15, 25, 45, 60, or 90 seconds** per question. Defaults are 300 HP and 25 seconds. Both players share the host's settings, which stay fixed for the match and rematch.
- Published archive scores: **10, 15, 30, 60, 85, or 100** points. A skipped or missing answer scores zero.
- Choose **steady 1× damage**, or increasing damage: **1× in rounds 1–4**, **2× in rounds 5–7**, and **3× from round 8**. Damage is the absolute score difference times that multiplier.
- Continue until a knockout. There is no seven- or fifteen-round limit. If both survive every question in the catalog, the match is a draw.
- Each room shuffles the catalog once. Both players press Ready between rounds; Play again continues with unused questions across rematches. A fresh shuffle starts after the whole bank has been played.
- Canonical spellings take priority. Case, accents, and ordinary punctuation are normalized when unambiguous. Unlisted answers can be retried while time remains; ambiguous shortened names are not guessed. A few archive spelling variants carry conflicting historical scores, so their exact published spellings keep their recorded score.
- **Spelling suggestions:** an unrecognized answer can offer up to three close spellings from the current question. Select a suggestion, then press **Lock in** to confirm; the timer keeps running. For example, `alluminum` can suggest `Aluminum` (or `Aluminium` when that is the archive spelling). Suggestions run locally, handle small typos and adjacent letter swaps, and do not change scoring or automatically submit an answer. Very short or unrelated guesses receive no suggestions.
- **Solo practice** uses the selected timer, tracks total points, and shows answer scores immediately. Skip or time out for zero points, then advance when ready. Complete the bank without repeats, or return to setup whenever you like; no room or live connection is required after the site loads.

## Questions and provenance

The original archive contains **461 distinct questions and 83,346 scored answers** from [Krillion Answers](https://krillionanswers.com/), retrieved September 15, 2026. It covers every normalized question page in the public archive index and every question URL in its public sitemap, with zero skipped pages. Repeated appearances are deduplicated. This is the complete indexed public archive at retrieval time, **not the original paid Unlimited database**.

The playable bank applies documented corrections to that archive and adds **24 reviewed questions**, for **485 questions** total. New questions use fixed 2025 English Wikipedia readership estimates; historical questions retain their editorial grades. Equivalent reviewed names share a score. The question and answer sheet show which scoring method applies.

Questions cover geography, movies, sports, and general knowledge. A room keeps its unused question order across Play again/rematches; HP, round numbers and damage scaling reset for each battle. Skipped, timed-out or already shown questions count as used. A new shuffle starts only after the whole bank is exhausted, or when creating a new room. HTTPS rooms persist this progress across refreshes and reconnections; the GitHub Pages host must keep its tab open. Only short question text, canonical answers, and recorded scores/tiers are retained. Suggestions, quips, editorial prose, page code, artwork, and broad search-keyword aliases are excluded. Thirteen public question lists merge multiple appearances; historical scores may differ from the current official game and can contain archive errors.

The game serves its own bundled catalog. It does not access Krillion during gameplay, require a Krillion account, or unlock a paid mode. It does not use Outlier code, assets, or data.

See [DATA_SOURCES.md](DATA_SOURCES.md), [historical provenance](public/data-provenance.json), [reviewed corrections](public/catalog-corrections.json), and [estimated-score provenance](public/curated-provenance.json). [CATALOG_MAINTENANCE.md](CATALOG_MAINTENANCE.md) explains the reviewed input format and offline reproduction workflow. This fan project is not affiliated with or endorsed by Krillion or Krillion Answers.

## How rooms work

The static website is hosted on GitHub Pages. [PeerJS](https://peerjs.com/) provides room discovery through its public signaling service; browsers exchange gameplay state using WebRTC. No game account or custom backend is required.

**Keep both game tabs open.** The host's tab owns the room, timing, and scoring. Closing or refreshing the host tab ends the room. A guest can reconnect to the same invite in the same browser session; a brief disconnect pauses the round for up to 30 seconds before forfeiture.

Some school, work, VPN, or restrictive NAT networks can block browser connections. PeerJS 1.5.5 includes Google STUN plus public TURN endpoints at `eu-0.turn.peerjs.com:3478` and `us-0.turn.peerjs.com:3478`; the default list has no explicit TCP or TLS relay endpoint. These shared services are best-effort dependencies. On September 15, 2026, both default TURN hostnames returned no A or AAAA records in checks against Cloudflare's `1.1.1.1` resolver, and could not resolve locally. This observation is not a measurement of a player's network. Operators can configure their own reachable TURN service as described below. [PeerJS default configuration](https://github.com/peers/peerjs/blob/v1.5.5/lib/util.ts).

### If a duel stays on Connecting

1. If the page loads but joining stalls, try the [HTTPS version](https://krill-duels-play.owlsowo1.chatgpt.site/). Both players must open it and create a new room there. It carries gameplay through the website and needs no direct browser connection.
2. Keep the host's room open and use its current invite. Both players should refresh after an update, then create a new room.
3. Allow up to a minute for the initial connection. You can cancel and retry if needed.
4. If joining keeps failing, try another network or, if you use a VPN, another VPN server. Loading the website does not always mean a live connection between the two players can open.
5. Open **Connection help** and choose **Copy connection details** when reporting a failure. Include both players' browsers and the message shown. The report distinguishes room-service access from the connection between players without assuming a particular VPN app or configuration.

Technical relay setup for site operators is documented below.

Answer commitments are exchanged before answers are revealed, so a regular client cannot wait to see the other answer before choosing. This is casual play: the catalog and code are public, and the host is trusted. It is not a server-authoritative ranked or anti-cheat system.

Names and game settings are stored in local browser preferences; a guest reconnection token and pending answer are kept in session storage. Room IDs are random and carried in the invite's URL fragment. Only share your invite with the intended opponent.

## Alternate HTTPS rooms

The [public HTTPS edition](https://krill-duels-play.owlsowo1.chatgpt.site/) runs the same interface and scoring over a same-origin API. It uses `src/http-room.ts` and `server/worker.ts` instead of PeerJS. Both players must use that site; rooms are separate from GitHub Pages. This removes reliance on WebRTC/UDP, but the site still must be reachable through each player's network.

The server owns timing, shuffle, and scoring. D1 persists private engine state, drafts and hashed seat tokens. Atomic revision checks protect simultaneous updates. Only public snapshots return to clients; choices remain private until the round resolves. A 12-second missing heartbeat pauses the round for up to 30 more seconds, and either seat can reconnect. Refresh preserves the room in the same tab; explicit Leave forfeits it. Both absent players draw after grace expiry. Inactive rooms expire after one hour and are deleted on subsequent room creation.

`npm run build` still builds the original static GitHub Pages game. `npm run build:site` builds the HTTPS edition to `dist/client` and `dist/server/index.js`. Hosting needs a Worker with `ASSETS` and D1 `DB` bindings and the SQL under `drizzle/`. The Sites deployment also has its own `.openai/hosting.json` with its managed project ID and `"d1": "DB"`; the build copies that manifest into the artifact. For local HTTPS testing, run `npm run build:site`, apply `drizzle/0000_nasty_pete_wisdom.sql` with Wrangler against the local `DB`, then run `npm run start`. A fresh clone gets binding-only build metadata for local use; publishing requires its registered Site manifest. The database ID in generated Wrangler configuration is only a local placeholder.

SQL-backed tests cover concurrent joins, Ready and answers, failed revision checks, duplicate submissions, hidden choices, deadline races, disconnects on both seats, abandoned rooms, rematches, session authentication, and schema/catalog mismatch. HTTP-client tests cover session recovery, stale replies, retries and cancellation. Live browser verification blocks WebRTC and completes a round through HTTPS; it does not reproduce routing from China.

## Development

Requires Node.js 24 or newer.

```sh
npm ci
npm run dev
npm test
npm run build
```

GitHub Actions runs the tests, builds the static app, and publishes `dist` to GitHub Pages on pushes to `main`. Pages must use **GitHub Actions** as its source. Vite uses relative asset paths so the game works under the repository subpath.

### Optional TURN configuration

For site operators: the room service uses `0.peerjs.com` over HTTPS/WebSocket port 443. If signaling succeeds but the game connection cannot open, investigate WebRTC routing and relay availability. A reachable TURN service with TCP/TLS support can provide another route for restrictive networks. Running only a signaling server or a regular proxy does not provide a TURN relay. [WebRTC TURN guide](https://webrtc.org/getting-started/turn-server), [PeerJS connection FAQ](https://peerjs.com/client/faq).

Copy `.env.example` to `.env.local` for local development, or supply the same environment variables to the deployment build:

- `VITE_ICE_SERVERS`: a JSON array of WebRTC ICE server objects with `urls`, and `username`/`credential` for TURN. A URL may be a string or an array. This list **replaces** PeerJS's defaults, so include STUN if you want it.
- `VITE_ICE_TRANSPORT_POLICY`: `all` (default) allows direct and relay candidates; `relay` requires a configured TURN server and is useful for verifying that the relay works.

Use a TURN provider's exact URLs and credentials. For example, an operator-controlled service might offer `turns:turn.example.com:443?transport=tcp`; `example.com` is a placeholder, not a supplied service. The app rejects malformed configuration with an explicit error. Rebuild and redeploy after changing these values; GitHub Pages does not read server environment variables at runtime.

All `VITE_` values are bundled into the public client, including TURN credentials. Use credentials intended for client access with appropriate limits or expiry; never put an account API key or a TURN shared signing secret here. A production service that issues short-lived credentials needs a separate backend. Verify a configured relay using `relay` mode in two real browsers on the target networks before relying on it.

## Verification

Connection regression coverage includes delayed negotiation, delayed room handshakes after retries, bounded failures, cancellation, signaling loss, and retrying a paused host reveal, and spelling suggestions without automatic acceptance. Local real-browser checks use two Chrome contexts with an isolated PeerServer: the original version repeatedly cancels a 3.5-second offer; this version lets it finish and completes a round. Local browser checks do not reproduce China routing or prove a TURN service works.

The test suite covers solo practice, custom HP/timers/damage, settings synchronization and tampering, the host state machine, all score tiers, hidden and delayed reveals, duplicate/stale packets, deadline races, rounds beyond 15, unique question scheduling, pool exhaustion, rematches, 29-second reconnects, and every imported canonical answer. The two-player protocol tests use an in-memory PeerJS transport; they do not prove connectivity between every pair of real networks. Production HTML and assets are also checked after deployment.

Optional imperative WebMCP tools share the visible interface's state and actions when a browser supports `document.modelContext`. The adapter has unit-level contract checks. No supported live WebMCP browser context was available for end-to-end verification; ordinary play does not depend on it.

## License

Original application code is MIT-licensed; see [LICENSE](LICENSE). That license does not relicense the third-party archive data in `src/catalog.json` or `public/data-provenance.json`. Those files retain their source attribution; the archive did not publish an explicit reusable dataset license in the terms reviewed. Dependency licenses remain with their respective authors. Fonts are served with the game to avoid an external Google Fonts request; their OFL notices are preserved in [font-licenses.txt](public/font-licenses.txt).
