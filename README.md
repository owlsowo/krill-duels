# Krill Duels

Free rare-answer trivia for solo practice or a private battle with a friend.

**[Play Krill Duels](https://owlsowo.github.io/krill-duels/)**

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

## How rooms work

The static website is hosted on GitHub Pages. [PeerJS](https://peerjs.com/) provides room discovery through its public signaling service; browsers exchange gameplay state using WebRTC. No game account or custom backend is required.

**Keep both game tabs open.** The host's tab owns the room, timing, and scoring. Closing or refreshing the host tab ends the room. A guest can reconnect to the same invite in the same browser session; a brief disconnect pauses the round for up to 30 seconds before forfeiture.

Some school, work, VPN, or restrictive NAT networks can block browser connections. PeerJS 1.5.5 includes Google STUN plus public TURN endpoints at `eu-0.turn.peerjs.com:3478` and `us-0.turn.peerjs.com:3478`; the default list has no explicit TCP or TLS relay endpoint. These shared services are best-effort dependencies. On September 15, 2026, both default TURN hostnames returned no A or AAAA records in checks against Cloudflare's `1.1.1.1` resolver, and could not resolve locally. This observation is not a measurement of a player's network. Operators can configure their own reachable TURN service as described below. [PeerJS default configuration](https://github.com/peers/peerjs/blob/v1.5.5/lib/util.ts).

### If a duel stays on Connecting

1. Keep the host's room open and use its current invite. Both players should refresh after an update, then create a new room.
2. With **Clash Verge**, check whether **TUN mode** is enabled. System proxy mode can load the website and room service while WebRTC's UDP traffic takes a different route. TUN mode captures TCP and UDP; the selected proxy node and its server must also support UDP, and the routing rules must send this traffic through that node. The **Global** routing toggle alone does not enable TUN. [Clash Verge's explanation](https://www.clashverge.dev/guide/term.html).
3. If TUN still fails, test another UDP-capable node or network. Loading the website proves that HTTPS works; it does not prove that a WebRTC route between the players works.
4. If the connection details say the room service is unreachable, check access to `0.peerjs.com` over HTTPS/WebSocket port 443. If the room service connects but the friend connection times out, focus on WebRTC routing and TURN availability. Open **Connection help** and choose **Copy connection details** when reporting a failure; include both players' browsers and whether TUN is enabled.

A regular HTTP/SOCKS proxy on an Oracle VM is not automatically a TURN relay. A reachable TURN service with TCP/TLS support, commonly on port 443, can provide an additional route for restrictive networks. It needs an actual TURN server and valid credentials; adding an arbitrary HTTPS URL or running only a PeerJS signaling server cannot relay gameplay. No configuration guarantees connectivity from every network. [WebRTC TURN guide](https://webrtc.org/getting-started/turn-server), [PeerJS connection FAQ](https://peerjs.com/client/faq).

Answer commitments are exchanged before answers are revealed, so a regular client cannot wait to see the other answer before choosing. This is casual play: the catalog and code are public, and the host is trusted. It is not a server-authoritative ranked or anti-cheat system.

Names and game settings are stored in local browser preferences; a guest reconnection token and pending answer are kept in session storage. Room IDs are random and carried in the invite's URL fragment. Only share your invite with the intended opponent.

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
