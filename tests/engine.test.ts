// Copy to work/krill-duels/tests/engine.test.ts. All questions below are local test fixtures.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commitment, DuelEngine, GRACE_MS, HP, multiplier, QUESTION_MS, scoreAnswer, type Seat } from '../src/duel-engine';
import { AnswerIndex } from '../src/match';
import { shuffled } from '../src/schedule';

const fixture = vi.hoisted(() => {
  const answers = [
    { answer: 'Common', aliases: ['obvious'], score: 10 },
    { answer: 'Clever', aliases: ['smart'], score: 15 },
    { answer: 'School', aliases: ['popular'], score: 30 },
    { answer: 'Café', aliases: ['coffee house'], score: 60 },
    { answer: 'Obscure', aliases: ['deep'], score: 85 },
    { answer: 'Gem', aliases: ['treasure'], score: 100 },
  ];
  const regular = Array.from({ length: 20 }, (_, index) => ({
    id: `fixture-${index + 1}`, category: 'Test fixtures', prompt: `Unique fixture question ${index + 1}`,
    source: 'https://example.com/test-fixture', answers: answers.map(answer => ({ ...answer, aliases: [...answer.aliases] })),
  }));
  const blank = {
    id: 'blank-fixture', category: 'Test fixtures', prompt: 'Blank alias regression', source: 'https://example.com/test-fixture',
    answers: [{ answer: 'Valid Answer', aliases: ['', '!!!'], score: 100 }],
  };
  const unicode = {
    id: 'unicode-fixture', category: 'Test fixtures', prompt: 'Distinct Unicode answers', source: 'https://example.com/test-fixture',
    answers: [{ answer: '北京', aliases: [], score: 60 }, { answer: '東京', aliases: [], score: 85 }],
  };
  const ambiguous = {
    id: 'ambiguous-fixture', category: 'Test fixtures', prompt: 'Ambiguous alias regression', source: 'https://example.com/test-fixture',
    answers: [{ answer: 'Alpha', aliases: ['shared'], score: 10 }, { answer: 'Beta', aliases: ['shared'], score: 100 }],
  };
  return { regular, ids: regular.map(prompt => prompt.id), blank, unicode, ambiguous, prompts: [...regular, blank, unicode, ambiguous] };
});

vi.mock('../src/data', () => ({
  PROMPTS: fixture.prompts,
  PROMPT_IDS: fixture.prompts.map(prompt => prompt.id),
  promptById: (id: string) => fixture.prompts.find(prompt => prompt.id === id),
}));

afterEach(() => vi.restoreAllMocks());

function engine(pool = fixture.ids): DuelEngine {
  const room = new DuelEngine('Host', 'fixture-match', pool);
  room.join('Friend', 0);
  return room;
}

function begin(room: DuelEngine, start = (room.snapshot(0).round + 1) * 100_000) {
  room.ready(0, start);
  room.ready(1, start);
  expect(room.snapshot(start).phase).toBe('countdown');
  room.tick(start + 3000);
  const state = room.snapshot(start + 3000);
  expect(state.phase).toBe('question');
  expect(state.promptId).not.toBeNull();
  return state;
}

async function committed(room: DuelEngine, hostInput = 'Gem', guestInput = 'Common') {
  const question = begin(room);
  const salts = [`host-salt-${question.round}`, `guest-salt-${question.round}`] as const;
  const inputs = [hostInput, guestInput] as const;
  const hashes = await Promise.all(([0, 1] as const).map(seat =>
    commitment(question.matchId, question.round, seat, question.promptId!, inputs[seat], salts[seat])));
  expect(room.commit(0, question.matchId, question.round, hashes[0], question.now + 1)).toBe(true);
  expect(room.commit(1, question.matchId, question.round, hashes[1], question.now + 2)).toBe(true);
  expect(room.snapshot(question.now + 2).phase).toBe('reveal');
  return { question, inputs, salts, hashes };
}

async function play(room: DuelEngine, hostInput = 'Common', guestInput = 'Common') {
  const round = await committed(room, hostInput, guestInput);
  const { question, inputs, salts } = round;
  expect(await room.reveal(0, question.matchId, question.round, inputs[0], salts[0], question.now + 3)).toBe(true);
  expect(await room.reveal(1, question.matchId, question.round, inputs[1], salts[1], question.now + 4)).toBe(true);
  return room.snapshot(question.now + 5);
}

describe('matching the pinned question catalog', () => {
  it.each([
    ['Common', 10], ['Clever', 15], ['School', 30], ['Café', 60], ['Obscure', 85], ['Gem', 100],
  ])('scores %s as %i points', (input, points) => {
    expect(scoreAnswer('fixture-1', String(input))).toMatchObject({ promptId: 'fixture-1', points });
  });

  it('matches explicit aliases, case, accents, and full-width Latin letters', () => {
    expect(scoreAnswer('fixture-1', '  COFFEE HOUSE  ').points).toBe(60);
    expect(scoreAnswer('fixture-1', 'cafe').answer).toBe('Café');
    expect(scoreAnswer('fixture-1', 'Ｃｏｍｍｏｎ').points).toBe(10);
    expect(scoreAnswer('fixture-1', 'a made-up answer')).toMatchObject({ points: 0, answer: null });
  });

  it('never awards points to blank or punctuation-only input, even if an imported alias is empty', () => {
    for (const prompt of fixture.prompts) {
      for (const input of ['', '   ', '!!!']) expect(scoreAnswer(prompt.id, input).points).toBe(0);
    }
    expect(scoreAnswer('blank-fixture', 'Valid Answer').points).toBe(100);
  });

  it('keeps distinct non-Latin answers distinct instead of reducing both to an empty key', () => {
    expect(scoreAnswer('unicode-fixture', '北京').points).toBe(60);
    expect(scoreAnswer('unicode-fixture', '東京').points).toBe(85);
    expect(scoreAnswer('unicode-fixture', '').points).toBe(0);
  });

  it('rejects ambiguous aliases while retaining each unambiguous canonical answer', () => {
    const index = new AnswerIndex(fixture.ambiguous);
    expect(index.match('shared')).toBeNull();
    expect(index.match('Alpha')?.score).toBe(10);
    expect(index.match('Beta')?.score).toBe(100);
  });
});

describe('commit/reveal integrity and privacy', () => {
  it('requires both players Ready and keeps the next question private during countdown', () => {
    const room = engine();
    room.ready(0, 1000);
    expect(room.snapshot(1000).phase).toBe('lobby');
    room.ready(1, 1000);
    expect(room.snapshot(1000)).toMatchObject({ phase: 'countdown', promptId: null, round: 1, deadline: 4000 });
    room.tick(3999);
    expect(room.snapshot(3999).promptId).toBeNull();
    room.tick(4000);
    expect(room.snapshot(4000)).toMatchObject({ phase: 'question', deadline: 4000 + QUESTION_MS });
  });

  it('does not disclose either raw answer or salt until both verified reveals resolve', async () => {
    const room = engine();
    const { question, inputs, salts, hashes } = await committed(room, 'treasure', 'coffee house');
    expect(room.snapshot(question.now).hashes).toEqual(hashes);
    expect(await room.reveal(0, question.matchId, question.round, inputs[0], salts[0], question.now + 3)).toBe(true);
    const waiting = room.snapshot(question.now + 1000);
    expect(waiting.phase).toBe('reveal');
    expect(waiting.history).toHaveLength(0);
    expect(waiting.hp).toEqual([HP, HP]);
    for (const privateValue of [...inputs, ...salts]) expect(JSON.stringify(waiting)).not.toContain(privateValue);
    // A delayed second reveal still succeeds; receiving more snapshots changes nothing.
    room.snapshot(question.now + 2000);
    expect(await room.reveal(1, question.matchId, question.round, inputs[1], salts[1], question.now + 3000)).toBe(true);
    expect(room.snapshot(question.now + 3001).history[0].results.map(result => result.input)).toEqual(inputs);
  });

  it('binds commitments to match, round, seat, question, answer, and salt', async () => {
    const original = await commitment('match-a', 1, 0, 'fixture-1', 'Gem', 'salt-a');
    const variants: [string, number, Seat, string, string, string][] = [
      ['match-b', 1, 0, 'fixture-1', 'Gem', 'salt-a'],
      ['match-a', 2, 0, 'fixture-1', 'Gem', 'salt-a'],
      ['match-a', 1, 1, 'fixture-1', 'Gem', 'salt-a'],
      ['match-a', 1, 0, 'fixture-2', 'Gem', 'salt-a'],
      ['match-a', 1, 0, 'fixture-1', 'Common', 'salt-a'],
      ['match-a', 1, 0, 'fixture-1', 'Gem', 'salt-b'],
    ];
    for (const args of variants) expect(await commitment(...args)).not.toBe(original);
    expect(original).toMatch(/^[a-f0-9]{64}$/);
  });

  it('does not allow replacement commitments or premature plaintext reveals', async () => {
    const room = engine();
    const q = begin(room);
    const first = await commitment(q.matchId, q.round, 0, q.promptId!, 'Common', 'first-salt');
    const replacement = await commitment(q.matchId, q.round, 0, q.promptId!, 'Gem', 'second-salt');
    expect(await room.reveal(0, q.matchId, q.round, 'Common', 'first-salt', q.now)).toBe(false);
    expect(room.commit(0, q.matchId, q.round, first, q.now + 1)).toBe(true);
    expect(room.commit(0, q.matchId, q.round, replacement, q.now + 2)).toBe(false);
    expect(room.snapshot(q.now + 2).hashes[0]).toBe(first);
  });

  it('rejects a mismatched reveal and resolves that unverified answer as zero after the deadline', async () => {
    const room = engine();
    const { question: q, salts } = await committed(room, 'Gem', 'Common');
    expect(await room.reveal(0, q.matchId, q.round, 'Obscure', salts[0], q.now + 3)).toBe(false);
    expect(await room.reveal(1, q.matchId, q.round, 'Common', salts[1], q.now + 4)).toBe(true);
    expect(room.snapshot(q.now + 4).hp).toEqual([300, 300]);
    room.tick(room.snapshot(q.now + 4).deadline);
    expect(room.snapshot(q.now + 7000).history[0].results.map(result => result.points)).toEqual([0, 10]);
    expect(room.snapshot(q.now + 7000).hp).toEqual([290, 300]);
  });

  it('applies damage exactly once under duplicate and concurrent reveal delivery', async () => {
    const room = engine();
    const { question: q, inputs, salts, hashes } = await committed(room, 'Obscure', 'School');
    const duplicates = await Promise.all([
      room.reveal(0, q.matchId, q.round, inputs[0], salts[0], q.now + 3),
      room.reveal(0, q.matchId, q.round, inputs[0], salts[0], q.now + 3),
    ]);
    expect(duplicates.filter(Boolean)).toHaveLength(1);
    expect(await room.reveal(1, q.matchId, q.round, inputs[1], salts[1], q.now + 4)).toBe(true);
    expect(await room.reveal(1, q.matchId, q.round, inputs[1], salts[1], q.now + 5)).toBe(false);
    expect(room.commit(0, q.matchId, q.round, hashes[0], q.now + 5)).toBe(false);
    room.tick(q.now + 100_000);
    expect(room.snapshot(q.now + 100_000).history).toHaveLength(1);
    expect(room.snapshot(q.now + 100_000).hp).toEqual([300, 245]);
  });

  it('rejects a hash verification that completes after the host already timed out the reveal', async () => {
    const room = engine();
    const { question: q, inputs, salts, hashes } = await committed(room);
    const bytes = Uint8Array.from(hashes[0].match(/../g)!, part => Number.parseInt(part, 16));
    let finishDigest!: (value: ArrayBuffer) => void;
    vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(() => new Promise<ArrayBuffer>(resolve => { finishDigest = resolve; }));
    const pending = room.reveal(0, q.matchId, q.round, inputs[0], salts[0], q.now + 3);
    room.tick(room.snapshot(q.now + 3).deadline);
    finishDigest(bytes.buffer as ArrayBuffer);
    expect(await pending).toBe(false);
    expect(room.snapshot(q.now + 7000).history).toHaveLength(1);
    expect(room.snapshot(q.now + 7000).hp).toEqual([300, 300]);
    expect(room.snapshot(q.now + 7000).history[0].results.map(result => result.points)).toEqual([0, 0]);
  });
});

describe('continuous rounds, HP, and unique questions', () => {
  it('uses the 15-point tier in live round damage and keeps score ties harmless', async () => {
    const room = engine();
    expect((await play(room, 'Clever', 'Common')).hp).toEqual([300, 295]);
    expect((await play(room, 'Clever', 'Clever')).hp).toEqual([300, 295]);
  });

  it('switches damage multipliers at rounds 5 and 8', async () => {
    const room = engine();
    for (let i = 0; i < 8; i++) await play(room, 'Clever', 'Common');
    const state = room.snapshot(1_000_000);
    expect(state.history.map(round => round.multiplier)).toEqual([1, 1, 1, 1, 2, 2, 2, 3]);
    expect(state.hp).toEqual([300, 235]);
    expect([4, 5, 7, 8].map(multiplier)).toEqual([1, 2, 2, 3]);
  });

  it('continues beyond round 15 without reusing questions and draws only after the pool is exhausted', async () => {
    const room = engine();
    for (let round = 1; round <= 20; round++) {
      const state = await play(room, round === 1 ? 'Clever' : 'Common', 'Common');
      if (round === 16) expect(state.phase).toBe('result');
      if (round < 20) expect(state.phase).not.toBe('finished');
    }
    const state = room.snapshot(3_000_000);
    expect(state.history).toHaveLength(20);
    expect(new Set(state.history.map(round => round.promptId)).size).toBe(20);
    expect([...state.history.map(round => round.promptId)].sort()).toEqual([...fixture.ids].sort());
    expect(state.hp).toEqual([300, 295]);
    expect(state.phase).toBe('finished');
    expect(state.winner).toBeNull();
  });

  it('deduplicates repeated IDs in a supplied question pool', async () => {
    const room = engine(['fixture-1', 'fixture-1', 'fixture-2']);
    await play(room);
    const final = await play(room);
    expect(final.phase).toBe('finished');
    expect(new Set(final.history.map(round => round.promptId)).size).toBe(2);
  });

  it('prioritizes a knockout on the final pool question and clamps HP to zero', async () => {
    const room = engine(['fixture-1', 'fixture-2', 'fixture-3']);
    await play(room, 'Gem', '');
    await play(room, 'Gem', '');
    const state = await play(room, 'Gem', '');
    expect(state.hp).toEqual([300, 0]);
    expect(state.phase).toBe('finished');
    expect(state.winner).toBe(0);
    expect(state.reason).toMatch(/knockout/i);
  });

  it('starts a clean rematch with the same custom pool, new match identity, and reset private state', async () => {
    const room = engine(['fixture-1', 'fixture-2']);
    await play(room, 'Clever', 'Common');
    const before = await play(room);
    room.ready(0, 500_000);
    expect(room.snapshot(500_000).phase).toBe('finished');
    room.ready(1, 500_000);
    const reset = room.snapshot(500_000);
    expect(reset.matchId).not.toBe(before.matchId);
    expect(reset).toMatchObject({ phase: 'countdown', round: 1, hp: [300, 300], history: [], hashes: [null, null], committed: [false, false], names: ['Host', 'Friend'] });
    room.tick(reset.deadline);
    const next = room.snapshot(reset.deadline);
    expect(['fixture-1', 'fixture-2']).toContain(next.promptId);
    expect(room.commit(0, before.matchId, 1, 'a'.repeat(64), next.now + 1)).toBe(false);
  });

  it('shuffles a copy of the pool without mutating or losing its IDs', () => {
    const original = [...fixture.ids];
    const frozen = Object.freeze([...original]);
    const result = shuffled(frozen);
    expect(result).not.toBe(frozen);
    expect(frozen).toEqual(original);
    expect([...result].sort()).toEqual([...original].sort());
    expect(new Set(result).size).toBe(original.length);
  });
});

describe('deadlines, disconnects, and recovery', () => {
  it('rejects a commitment exactly at the deadline and resolves two missing answers as zero', async () => {
    const room = engine();
    const q = begin(room);
    const hash = await commitment(q.matchId, q.round, 0, q.promptId!, 'Gem', 'late');
    expect(room.commit(0, q.matchId, q.round, hash, q.deadline)).toBe(false);
    room.tick(q.deadline);
    const result = room.snapshot(q.deadline);
    expect(result.phase).toBe('result');
    expect(result.history[0].results.map(answer => answer.points)).toEqual([0, 0]);
    expect(result.hp).toEqual([300, 300]);
  });

  it('keeps one committed answer private until question time expires, then scores only its verified reveal', async () => {
    const room = engine();
    const q = begin(room);
    const hash = await commitment(q.matchId, q.round, 0, q.promptId!, 'Clever', 'one-player');
    room.commit(0, q.matchId, q.round, hash, q.now + 1);
    room.tick(q.deadline - 1);
    expect(room.snapshot(q.deadline - 1).phase).toBe('question');
    room.tick(q.deadline);
    expect(room.snapshot(q.deadline).phase).toBe('reveal');
    expect(await room.reveal(0, q.matchId, q.round, 'Clever', 'one-player', q.deadline + 1)).toBe(true);
    expect(room.snapshot(q.deadline + 1).hp).toEqual([300, 285]);
  });

  it('rejects a reveal at its deadline without granting a late score', async () => {
    const room = engine();
    const { question: q, inputs, salts } = await committed(room);
    const deadline = room.snapshot(q.now).deadline;
    expect(await room.reveal(0, q.matchId, q.round, inputs[0], salts[0], deadline)).toBe(false);
    room.tick(deadline);
    expect(room.snapshot(deadline).history[0].results.map(answer => answer.points)).toEqual([0, 0]);
  });

  it('pauses the shared clock during a short disconnect and resumes the same prompt with remaining time', async () => {
    const room = engine();
    const q = begin(room);
    const droppedAt = q.now + 1000;
    room.connection(false, droppedAt);
    const resumedAt = droppedAt + 29_000;
    room.tick(resumedAt - 1);
    expect(room.snapshot(resumedAt - 1).phase).toBe('question');
    expect(room.snapshot(resumedAt - 1).history).toHaveLength(0);
    room.join('Friend', resumedAt);
    const resumed = room.snapshot(resumedAt);
    expect(resumed.promptId).toBe(q.promptId);
    expect(resumed.deadline).toBe(q.deadline + 29_000);
    expect(resumed.reconnectUntil).toBeNull();
    const hash = await commitment(q.matchId, q.round, 0, q.promptId!, 'Common', 'after-reconnect');
    expect(room.commit(0, q.matchId, q.round, hash, resumedAt + 1)).toBe(true);
  });

  it('rejects new commitments while disconnected', async () => {
    const room = engine();
    const q = begin(room);
    room.connection(false, q.now + 1);
    const hash = await commitment(q.matchId, q.round, 0, q.promptId!, 'Gem', 'offline');
    expect(room.commit(0, q.matchId, q.round, hash, q.now + 2)).toBe(false);
    expect(room.snapshot(q.now + 2).committed).toEqual([false, false]);
  });

  it('does not revive a match when a guest rejoins after grace before the next timer tick', () => {
    const room = engine();
    const q = begin(room);
    room.connection(false, q.now + 100);
    room.join('Friend', q.now + 100 + GRACE_MS + 1);
    const state = room.snapshot(q.now + 100 + GRACE_MS + 1);
    expect(state.phase).toBe('finished');
    expect(state.winner).toBe(0);
    expect(state.history).toHaveLength(0);
    expect(state.hp).toEqual([300, 300]);
  });

  it('forfeits without adding fabricated scores and returns detached snapshots', () => {
    const room = engine();
    const q = begin(room);
    room.forfeit(0);
    const state = room.snapshot(q.now);
    expect(state).toMatchObject({ phase: 'finished', winner: 1, hp: [300, 300], history: [] });
    state.hp[0] = 0;
    state.names[0] = 'mutated externally';
    expect(room.snapshot(q.now).hp).toEqual([300, 300]);
    expect(room.snapshot(q.now).names[0]).toBe('Host');
  });
});
