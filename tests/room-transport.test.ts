import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
it('keeps GitHub Pages on the existing browser room transport', async () => {
  vi.stubEnv('MODE', 'production'); vi.resetModules();
  const room = await import('../src/room');
  const network = await import('../src/network');
  expect(room.HTTPS_ROOMS).toBe(false);
  expect(room.DuelRoom).toBe(network.DuelRoom);
});
it('selects same-origin HTTPS only for the server build', async () => {
  vi.stubEnv('MODE', 'https'); vi.resetModules();
  const room = await import('../src/room');
  const network = await import('../src/http-room');
  expect(room.HTTPS_ROOMS).toBe(true);
  expect(room.DuelRoom).toBe(network.DuelRoom);
});
