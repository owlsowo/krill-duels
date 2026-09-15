import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleApi, protocolVersion, PRESENCE_MS, type Database, type Statement } from '../server/worker';
import { DuelEngine, type DuelState, type Seat } from '../src/duel-engine';
import { DEFAULT_SETTINGS } from '../src/settings';
import { promptById } from '../src/data';

class SqliteD1 implements Database {
  sqlite = new DatabaseSync(':memory:');
  conflicts = 0;
  constructor() { this.sqlite.exec(readFileSync(new URL('../drizzle/0000_nasty_pete_wisdom.sql', import.meta.url), 'utf8')); }
  prepare(sql: string): Statement {
    let values: SQLInputValue[] = [];
    const statement: Statement = {
      bind: (...args) => { values = args as SQLInputValue[]; return statement; },
      first: async <T>() => (this.sqlite.prepare(sql).get(...values) as T) ?? null,
      run: async () => {
        if (this.conflicts && sql.startsWith('UPDATE')) { this.conflicts--; return { meta: { changes: 0 } }; }
        return { meta: { changes: Number(this.sqlite.prepare(sql).run(...values).changes) } };
      },
    };
    return statement;
  }
}
const room = 'a'.repeat(24), tokens = ['b'.repeat(32), 'c'.repeat(32)] as const;
const epoch = 1_800_000_000_000;
type Reply = { state: DuelState; revision: number; accepted: boolean; code?: string };
let db: SqliteD1, now: number, version: string;
async function call(seat: Seat, action: string, extra: Record<string, unknown> = {}, token: string = tokens[seat], at = now) {
  const response = await handleApi(new Request('https://game.example/api/duel', { method: 'POST', headers: {
    'Content-Type': 'application/json', authorization: `Bearer ${token}`, origin: 'https://game.example',
  }, body: JSON.stringify({ action, room, seat, version, ...extra }) }), { DB: db }, at);
  const data = await response.json() as Reply;
  return { response, data, state: data.state };
}
async function create() { return call(0, 'create', { name: 'Host', settings: DEFAULT_SETTINGS }); }
async function joined() { await create(); return call(1, 'join', { name: 'Guest' }); }
const current = (s: DuelState) => ({ matchId: s.matchId, round: s.round, phase: s.phase });
async function playing() {
  const { state } = await joined();
  const replies = await Promise.all([call(0, 'ready', current(state)), call(1, 'ready', current(state))]);
  expect(replies.every(r => r.response.ok)).toBe(true);
  now += 3000;
  return call(0, 'poll');
}
beforeEach(async () => { db = new SqliteD1(); now = epoch; version = await protocolVersion(); });
afterEach(() => db.sqlite.close());

describe('HTTPS room API on persisted SQL state', () => {
  it('creates and joins without any peer connection; refresh create is idempotent', async () => {
    const first = await joined();
    expect(first.state.connected).toBe(true);
    expect(first.state.names).toEqual(['Host', 'Guest']);
    const refresh = await create();
    expect(refresh.state.matchId).toBe(first.state.matchId);
    expect(refresh.state.names).toEqual(['Host', 'Guest']);
    expect(refresh.data.revision).toBeGreaterThan(first.data.revision);
  });
  it('only allows one of two concurrent guest claims and authenticates all actions', async () => {
    await create();
    const claims = await Promise.all([call(1, 'join'), call(1, 'join', {}, 'd'.repeat(32))]);
    expect(claims.map(r => r.response.status).sort()).toEqual([200, 403]);
    expect((await call(0, 'poll', {}, tokens[1])).response.status).toBe(403);
  });
  it('commits privately, survives CAS retries, resolves simultaneous answers exactly once', async () => {
    const { state } = await playing();
    const input = promptById(state.promptId!)!.answers[0].answer;
    db.conflicts = 2;
    const first = await call(0, 'answer', { ...current(state), input });
    expect(first.data.accepted).toBe(true);
    expect(first.state.committed).toEqual([true, false]);
    const publicText = JSON.stringify((await call(1, 'poll')).data);
    for (const secret of ['drafts', 'salt', 'payload', 'order', 'pool', tokens[0], input]) expect(publicText).not.toContain(secret);
    expect(first.state.history).toHaveLength(0);
    const replies = await Promise.all([call(1, 'answer', { ...current(state), input }), call(0, 'answer', { ...current(state), input })]);
    expect(replies.every(r => r.data.accepted)).toBe(true);
    const result = await call(0, 'poll');
    expect(result.state.phase).toBe('result');
    expect(result.state.history).toHaveLength(1);
    expect(result.state.history[0].results.map(r => r.input)).toEqual([input, input]);
    expect((await call(0, 'answer', { ...current(state), input: 'different' })).data.accepted).toBe(false);
  });
  it('does not allow a stale Ready or answer to enter a later round', async () => {
    const { state } = await playing();
    await call(0, 'answer', { ...current(state), input: '' });
    const ended = await call(1, 'answer', { ...current(state), input: '' });
    await Promise.all([call(0, 'ready', current(ended.state)), call(1, 'ready', current(ended.state))]);
    await call(0, 'ready', current(ended.state));
    const next = await call(1, 'answer', { ...current(state), input: 'late' });
    expect(next.data.accepted).toBe(false);
    expect(next.state.round).toBe(2);
    expect(next.state.ready).toEqual([false, false]);
  });
  it('advances a late countdown at its deadline, and rejects an answer at question expiry', async () => {
    const { state } = await joined();
    await Promise.all([call(0, 'ready', current(state)), call(1, 'ready', current(state))]);
    now += 5000;
    const next = await call(0, 'poll');
    expect(next.state.deadline).toBe(epoch + 28_000);
    for (const delta of [10_000, 20_000]) { now = epoch + delta; await Promise.all([call(0, 'poll'), call(1, 'poll')]); }
    now = epoch + 28_000;
    const expired = await call(0, 'answer', { ...current(next.state), input: 'too late' });
    expect(expired.data.accepted).toBe(false);
    expect(expired.state.phase).toBe('result');
    expect(expired.state.history[0].results.map(r => r.input)).toEqual(['', '']);
  });
  it.each([0, 1] as const)('pauses and resumes when seat %i returns inside grace', async missing => {
    const active = (1 - missing) as Seat;
    const { state } = await playing();
    now = epoch + 16_000;
    const paused = await call(active, 'poll');
    expect(paused.state.connected).toBe(false);
    const pauseAt = paused.state.reconnectUntil! - 30_000;
    now += 10_000; await call(active, 'poll');
    now = pauseAt + 29_000;
    await call(active, 'poll');
    const returned = await call(missing, 'poll');
    expect(returned.state.connected).toBe(true);
    expect(returned.state.phase).toBe('question');
    expect(returned.state.deadline).toBe(state.deadline + 29_000);
  });
  it.each([0, 1] as const)('forfeits absent seat %i after grace even when that seat polls first', async missing => {
    const active = (1 - missing) as Seat;
    await playing();
    for (const delta of [10_000, 20_000, 30_000, 40_000]) { now = epoch + delta; await call(active, 'poll'); }
    now = epoch + 48_000;
    const expired = await call(missing, 'poll');
    expect(expired.state.phase).toBe('finished');
    expect(expired.state.winner).toBe(active);
  });
  it('both abandoned players draw consistently; no stale heartbeat rewinds room time', async () => {
    await playing(); now += PRESENCE_MS + 31_000;
    const ended = await call(1, 'poll');
    expect(ended.state.phase).toBe('finished'); expect(ended.state.winner).toBeNull();
    const stale = await call(0, 'poll', {}, tokens[0], epoch);
    expect(stale.state.now).toBe(ended.state.now);
    const row = db.sqlite.prepare('SELECT host_seen FROM rooms').get()!;
    expect(row.host_seen).toBe(now);
  });
  it('stores a committed draft across worker instances and scores it at timeout', async () => {
    const { state } = await playing();
    const input = promptById(state.promptId!)!.answers[0].answer;
    await call(0, 'answer', { ...current(state), input });
    for (const delta of [10_000, 20_000, 28_000]) { now = epoch + delta; await Promise.all([call(0, 'poll'), call(1, 'poll')]); }
    const result = await call(1, 'poll');
    expect(result.state.phase).toBe('result');
    expect(result.state.history[0].results.map(r => r.input)).toEqual([input, '']);
  });
  it('allows rematch, resets drafts, and rejects a prior match command', async () => {
    const { state } = await playing();
    // Expire guest while host continues; room remains available for a rematch.
    for (const delta of [10_000, 20_000, 30_000, 40_000, 48_000]) { now = epoch + delta; await call(0, 'poll'); }
    const returned = await call(1, 'poll');
    expect(returned.state.phase).toBe('finished');
    await Promise.all([call(0, 'ready', current(returned.state)), call(1, 'ready', current(returned.state))]);
    const next = await call(0, 'poll');
    expect(next.state.matchId).not.toBe(state.matchId); expect(next.state.round).toBe(1);
    expect((await call(0, 'answer', { ...current(state), input: 'late' })).data.accepted).toBe(false);
  });
  it('explicit Leave finishes the game and prevents the left session from reclaiming it', async () => {
    await joined(); await call(0, 'leave');
    expect((await call(1, 'poll')).state.winner).toBe(1);
    expect((await create()).response.status).toBe(410);
  });
  it('rejects catalog, origin, body and storage mismatches without modifying the room', async () => {
    const first = await joined();
    expect((await call(1, 'poll', { version: 'old' })).response.status).toBe(409);
    const badOrigin = await handleApi(new Request('https://game.example/api/duel', { method: 'POST', headers: { origin: 'https://other.example' } }), { DB: db }, now);
    expect(badOrigin.status).toBe(403);
    expect((await call(1, 'answer', { ...current(first.state), input: 'x'.repeat(5000) })).response.status).toBe(413);
    const row = db.sqlite.prepare('SELECT payload, revision FROM rooms').get()!;
    expect(row.revision).toBe(first.data.revision);
    const payload = JSON.parse(row.payload as string); payload.engine.schema = 999;
    db.sqlite.prepare('UPDATE rooms SET payload = ?').run(JSON.stringify(payload));
    expect((await call(1, 'poll')).response.status).toBe(409);
  });
});

it('engine persistence preserves question order, private locks, and paused deadlines', () => {
  const engine = new DuelEngine('Host'); engine.join('Guest', epoch);
  engine.ready(0, epoch); engine.ready(1, epoch); engine.tick(epoch + 3000);
  const s = engine.snapshot(epoch + 3000);
  engine.commit(0, s.matchId, 1, 'a'.repeat(64), epoch + 3001);
  engine.connection(false, epoch + 4000);
  const stored = JSON.parse(JSON.stringify(engine.store(epoch + 4000)));
  const recovered = DuelEngine.restore(stored);
  expect(recovered.store(epoch + 4000)).toEqual(stored);
  recovered.connection(true, epoch + 8000);
  expect(recovered.snapshot(epoch + 8000).deadline).toBe(s.deadline + 4000);
});
