import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { peerOptions } from '../src/connection-config';

beforeEach(() => {
  vi.stubEnv('VITE_ICE_SERVERS', '');
  vi.stubEnv('VITE_ICE_TRANSPORT_POLICY', '');
});
afterEach(() => vi.unstubAllEnvs());

describe('live-room ICE configuration', () => {
  it('preserves PeerJS defaults when no custom servers are configured', () => {
    expect(peerOptions()).toEqual({});
    vi.stubEnv('VITE_ICE_TRANSPORT_POLICY', 'all');
    expect(peerOptions()).toEqual({});
  });

  it('passes configured STUN and authenticated TURN/TLS servers to WebRTC', () => {
    const iceServers = [
      { urls: 'stun:stun.example.com:3478' },
      { urls: ['turn:turn.example.com:3478?transport=udp', 'turns:turn.example.com:443?transport=tcp'], username: 'limited-user', credential: 'temporary-password' },
    ];
    vi.stubEnv('VITE_ICE_SERVERS', JSON.stringify(iceServers));
    vi.stubEnv('VITE_ICE_TRANSPORT_POLICY', 'relay');
    expect(peerOptions()).toEqual({ config: { iceServers, iceTransportPolicy: 'relay' } });
  });

  it('defaults configured servers to all candidates', () => {
    vi.stubEnv('VITE_ICE_SERVERS', '[{"urls":"stun:[2001:db8::1]:3478"}]');
    expect(peerOptions().config?.iceTransportPolicy).toBe('all');
  });

  it.each([
    'not-json', '{}', '[]', '[null]', '[{"url":"stun:stun.example.com"}]',
    '[{"urls":[]}]', '[{"urls":"https://turn.example.com"}]',
    '[{"urls":"stun:stun.example.com:99999"}]', '[{"urls":["stun:stun.example.com",3]}]',
    '[{"urls":"turns:turn.example.com:443","username":"user"}]',
    '[{"urls":"turn:turn.example.com:3478","username":42,"credential":"secret"}]',
  ])('rejects invalid configuration without exposing credentials: %s', value => {
    vi.stubEnv('VITE_ICE_SERVERS', value);
    expect(peerOptions).toThrow('Live-room configuration:');
    try { peerOptions(); } catch (error) { expect((error as Error).message).not.toContain('secret'); }
  });

  it('requires a TURN server for relay-only mode', () => {
    vi.stubEnv('VITE_ICE_TRANSPORT_POLICY', 'relay');
    expect(peerOptions).toThrow('Relay mode needs a TURN server');
    vi.stubEnv('VITE_ICE_SERVERS', '[{"urls":"stun:stun.example.com"}]');
    expect(peerOptions).toThrow('Relay mode needs a TURN server');
  });

  it('rejects misspelled transport policies', () => {
    vi.stubEnv('VITE_ICE_TRANSPORT_POLICY', 'tcp');
    expect(peerOptions).toThrow('VITE_ICE_TRANSPORT_POLICY must be all or relay');
  });
});
