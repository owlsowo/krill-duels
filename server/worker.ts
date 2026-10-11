import { catalogVersion } from '../src/data';
import { commitment, DuelEngine, type StoredEngine, type Seat, type Phase } from '../src/duel-engine';
import { validSettings, PLAYER_COUNT_MAX, type DuelSettings } from '../src/settings';

// Only same-origin HTTPS is used. No signaling service, WebRTC, STUN or TURN.
export const PRESENCE_MS = 12_000;
export const ROOM_TTL_MS = 3_600_000;
const MAX_ROOMS = 512;
const MAX_BODY = 4096;
const PROTOCOL = 5;
export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta: { changes: number } }>;
}
export interface Database { prepare(sql: string): Statement }
export interface Environment { DB: Database; ASSETS: { fetch(request: Request): Promise<Response> } }
type Action = 'create' | 'join' | 'poll' | 'ready' | 'answer' | 'hint' | 'leave';
interface Command {
  action: Action; room: string; seat: Seat; version: string;
  name?: string; settings?: DuelSettings;
  matchId?: string; round?: number; phase?: Phase; input?: string; expectedHintLevel?: number;
}
interface Draft { matchId: string; round: number; input: string; salt: string }
interface StoredRoom {
  engine: StoredEngine;
  drafts: (Draft | null)[];
  left: boolean[];
  tokens: (string | null)[];
  seen: number[];
}
interface Row {
  id: string; host: string; guest: string | null; version: string; payload: string;
  revision: number; host_seen: number; guest_seen: number; expires: number;
}
let versionPromise: Promise<string> | undefined;
export const protocolVersion = (): Promise<string> => versionPromise ??= catalogVersion().then(v => `krill-https-${PROTOCOL}:${v}`);
class ApiError extends Error { constructor(readonly status: number, readonly code: string, message: string) { super(message); } }
const error = (status: number, code: string, message: string): never => { throw new ApiError(status, code, message); };
const json = (body: unknown, status = 200): Response => Response.json(body, { status, headers: {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
} });
async function tokenHash(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
function emptyRoom(engine: DuelEngine, hostHash: string, now: number): StoredRoom {
  const n = engine.snapshot(now).settings.playerCount;
  return {
    engine: engine.store(now),
    drafts: Array.from({ length: n }, () => null),
    left: Array.from({ length: n }, () => false),
    tokens: Array.from({ length: n }, (_, seat) => seat === 0 ? hostHash : null),
    seen: Array.from({ length: n }, (_, seat) => seat === 0 ? now : 0),
  };
}
function normalizeRoom(raw: StoredRoom, row: Row, now: number): StoredRoom {
  if (raw.engine?.schema !== 1 && raw.engine?.schema !== 2) {
    error(409, 'version-mismatch', 'This room needs an update. Both refresh and create a new room.');
  }
  const engine = DuelEngine.restore(raw.engine);
  const n = engine.snapshot(now).settings.playerCount;
  const drafts = Array.from({ length: n }, (_, seat) => raw.drafts?.[seat] ?? null);
  const left = Array.from({ length: n }, (_, seat) => !!raw.left?.[seat]);
  const tokens = Array.from({ length: n }, (_, seat) => {
    if (raw.tokens?.[seat]) return raw.tokens[seat];
    if (seat === 0) return row.host;
    if (seat === 1) return row.guest;
    return null;
  });
  const seen = Array.from({ length: n }, (_, seat) => {
    const stored = raw.seen?.[seat];
    const column = seat === 0 ? row.host_seen : seat === 1 ? row.guest_seen : 0;
    const candidates = [stored, column].filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
    return candidates.length ? Math.max(...candidates) : 0;
  });
  return { engine: engine.store(now), drafts, left, tokens, seen };
}
async function command(request: Request): Promise<Command> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) error(415, 'bad-request', 'Please refresh the game and try again.');
  const reader = request.body?.getReader();
  if (!reader) return error(400, 'bad-request', 'The room request was incomplete.');
  let length = 0; const chunks: Uint8Array[] = [];
  while (true) {
    const part = await reader.read(); if (part.done) break;
    length += part.value.byteLength;
    if (length > MAX_BODY) { await reader.cancel(); error(413, 'bad-request', 'The room request was too large.'); }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let c: Command;
  try { c = JSON.parse(new TextDecoder().decode(bytes)); } catch { return error(400, 'bad-request', 'The room request was incomplete.'); }
  if (!c || !['create', 'join', 'poll', 'ready', 'answer', 'hint', 'leave'].includes(c.action) ||
      !/^[a-f0-9]{24}$/.test(c.room) || typeof c.version !== 'string' ||
      (c.name !== undefined && (typeof c.name !== 'string' || c.name.length > 100)) ||
      (c.action === 'create' && (c.seat !== 0 || !validSettings(c.settings))) ||
      (c.action === 'join' && !(c.seat === -1 || c.seat === 1 || (Number.isInteger(c.seat) && c.seat >= 1 && c.seat < PLAYER_COUNT_MAX))) ||
      (c.action !== 'create' && c.action !== 'join' && !(Number.isInteger(c.seat) && c.seat >= 0 && c.seat < PLAYER_COUNT_MAX)) ||
      (['ready', 'answer', 'hint'].includes(c.action) && (typeof c.matchId !== 'string' || c.matchId.length > 50 || !Number.isInteger(c.round))) ||
      (c.action === 'hint' && (!Number.isInteger(c.expectedHintLevel) || c.expectedHintLevel! < 0 || c.expectedHintLevel! >= 3)) ||
      (c.action === 'answer' && (typeof c.input !== 'string' || c.input.length > 160))) {
    error(400, 'bad-request', 'Please refresh the game and try again.');
  }
  return c;
}
async function revealDrafts(engine: DuelEngine, drafts: StoredRoom['drafts'], now: number): Promise<void> {
  const s = engine.snapshot(now);
  if (s.phase !== 'reveal' || !s.connected) return;
  for (let seat = 0; seat < s.settings.playerCount; seat++) {
    const d = drafts[seat];
    if (d?.matchId === s.matchId && d.round === s.round) await engine.reveal(seat, d.matchId, d.round, d.input, d.salt, now);
  }
}
/** Apply scheduled transitions at their actual time, including a late first poll. */
async function advance(engine: DuelEngine, drafts: StoredRoom['drafts'], now: number): Promise<void> {
  for (let i = 0; i < 4; i++) {
    const s = engine.snapshot(now);
    if (!s.connected || !s.deadline || s.deadline > now || s.phase === 'finished') break;
    engine.tick(s.deadline);
    await revealDrafts(engine, drafts, s.deadline);
  }
  await revealDrafts(engine, drafts, now);
}
async function presence(engine: DuelEngine, saved: StoredRoom, seat: Seat, now: number): Promise<void> {
  const n = engine.snapshot(now).settings.playerCount;
  const joined = engine.snapshot(now).joined;
  if (joined.filter(Boolean).length > 1) {
    let s = engine.snapshot(now);
    const activeSeen = saved.seen.filter((_, index) => joined[index] && !saved.left[index] && saved.seen[index] > 0);
    const loss = Math.min(...activeSeen) + PRESENCE_MS;
    if (s.connected && now >= loss) {
      await advance(engine, saved.drafts, loss);
      for (let index = 0; index < n; index++) {
        if (joined[index] && !saved.left[index] && saved.seen[index] + PRESENCE_MS <= loss) {
          engine.connection(index, false, loss);
        }
      }
    }
    s = engine.snapshot(now);
    // Grace expiry uses pre-heartbeat timestamps so a late poll cannot resurrect a forfeited seat.
    if (s.reconnectUntil !== null && now >= s.reconnectUntil && s.phase !== 'finished') {
      const missing = Array.from({ length: n }, (_, index) =>
        joined[index] && !saved.left[index] && saved.seen[index] + PRESENCE_MS <= s.reconnectUntil!);
      if (missing.every((isMissing, index) => !joined[index] || saved.left[index] || isMissing)) engine.abandon();
      else {
        for (let index = 0; index < n; index++) {
          if (missing[index]) engine.forfeit(index, index === 1 && n === 2
            ? 'Friend disconnected for 30 seconds.'
            : 'Opponent disconnected for 30 seconds.');
        }
      }
    }
  }
  saved.seen[seat] = now;
  const snap = engine.snapshot(now);
  for (let index = 0; index < n; index++) {
    if (!snap.joined[index] || saved.left[index]) continue;
    const seatPresent = saved.seen[index] > 0 && now - saved.seen[index] < PRESENCE_MS;
    engine.connection(index, seatPresent, now);
  }
  await advance(engine, saved.drafts, now);
}
async function execute(db: Database, c: Command, token: string, now: number): Promise<Response> {
  const version = await protocolVersion();
  if (c.version !== version) return error(409, 'version-mismatch', 'Your game versions differ. Both refresh, then create a new room.');
  const hash = await tokenHash(token);
  if (c.action === 'create') {
    await db.prepare('DELETE FROM rooms WHERE expires <= ?').bind(now).run();
    const saved = emptyRoom(new DuelEngine(c.name || 'Player', undefined, undefined, c.settings), hash, now);
    await db.prepare('INSERT OR IGNORE INTO rooms (id, host, guest, version, payload, revision, host_seen, guest_seen, expires) SELECT ?, ?, NULL, ?, ?, 0, ?, 0, ? WHERE (SELECT COUNT(*) FROM rooms) < ?')
      .bind(c.room, hash, version, JSON.stringify(saved), now, now + ROOM_TTL_MS, MAX_ROOMS).run();
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    const row = await db.prepare('SELECT * FROM rooms WHERE id = ?').bind(c.room).first<Row>();
    if (!row || row.expires <= now) return error(c.action === 'create' ? 503 : 404, 'room-unavailable', c.action === 'create' ? 'The room service is busy. Please try again shortly.' : 'This room has expired or closed. Ask your friend for a new invite.');
    if (row.version !== version) return error(409, 'version-mismatch', 'This room uses an older game version. Both refresh and create a new room.');
    const saved = normalizeRoom(JSON.parse(row.payload) as StoredRoom, row, now);
    let seat = c.seat;
    if (c.action === 'join') {
      const known = saved.tokens.findIndex(token => token === hash);
      if (known >= 0) seat = known;
      else {
        const open = saved.tokens.findIndex((token, index) => token === null && index > 0);
        if (open < 0) return error(403, 'room-full', 'This room belongs to another session or already has enough players. Ask for a new invite.');
        seat = open;
      }
    } else if (c.action === 'create') {
      seat = 0;
    } else if (saved.tokens[seat] !== hash) {
      return error(403, 'room-full', 'This room belongs to another session or already has enough players. Ask for a new invite.');
    }
    if (saved.left[seat]) return error(410, 'room-closed', 'You left this room. Create a new room to play again.');
    now = Math.max(now, saved.engine.state.now, ...saved.seen);
    const engine = DuelEngine.restore(saved.engine);
    const joining = c.action === 'join' && saved.tokens[seat] !== hash;
    if (joining) {
      if (now - saved.seen[0] >= PRESENCE_MS || saved.left[0]) return error(410, 'host-unavailable', 'The host is no longer in this room. Ask for a new invite.');
      saved.tokens[seat] = hash;
      saved.seen[seat] = now;
      const assigned = engine.join(c.name || 'Player', now);
      if (assigned !== seat && assigned >= 0) {
        // Engine assigned a different open seat; keep token tables aligned.
        saved.tokens[seat] = null;
        seat = assigned;
        saved.tokens[seat] = hash;
        saved.seen[seat] = now;
      } else if (assigned < 0) {
        return error(403, 'room-full', 'This room belongs to another session or already has enough players. Ask for a new invite.');
      }
    } else if ((c.action === 'join' || c.action === 'poll') && c.name) {
      engine.rejoin(seat, c.name, now);
    }
    await presence(engine, saved, seat, now);
    const s = engine.snapshot(now);
    const current = c.matchId === s.matchId && c.round === s.round;
    let accepted = false;
    if (c.action === 'ready' && current && c.phase === s.phase) {
      engine.ready(seat, now);
    } else if (c.action === 'hint' && current) {
      accepted = engine.hint(seat, s.matchId, s.round, c.expectedHintLevel!, now);
    } else if (c.action === 'answer' && current) {
      const previous = saved.drafts[seat];
      if (previous && previous.matchId === c.matchId && previous.round === c.round) accepted = previous.input === c.input;
      else if (s.phase === 'question' && s.connected) {
        const salt = crypto.randomUUID();
        const digest = await commitment(s.matchId, s.round, seat, s.promptId!, c.input!, salt);
        accepted = engine.commit(seat, s.matchId, s.round, digest, now);
        if (accepted) saved.drafts[seat] = { matchId: s.matchId, round: s.round, input: c.input!, salt };
      }
    } else if (c.action === 'leave') {
      saved.left[seat] = true;
      engine.forfeit(seat);
      engine.connection(seat, false, now);
    }
    await revealDrafts(engine, saved.drafts, now);
    saved.engine = engine.store(now);
    const guest = saved.tokens[1] ?? null;
    const updated = await db.prepare('UPDATE rooms SET guest = ?, payload = ?, revision = revision + 1, host_seen = ?, guest_seen = ?, expires = ? WHERE id = ? AND revision = ?')
      .bind(guest, JSON.stringify(saved), saved.seen[0] ?? now, saved.seen[1] ?? 0, now + ROOM_TTL_MS, row.id, row.revision).run();
    if (updated.meta.changes === 1) {
      return json({ protocol: PROTOCOL, revision: row.revision + 1, state: engine.snapshot(now), accepted, seat });
    }
  }
  return error(503, 'room-busy', 'The room is catching up. Trying again…');
}
export async function handleApi(request: Request, env: Pick<Environment, 'DB'>, now = Date.now()): Promise<Response> {
  try {
    if (request.method !== 'POST') return json({ error: 'Use the game page to open a room.', code: 'method-not-allowed' }, 405);
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) return error(403, 'bad-origin', 'Open the game link directly and try again.');
    const token = request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{32})$/)?.[1];
    if (!token) return error(401, 'missing-session', 'Your room session is missing. Create a new room.');
    return await execute(env.DB, await command(request), token, now);
  } catch (cause) {
    if (cause instanceof ApiError) return json({ code: cause.code, error: cause.message }, cause.status);
    return json({ code: 'service-unavailable', error: 'The room service is temporarily unavailable. Please try again.' }, 503);
  }
}
export default {
  async fetch(request: Request, env: Environment): Promise<Response> {
    if (new URL(request.url).pathname === '/api/duel') return handleApi(request, env);
    return env.ASSETS.fetch(request);
  },
};
