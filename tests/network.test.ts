import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { DuelRoom } from '../src/network';
import { PROMPTS, promptById } from '../src/data';

const transport = vi.hoisted(() => {
  type Handler = (...args: any[]) => void;
  class Events {
    handlers = new Map<string, Handler[]>();
    on(name: string, fn: Handler) { this.handlers.set(name, [...(this.handlers.get(name) ?? []), fn]); return this; }
    emit(name: string, ...args: any[]) { this.handlers.get(name)?.forEach(fn => fn(...args)); }
  }
  const peers = new Map<string, MockPeer>();
  const controls = { holdReveals: false, held: [] as (() => void)[], sent: 0, offline: false };
  class Channel extends Events {
    open = false;
    other!: Channel;
    send(packet: any) {
      if (!this.open) throw Error('closed channel');
      controls.sent++;
      const data = structuredClone(packet);
      const deliver = () => { if (this.open && this.other.open) this.other.emit('data', data); };
      if (controls.holdReveals && packet.type === 'reveal') controls.held.push(deliver);
      else queueMicrotask(deliver);
    }
    close() {
      if (!this.open) return;
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
    constructor(id = `guest-${peers.size}`) {
      super(); this.id = id; peers.set(id, this);
      queueMicrotask(() => { if (!this.destroyed) { this.open = true; this.emit('open', this.id); } });
    }
    connect(id: string) {
      const local = new Channel(); const remote = new Channel(); local.other = remote; remote.other = local;
      this.channels.push(local);
      queueMicrotask(() => {
        const host = peers.get(id);
        if (!host || controls.offline) { this.emit('error', { type: 'peer-unavailable' }); return; }
        host.channels.push(remote); host.emit('connection', remote);
        local.open = true; remote.open = true; remote.emit('open'); local.emit('open');
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
async function pair() {
  const host = new DuelRoom('Host', null, callbacks()); rooms.push(host); await host.open(); await flush();
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
  errors.length = 0;
});
afterEach(() => { rooms.forEach(r => r.dispose(false)); rooms = []; transport.peers.clear(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('two-player protocol', () => {
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
