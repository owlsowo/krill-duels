import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DuelRoom } from '../src/http-room';
import { DuelEngine } from '../src/duel-engine';
const storage = new Map<string, string>();
const callback = () => ({ change: vi.fn(), status: vi.fn(), error: vi.fn() });
const engine = new DuelEngine('Host');
let rooms: DuelRoom[];
const room = (id: string | null = null, cb = callback()) => { const r = new DuelRoom('Tester', id, cb); rooms.push(r); return r; };
const reply = (revision: number, state = engine.snapshot(Date.now())) => Response.json({ protocol: 3, revision, state, accepted: true });
beforeEach(() => {
  rooms = []; storage.clear();
  vi.stubGlobal('location', { origin: 'https://game.example', pathname: '/', hash: '' });
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
});
afterEach(() => { for (const r of rooms) r.dispose(false); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it('uses only same-origin HTTP and shares safe diagnostics', async () => {
  const fetch = vi.fn().mockResolvedValue(reply(1)); vi.stubGlobal('fetch', fetch);
  const r = room(); await r.open();
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe('/api/duel'); expect(init.method).toBe('POST');
  expect(init.headers.Authorization).toMatch(/^Bearer [a-f0-9]{32}$/);
  expect(r.hostClockOffset).not.toBeNull();
  expect(r.diagnostics()).toMatchObject({ transport: 'https', protocol: 3, accepted: true });
  expect(JSON.stringify(r.diagnostics())).not.toContain(r.room);
  expect(JSON.stringify(r.diagnostics())).not.toContain(init.headers.Authorization.slice(7));
});
it('restores host role and session after refresh without sending Leave', async () => {
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(reply(fetch.mock.calls.length))); vi.stubGlobal('fetch', fetch);
  const host = room(); await host.open(); const token = fetch.mock.calls[0][1].headers.Authorization;
  host.dispose(false);
  const restored = room(host.room); await restored.open();
  expect(restored.seat).toBe(0);
  expect(fetch.mock.calls[1][1].headers.Authorization).toBe(token);
  expect(fetch.mock.calls.map(c => JSON.parse(c[1].body).action)).toEqual(['create', 'create']);
});
it('explicit Leave sends the same authenticated session with keepalive', async () => {
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(reply(1))); vi.stubGlobal('fetch', fetch);
  const guest = room('a'.repeat(24)); await guest.open(); guest.dispose();
  expect(guest.seat).toBe(1);
  expect(JSON.parse(fetch.mock.calls[1][1].body).action).toBe('leave');
  expect(fetch.mock.calls[1][1].keepalive).toBe(true);
});
it('ignores an older snapshot and recovers after a temporary HTTP failure', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const cb = callback();
  const fetch = vi.fn().mockResolvedValueOnce(reply(2)).mockResolvedValueOnce(reply(1))
    .mockRejectedValueOnce(new Error('offline')).mockImplementation(() => Promise.resolve(reply(3)));
  vi.stubGlobal('fetch', fetch);
  const r = room(null, cb); await r.open(); expect(cb.change).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(750); expect(cb.change).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(750); expect(r.diagnostics()).toMatchObject({ stage: 'reconnecting' });
  await vi.advanceTimersByTimeAsync(1500); expect(r.diagnostics()).toMatchObject({ stage: 'connected', lastError: null });
  expect(cb.error).not.toHaveBeenCalled();
});
it('cancellation aborts a pending request and suppresses later callbacks', async () => {
  let signal: AbortSignal | undefined;
  let release: ((value: Response) => void) | undefined;
  const fetch = vi.fn((_url, init) => { signal = init.signal; return new Promise<Response>(resolve => { release = resolve; }); });
  vi.stubGlobal('fetch', fetch);
  const cb = callback(), r = room(null, cb); const opening = r.open();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
  r.dispose(false); expect(signal?.aborted).toBe(true);
  release!(reply(1)); await opening;
  expect(cb.change).not.toHaveBeenCalled(); expect(cb.error).not.toHaveBeenCalled();
});
