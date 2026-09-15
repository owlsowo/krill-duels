import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { DuelRoom } from '../src/network';
import { PROMPTS, promptById } from '../src/data';
import type { DuelSettings } from '../src/settings';
import type { DuelEngine } from '../src/duel-engine';
import * as hints from '../src/hints';

const transport = vi.hoisted(() => {
  type Handler = (...args: any[]) => void;
  class Events {
    handlers = new Map<string, Handler[]>();
    on(name: string, fn: Handler) { this.handlers.set(name, [...(this.handlers.get(name) ?? []), fn]); return this; }
    emit(name: string, ...args: any[]) { this.handlers.get(name)?.forEach(fn => fn(...args)); }
  }
  const peers = new Map<string, MockPeer>();
  const controls = { holdReveals: false, held: [] as (() => void)[], sent: 0, offline: false,
    holdOpens: false, opens: [] as (() => void)[], holdHellos: false, hellos: [] as (() => void)[], blockService: false };
  class Channel extends Events {
    open = false;
    closed = false;
    serialization = 'binary';
    other!: Channel;
    send(packet: any) {
      if (!this.open) throw Error('closed channel');
      if (this.serialization === 'json' && JSON.stringify(packet).length >= 16300) throw Error('PeerJS JSON message limit');
      controls.sent++;
      const data = structuredClone(packet);
      const deliver = () => { if (this.open && this.other.open) this.other.emit('data', data); };
      if (controls.holdReveals && packet.type === 'reveal') controls.held.push(deliver);
      else if (controls.holdHellos && packet.type === 'hello') controls.hellos.push(deliver);
      else queueMicrotask(deliver);
    }
    close() {
      if (this.closed) return;
      this.closed = true; this.other.closed = true;
      this.open = false; this.other.open = false;
      this.emit('close'); this.other.emit('close');
    }
  }
  class MockPeer extends Events {
    id: string;
    open = false;
    disconnected = false;
    destroyed = false;
    channels: Channel[] = [];
    constructor(idOrOptions?: string | object) {
      super(); this.id = typeof idOrOptions === 'string' ? idOrOptions : `guest-${peers.size}`; peers.set(this.id, this);
      queueMicrotask(() => { if (!this.destroyed && !controls.blockService) { this.open = true; this.emit('open', this.id); } });
    }
    connect(id: string, options?: {serialization:string}) {
      const local = new Channel(); const remote = new Channel(); local.other = remote; remote.other = local;
      local.serialization = remote.serialization = options?.serialization ?? 'binary';
      this.channels.push(local);
      queueMicrotask(() => {
        const host = peers.get(id);
        if (local.closed || this.destroyed) return;
        if (!host || controls.offline) { this.emit('error', { type: 'peer-unavailable' }); return; }
        host.channels.push(remote); host.emit('connection', remote);
        const open = () => {
          if (local.closed || this.destroyed) return;
          local.open = true; remote.open = true; remote.emit('open'); local.emit('open');
        };
        if (controls.holdOpens) controls.opens.push(open);
        else open();
      });
      return local;
    }
    reconnect() { this.disconnected = false; }
    destroy() { this.destroyed = true; this.open = false; this.channels.forEach(c => c.close()); peers.delete(this.id); }
  }
  return { MockPeer, peers, controls };
});
vi.mock('peerjs', () => ({ default: transport.MockPeer }));

let rooms: DuelRoom[] = [];
const errors: string[] = [];
const callbacks = () => ({ change: () => {}, status: () => {}, error: (message: string) => errors.push(message) });
async function flush() { for (let i = 0; i < 12; i++) { await new Promise<void>(resolve => setTimeout(resolve, 0)); } }
// Real crypto runs between fake game-clock ticks.
async function advance(ms: number) { await vi.advanceTimersByTimeAsync(ms); await flush(); }
async function pair(settings?: DuelSettings) {
  const host = new DuelRoom('Host', null, callbacks(), settings); rooms.push(host); await host.open(); await flush();
  const guest = new DuelRoom('Guest', host.room, callbacks()); rooms.push(guest); await guest.open(); await flush();
  expect(host.state?.connected).toBe(true); expect(guest.state?.connected).toBe(true);
  host.ready(); guest.ready(); await flush(); await advance(3250);
  expect(host.state?.phase).toBe('question'); expect(guest.state?.promptId).toBe(host.state?.promptId);
  return { host, guest };
}

beforeEach(() => {
  // Leave setTimeout real so crypto microtasks can drain; only game intervals/Date are virtual.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-09-15T12:00:00Z'));
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('location', { origin: 'https://example.test', pathname: '/krill-duels/', hash: '' });
  const storage = new Map<string,string>();
  vi.stubGlobal('sessionStorage', { getItem: (k:string) => storage.get(k) ?? null, setItem: (k:string,v:string) => storage.set(k,v), removeItem: (k:string) => storage.delete(k) });
  transport.controls.holdReveals = false; transport.controls.held = []; transport.controls.sent = 0; transport.controls.offline = false;
  transport.controls.holdOpens = false; transport.controls.opens = []; transport.controls.holdHellos = false; transport.controls.hellos = []; transport.controls.blockService = false;
  errors.length = 0;
});
afterEach(() => { rooms.forEach(r => r.dispose(false)); rooms = []; transport.peers.clear(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('two-player protocol', () => {
  it('charges host-owned hints per player and acknowledges guest duplicate requests without charging twice', async () => {
    vi.spyOn(hints, 'getPromptHints').mockReturnValue(['Context', 'More context', 'Deeper context']);
    const { host, guest } = await pair();
    const before = structuredClone(guest.state!);
    expect(await host.hint()).toBe(true); await flush();
    const first = guest.hint(), duplicate = guest.hint();
    expect(first).toBe(duplicate);
    expect(guest.state!.hintLevels).toEqual([1, 0]);
    expect(await first).toBe(true); await flush();
    expect(guest.state).toMatchObject({ hp: [285, 285], hintUses: [1, 1], hintLevels: [1, 1] });
    const guestChannel = transport.peers.get(`kd-${host.room}`)!.channels.at(-1)!.other;
    guestChannel.send({ type: 'hint', matchId: before.matchId, round: before.round, expectedHintLevel: 0 });
    await flush();
    expect(host.state!.hp).toEqual([285, 285]);
    expect(await guest.hint()).toBe(true); await flush();
    expect(host.state).toMatchObject({ hp: [285, 255], hintUses: [1, 2], hintLevels: [1, 2] });
    await guest.submit(''); await flush();
    expect(await guest.hint()).toBe(false);
    expect(host.state!.hp).toEqual([285, 255]);
    guestChannel.send({ type: 'hint', matchId: 'old-match', round: before.round, expectedHintLevel: 2 });
    await flush();
    expect(host.state!.hintUses).toEqual([1, 2]);
  });
  it('uses a transport that supports long match histories beyond the JSON message limit', async () => {
    const {host,guest} = await pair();
    const current = structuredClone(host.state!);
    const pool = PROMPTS.slice(0,200);
    current.round = pool.length; current.phase = 'finished';
    current.history = pool.map((prompt,i) => ({round:i+1,promptId:prompt.id,damage:0,loser:null,multiplier:1,results:[0,1].map(()=>({promptId:prompt.id,input:prompt.answers[0].answer,answer:prompt.answers[0].answer,points:prompt.answers[0].score}))})) as typeof current.history;
    const channel = transport.peers.get(`kd-${host.room}`)!.channels.at(-1)!;
    expect(channel.serialization).toBe('binary');
    const packet = {type:'state',version:(host as unknown as {version:string}).version,state:current};
    expect(JSON.stringify(packet).length).toBeGreaterThan(16300);
    channel.send(packet); await flush();
    expect(guest.state!.history).toHaveLength(200);
    expect(errors).toEqual([]);
  });
  it('shares custom host settings and prevents changing them mid-match', async () => {
    const settings = {startingHp:5000,questionSeconds:60,damageScaling:false};
    const {host,guest} = await pair(settings);
    expect(guest.state!.settings).toEqual(settings);
    expect(guest.state!.hp).toEqual([5000,5000]);
    expect(guest.state!.deadline-guest.state!.now).toBeGreaterThan(59000);
    const forged = structuredClone(host.state!);
    forged.settings.questionSeconds = 15;
    transport.peers.get(`kd-${host.room}`)!.channels.at(-1)!.send({type:'state',version:(host as unknown as {version:string}).version,state:forged});
    await flush();
    expect(errors).toContain('Room settings changed during the match. Create a new duel.');
  });
  it('keeps answers hidden until both commit, handles delayed reveal, and damages once', async () => {
    const { host, guest } = await pair();
    const prompt = promptById(host.state!.promptId!)!;
    const answer = prompt.answers[0];
    expect(await host.submit(answer.answer)).toBe(true); await flush();
    expect(guest.state!.committed).toEqual([true,false]);
    expect(guest.state!.history).toHaveLength(0);
    expect(JSON.stringify(guest.state)).not.toContain(answer.answer);
    transport.controls.holdReveals = true;
    expect(await guest.submit('')).toBe(true); await flush();
    expect(host.state!.phase).toBe('reveal');
    const packets = transport.controls.sent;
    await flush(); expect(transport.controls.sent - packets).toBeLessThan(10);
    expect(host.state!.history).toHaveLength(0);
    transport.controls.holdReveals = false;
    transport.controls.held.splice(0).forEach(deliver => { deliver(); deliver(); }); await flush();
    expect(host.state!.history).toHaveLength(1);
    expect(host.state!.history[0].damage).toBe(answer.score);
    expect(host.state!.hp).toEqual([300,300-answer.score]);
    expect(guest.state!.history).toEqual(host.state!.history);
    expect(errors).toEqual([]);
  });

  it('accepts every archive score in the guest snapshot, including 15', async () => {
    const { host, guest } = await pair();
    const shape = structuredClone(host.state!);
    for (const score of [10,15,30,60,85,100]) {
      const prompt = PROMPTS.find(p => p.answers.some(a => a.score === score))!;
      const answer = prompt.answers.find(a => a.score === score)!;
      shape.phase = 'result'; shape.promptId = prompt.id;
      shape.history = [{ round: 1, promptId: prompt.id, damage:score, loser:1, multiplier:1, results: [{ promptId:prompt.id,input:answer.answer,answer:answer.answer,points:score },{ promptId:prompt.id,input:'',answer:null,points:0 }] }];
      const hostPeer = transport.peers.get(`kd-${host.room}`)!;
      const version = (host as unknown as {version:string}).version;
      hostPeer.channels.at(-1)!.send({type:'state',version,state:shape}); await flush();
      expect(guest.state!.history[0].results[0].points).toBe(score);
    }
  });

  it('does not save or lock a host answer if hashing crosses the deadline', async () => {
    const { host } = await pair();
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    let release!: () => void;
    vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(async (algorithm, data) => { await new Promise<void>(resolve => { release = resolve; }); return digest(algorithm,data); });
    const pending = host.submit(promptById(host.state!.promptId!)!.answers[0].answer);
    await Promise.resolve();
    // No tick: stale UI still says question, but the host clock is already past deadline.
    vi.setSystemTime(host.state!.deadline + 1); release();
    expect(await pending).toBe(false);
    expect(sessionStorage.getItem(`kd-answer-${host.room}`)).toBeNull();
    expect(host.state!.committed[0]).toBe(false);
  });

  it('keeps retrying beyond 25 seconds and reconnects inside the host grace period', async () => {
    const { host, guest } = await pair();
    const deadline = host.state!.deadline;
    transport.controls.offline = true;
    transport.peers.get(`kd-${host.room}`)!.channels.at(-1)!.close(); await flush();
    await advance(27_000);
    expect(errors).toEqual([]); expect(host.state!.phase).toBe('question');
    transport.controls.offline = false; await advance(2_000);
    expect(host.state!.connected).toBe(true); expect(guest.state!.connected).toBe(true);
    expect(host.state!.deadline).toBeGreaterThan(deadline + 26_000);
    expect(host.state!.history).toHaveLength(0);
  });

  it('estimates clock skew from a round trip and rejects a locally expired guest submission', async () => {
    const {host, guest} = await pair();
    (guest as unknown as {clockSamples: unknown[]}).clockSamples = [];
    const now = Date.now();
    transport.peers.get(`kd-${host.room}`)!.channels.at(-1)!.send({type:'pong',sent:now-400,now:now-220});
    await flush();
    expect(guest.hostClockOffset).toBe(20);
    const question = guest.state!;
    vi.setSystemTime(question.deadline + 21);
    expect(await guest.submit(promptById(question.promptId!)!.answers[0].answer)).toBe(false);
    expect(sessionStorage.getItem(`kd-answer-${guest.room}`)).toBeNull();
  });
});

describe('connection lifecycle', () => {
  async function joiningPair() {
    const host = new DuelRoom('Host', null, callbacks()); rooms.push(host); await host.open(); await flush();
    const guest = new DuelRoom('Guest', host.room, callbacks()); rooms.push(guest); await guest.open(); await flush();
    return { host, guest, guestPeer: [...transport.peers.values()].find(peer => peer.id !== `kd-${host.room}`)! };
  }

  it('lets slow negotiation finish without replacing the channel or expiring host authentication', async () => {
    transport.controls.holdOpens = true;
    const { host, guest, guestPeer } = await joiningPair();
    await advance(12_000);
    expect(guestPeer.channels).toHaveLength(1);
    expect(guestPeer.channels[0].closed).toBe(false);
    guestPeer.emit('open'); // A recovered signaling socket must not cancel ICE.
    expect(guestPeer.channels).toHaveLength(1);
    transport.controls.opens.splice(0).forEach(open => open()); await flush();
    expect(host.state?.connected).toBe(true);
    expect(guest.state?.connected).toBe(true);
    expect(errors).toEqual([]);
  });

  it('keeps an open retry alive while the room handshake is delayed', async () => {
    transport.controls.offline = true;
    const { host, guest, guestPeer } = await joiningPair();
    transport.controls.offline = false; transport.controls.holdHellos = true;
    await advance(2_000); await advance(6_000);
    expect(guestPeer.channels).toHaveLength(2);
    expect(guestPeer.channels[1].open).toBe(true);
    transport.controls.hellos.splice(0).forEach(deliver => deliver()); await flush();
    expect(host.state?.connected).toBe(true); expect(guest.state?.connected).toBe(true);
    expect(errors).toEqual([]);
  });

  it('bounds stalled attempts and ends an unreachable join with useful diagnostics', async () => {
    transport.controls.holdOpens = true;
    const { guest, guestPeer } = await joiningPair();
    await advance(19_000);
    expect(guestPeer.channels).toHaveLength(1);
    await advance(3_000);
    expect(guestPeer.channels[0].closed).toBe(true);
    expect(guestPeer.channels).toHaveLength(2);
    await advance(38_000);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Could not connect to your friend.');
    expect(guestPeer.destroyed).toBe(true);
    expect(guest.diagnostics()).toMatchObject({ stage: 'failed' });
    expect((guest.diagnostics() as {lastError:string}).lastError).toMatch(/^connection-/);
    const report = JSON.stringify(guest.diagnostics());
    expect(report).not.toContain(guest.room);
    expect(report).not.toContain(sessionStorage.getItem(`kd-token-${guest.room}`));
  });

  it('does not advertise a host room until the signaling service opens', async () => {
    transport.controls.blockService = true;
    const host = new DuelRoom('Host', null, callbacks()); rooms.push(host); await host.open(); await flush();
    await advance(24_000);
    expect(host.state).toBeNull(); expect(errors).toEqual([]);
    await advance(1_000);
    expect(errors[0]).toContain('room service');
    expect(transport.peers.size).toBe(0);
  });

  it('ignores late peer-level WebRTC errors from an expired attempt', async () => {
    transport.controls.holdOpens = true;
    const { host, guest, guestPeer } = await joiningPair();
    await advance(22_000);
    expect(guestPeer.channels).toHaveLength(2);
    guestPeer.emit('error', { type: 'webrtc' });
    transport.controls.opens.splice(0).forEach(open => open()); await flush();
    expect(errors).toEqual([]);
    expect(host.state?.connected).toBe(true); expect(guest.state?.connected).toBe(true);
  });

  it('cancels pending channels and ignores late open events', async () => {
    transport.controls.holdOpens = true;
    const { host, guest, guestPeer } = await joiningPair();
    guest.dispose(false);
    transport.controls.opens.splice(0).forEach(open => open()); await flush();
    expect(host.state?.connected).toBe(false); expect(guest.state).toBeNull();
    expect(guestPeer.channels[0].closed).toBe(true);
    await advance(60_000); expect(errors).toEqual([]);
  });

  it('preserves gameplay through signaling loss and safely retries reconnection', async () => {
    const { host, guest } = await pair();
    const peer = [...transport.peers.values()].find(peer => peer.id !== `kd-${host.room}`)!;
    peer.open = false; peer.disconnected = true;
    const reconnect = vi.spyOn(peer, 'reconnect').mockImplementationOnce(() => { throw Error('not ready'); });
    peer.emit('disconnected');
    await advance(3_000);
    expect(reconnect).toHaveBeenCalledTimes(2);
    expect(guest.state?.connected).toBe(true); expect(host.state?.connected).toBe(true);
    expect(errors).toEqual([]);
  });

  it('retries a host reveal rejected during a transient disconnect instead of losing its score', async () => {
    const { host, guest } = await pair();
    const engine = (host as unknown as {engine:DuelEngine}).engine;
    const reveal = vi.spyOn(engine, 'reveal').mockResolvedValueOnce(false);
    const answer = promptById(host.state!.promptId!)!.answers[0];
    await host.submit(answer.answer); await flush();
    await guest.submit(''); await flush();
    await advance(1_000);
    expect(reveal.mock.calls.filter(call => call[0] === 0)).toHaveLength(2);
    expect(host.state!.history).toHaveLength(1);
    expect(host.state!.history[0].results[0].points).toBe(answer.score);
    expect(guest.state!.history).toEqual(host.state!.history);
  });

  it('starts a fresh signaling recovery budget when a healthy game connection drops', async () => {
    const { host, guest } = await pair();
    const peers = [...transport.peers.values()];
    for (const peer of peers) {
      peer.open = false; peer.disconnected = true;
      vi.spyOn(peer, 'reconnect').mockImplementation(() => {});
      peer.emit('disconnected');
    }
    await advance(26_000);
    expect(errors).toEqual([]);
    transport.peers.get(`kd-${host.room}`)!.channels.at(-1)!.close(); await flush();
    await advance(27_000);
    expect(errors).toEqual([]); expect(guest.state!.connected).toBe(false);
    for (const peer of peers) { peer.open = true; peer.disconnected = false; peer.emit('open'); }
    await flush();
    expect(host.state!.connected).toBe(true); expect(guest.state!.connected).toBe(true);
  });
});
