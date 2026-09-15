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
vi.mock('../src/hints', async importOriginal => ({
  ...await importOriginal<typeof import('../src/hints')>(),
  getPromptHints: (id: string) => id.startsWith('fixture-') ? ['First context', 'More context', 'Deeper context'] : [],
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

async function committed(room: DuelEngine, hostInput = 'Gem', guestInput = 'Common', start?: number) {
  const question = begin(room, start);
  const salts = [`host-salt-${question.round}`, `guest-salt-${question.round}`] as const;
  const inputs = [hostInput, guestInput] as const;
  const hashes = await Promise.all(([0, 1] as const).map(seat =>
    commitment(question.matchId, question.round, seat, question.promptId!, inputs[seat], salts[seat])));
  expect(room.commit(0, question.matchId, question.round, hashes[0], question.now + 1)).toBe(true);
  expect(room.commit(1, question.matchId, question.round, hashes[1], question.now + 2)).toBe(true);
  expect(room.snapshot(question.now + 2).phase).toBe('reveal');
  return { question, inputs, salts, hashes };
}

async function play(room: DuelEngine, hostInput = 'Common', guestInput = 'Common', start?: number) {
  const round = await committed(room, hostInput, guestInput, start);
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

describe('authoritative progressive hint purchases', () => {
  it('charges escalating match totals per player, caps levels, and carries the price into the next round', () => {
    const room = engine();
    const q = begin(room);
    for (let level = 0; level < 3; level++) expect(room.hint(0, q.matchId, q.round, level, q.now + 1)).toBe(true);
    expect(room.hint(0, q.matchId, q.round, 3, q.now + 1)).toBe(false);
    expect(room.hint(1, q.matchId, q.round, 0, q.now + 1)).toBe(true);
    expect(room.snapshot(q.now + 1)).toMatchObject({ hp: [210, 285], hintUses: [3, 1], hintLevels: [3, 1] });
    room.tick(q.deadline);
    const next = begin(room);
    expect(next.hintLevels).toEqual([0, 0]);
    expect(next.hintUses).toEqual([3, 1]);
    expect(room.hint(0, next.matchId, next.round, 0, next.now)).toBe(true);
    expect(room.snapshot(next.now).hp).toEqual([150, 285]);
  });

  it('makes duplicate delivery idempotent through persistence and answer locking', () => {
    let room = engine();
    const q = begin(room);
    expect(room.hint(0, q.matchId, q.round, 1, q.now)).toBe(false);
    expect(room.hint(0, q.matchId, q.round, 0, q.now)).toBe(true);
    room = DuelEngine.restore(JSON.parse(JSON.stringify(room.store(q.now))));
    expect(room.hint(0, q.matchId, q.round, 0, q.now)).toBe(true);
    expect(room.commit(0, q.matchId, q.round, 'a'.repeat(64), q.now)).toBe(true);
    expect(room.hint(0, q.matchId, q.round, 0, q.now)).toBe(true);
    expect(room.hint(0, q.matchId, q.round, 1, q.now)).toBe(false);
    expect(room.snapshot(q.now)).toMatchObject({ hp: [285, 300], hintUses: [1, 0], hintLevels: [1, 0] });
    room.tick(q.deadline); room.tick(q.deadline + 6000);
    expect(room.hint(0, q.matchId, q.round, 0, q.deadline + 6000)).toBe(true);
    expect(room.hint(0, q.matchId, q.round, 1, q.deadline + 6000)).toBe(false);
    const next = begin(room);
    expect(room.hint(0, q.matchId, q.round, 0, next.now)).toBe(false);
  });

  it('rejects expired, disconnected, invalid, unaffordable and unauthored requests without charging', () => {
    const room = engine();
    const q = begin(room);
    for (const level of [-1, 0.5, NaN, 4]) expect(room.hint(0, q.matchId, q.round, level, q.now)).toBe(false);
    expect(room.hint(0, 'wrong-match', q.round, 0, q.now)).toBe(false);
    expect(room.hint(0, q.matchId, q.round, 0, q.deadline)).toBe(false);
    room.connection(false, q.now);
    expect(room.hint(0, q.matchId, q.round, 0, q.now)).toBe(false);
    expect(room.snapshot(q.now).hintUses).toEqual([0, 0]);
    room.connection(true, q.now);
    for (const hp of [14, 15]) {
      const saved = room.store(); saved.state.hp[0] = hp;
      const poor = DuelEngine.restore(saved);
      expect(poor.hint(0, q.matchId, q.round, 0, q.now)).toBe(false);
      expect(poor.snapshot(q.now).hp[0]).toBe(hp);
    }
    const noHints = engine(['blank-fixture']);
    const noHintQuestion = begin(noHints);
    expect(noHints.hint(0, noHintQuestion.matchId, 1, 0, noHintQuestion.now)).toBe(false);
  });

  it('resets both counters on rematch and restores legacy rooms with zero counters', () => {
    const room = engine();
    const q = begin(room);
    room.hint(0, q.matchId, q.round, 0, q.now);
    room.forfeit(1);
    const rematch = begin(room);
    expect(rematch).toMatchObject({ hintUses: [0, 0], hintLevels: [0, 0], hp: [300, 300] });
    expect(room.hint(0, q.matchId, rematch.round, 0, rematch.now)).toBe(false);
    const saved = room.store();
    delete (saved.state as Partial<typeof saved.state>).hintUses;
    delete (saved.state as Partial<typeof saved.state>).hintLevels;
    expect(DuelEngine.restore(saved).snapshot(rematch.now)).toMatchObject({ hintUses: [0, 0], hintLevels: [0, 0] });
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

describe('question rotation across rematches in one room', () => {
  function sessionRoom(pool = fixture.ids.slice(0, 6)): DuelEngine {
    // Keep reshuffles deterministic: restarting the whole bank after an early
    // finish would always repeat its first question and fail these regressions.
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(value => value);
    const room = new DuelEngine('Host', 'session-fixture', pool, {
      startingHp: 100, questionSeconds: 25, damageScaling: false,
    });
    room.join('Friend', 0);
    return room;
  }

  function persisted(room: DuelEngine, now: number): DuelEngine {
    return DuelEngine.restore(JSON.parse(JSON.stringify(room.store(now))));
  }

  it('continues with an unused question after an early knockout while resetting match state', async () => {
    const room = sessionRoom();
    const order = room.store().order;
    const first = await play(room, 'Gem', '', 100_000);
    expect(first).toMatchObject({ phase: 'finished', round: 1, hp: [100, 0], winner: 0 });
    expect(first.history[0].promptId).toBe(order[0]);

    room.ready(0, 200_000);
    expect(room.snapshot(200_000)).toMatchObject({ phase: 'finished', matchId: first.matchId });
    room.ready(1, 200_000);
    const reset = room.snapshot(200_000);
    expect(reset.matchId).not.toBe(first.matchId);
    expect(reset).toMatchObject({ phase: 'countdown', round: 1, promptId: null, hp: [100, 100], history: [], hashes: [null, null], committed: [false, false] });
    room.tick(reset.deadline);
    expect(room.snapshot(reset.deadline).promptId).toBe(order[1]);
    expect(room.snapshot(reset.deadline)).not.toHaveProperty('order');
    expect(room.snapshot(reset.deadline)).not.toHaveProperty('nextPromptIndex');
  });

  it('preserves an unseen countdown question but consumes a shown question even without a result', () => {
    let room = sessionRoom();
    const order = room.store().order;
    room.ready(0, 1000); room.ready(1, 1000);
    room.tick(3999);
    expect(room.snapshot(3999)).toMatchObject({ phase: 'countdown', promptId: null, history: [] });
    room = persisted(room, 3999);
    room.forfeit(1);
    const shown = begin(room, 10_000);
    expect(shown.promptId).toBe(order[0]);
    room.tick(shown.now + 1); room.tick(shown.now + 2);
    room = persisted(room, shown.now + 2);
    room.forfeit(0);
    expect(room.snapshot(shown.now + 2).history).toEqual([]);
    const next = begin(room, 20_000);
    expect(next.promptId).toBe(order[1]);
  });

  it('uses the full bank across several matches, then permits a complete new cycle', async () => {
    let room = sessionRoom();
    const order = room.store().order;
    const seen: string[] = [];
    let now = 0;
    const round = async (host = 'Common', guest = 'Common') => {
      now += 100_000;
      const result = await play(room, host, guest, now);
      seen.push(result.history.at(-1)!.promptId);
      room = persisted(room, now + 10_000);
      return result;
    };

    // One-question knockout, then a two-question match ended by a forfeit.
    expect((await round('Gem', '')).phase).toBe('finished');
    expect((await round()).phase).toBe('result');
    expect((await round()).phase).toBe('result');
    room.forfeit(1);
    room = persisted(room, now + 20_000);

    // Only three unseen questions remain. Exhaustion must use the room's bank
    // position, not this rematch's round number or its reset result history.
    expect((await round()).phase).toBe('result');
    expect((await round()).phase).toBe('result');
    const exhausted = await round();
    expect(exhausted).toMatchObject({ phase: 'finished', round: 3, winner: null, hp: [100, 100] });
    expect(exhausted.history).toHaveLength(3);
    expect(seen).toEqual(order);
    expect(new Set(seen).size).toBe(order.length);

    const firstMatchId = exhausted.matchId;
    for (let index = 0; index < order.length; index++) {
      const result = await round();
      expect(result.matchId).not.toBe(firstMatchId);
      expect(result.phase).toBe(index === order.length - 1 ? 'finished' : 'result');
    }
    expect(seen.slice(order.length).sort()).toEqual([...order].sort());
    expect(new Set(seen.slice(order.length)).size).toBe(order.length);
  });

  it('starts a fresh cycle after forfeiting the final shown question', () => {
    let room = sessionRoom(fixture.ids.slice(0, 1));
    const shown = begin(room, 100_000);
    room.forfeit(1);
    room = persisted(room, shown.now + 1);
    const replay = begin(room, 200_000);
    expect(replay.promptId).toBe(shown.promptId);
    expect(replay.matchId).not.toBe(shown.matchId);
    room.tick(replay.deadline);
    expect(room.snapshot(replay.deadline)).toMatchObject({ phase: 'finished', winner: null });
    expect(room.snapshot(replay.deadline).history).toHaveLength(1);
  });

  it.each(['countdown', 'question'] as const)('restores legacy storage in %s without replaying shown questions', async phase => {
    const room = sessionRoom();
    const order = room.store().order;
    await play(room, 'Common', 'Common', 100_000);
    room.ready(0, 200_000); room.ready(1, 200_000);
    if (phase === 'question') room.tick(203_000);
    const legacy = room.store(203_000);
    delete (legacy as typeof legacy & { nextPromptIndex?: number }).nextPromptIndex;
    const restored = DuelEngine.restore(JSON.parse(JSON.stringify(legacy)));
    restored.forfeit(1);
    const next = begin(restored, 300_000);
    expect(next.promptId).toBe(order[phase === 'question' ? 2 : 1]);
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

  it('pauses reveals during a disconnect and accepts them after reconnecting with the remaining time', async () => {
    const room = engine();
    const { question: q, inputs, salts } = await committed(room);
    const revealDeadline = room.snapshot(q.now).deadline;
    room.connection(false, q.now + 3);
    expect(await room.reveal(0, q.matchId, q.round, inputs[0], salts[0], q.now + 4)).toBe(false);
    expect(await room.reveal(1, q.matchId, q.round, inputs[1], salts[1], q.now + 4)).toBe(false);
    expect(room.snapshot(q.now + 4)).toMatchObject({ phase: 'reveal', history: [], hp: [300, 300] });

    const resumedAt = q.now + 20_003;
    room.join('Friend', resumedAt);
    expect(room.snapshot(resumedAt).deadline).toBe(revealDeadline + 20_000);
    expect(await room.reveal(0, q.matchId, q.round, inputs[0], salts[0], resumedAt + 1)).toBe(true);
    expect(await room.reveal(1, q.matchId, q.round, inputs[1], salts[1], resumedAt + 2)).toBe(true);
    expect(room.snapshot(resumedAt + 2)).toMatchObject({ phase: 'result', hp: [300, 210] });
    expect(room.snapshot(resumedAt + 2).history).toHaveLength(1);
  });

  it('leaves an in-flight reveal retryable when the connection drops during hash verification', async () => {
    const room = engine();
    const { question: q, inputs, salts, hashes } = await committed(room);
    const bytes = Uint8Array.from(hashes[0].match(/../g)!, part => Number.parseInt(part, 16));
    let finishDigest!: (value: ArrayBuffer) => void;
    vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(() => new Promise<ArrayBuffer>(resolve => { finishDigest = resolve; }));
    const pending = room.reveal(0, q.matchId, q.round, inputs[0], salts[0], q.now + 3);
    room.connection(false, q.now + 4);
    finishDigest(bytes.buffer as ArrayBuffer);
    expect(await pending).toBe(false);
    expect(room.snapshot(q.now + 4).history).toEqual([]);

    room.join('Friend', q.now + 1_004);
    expect(await room.reveal(0, q.matchId, q.round, inputs[0], salts[0], q.now + 1_005)).toBe(true);
    expect(await room.reveal(1, q.matchId, q.round, inputs[1], salts[1], q.now + 1_006)).toBe(true);
    expect(room.snapshot(q.now + 1_006).history[0].results.map(answer => answer.points)).toEqual([100, 10]);
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
// Append this entire block to tests/engine.test.ts after the existing fixture/helpers/tests.
// Reuses its imported describe/it/expect, DuelEngine and begin/play helpers, and fixture.ids.
import { DEFAULT_SETTINGS as SETTINGS_DEFAULTS, validSettings as isValidDuelSettings } from '../src/duel-engine';
import type { DuelSettings as SettingsUnderTest } from '../src/duel-engine';

describe('custom duel settings', () => {
  function configured(overrides: Partial<SettingsUnderTest> = {}, pool = fixture.ids): DuelEngine {
    const room = new DuelEngine('Host', 'settings-fixture-match', pool, { ...SETTINGS_DEFAULTS, ...overrides });
    room.join('Friend', 0);
    return room;
  }

  it('uses the declared defaults when no settings are supplied', () => {
    const room = new DuelEngine('Host', 'default-settings-match', fixture.ids);
    expect(SETTINGS_DEFAULTS).toEqual({ startingHp: 300, questionSeconds: 25, damageScaling: true });
    expect(room.snapshot(0).settings).toEqual(SETTINGS_DEFAULTS);
    expect(room.snapshot(0).hp).toEqual([300, 300]);
    expect(isValidDuelSettings(SETTINGS_DEFAULTS)).toBe(true);
  });

  it.each([100, 101, 149, 300, 500, 1000, 9999, 10_000])('accepts custom integer HP %i without snapping it to the UI step', startingHp => {
    const settings = { ...SETTINGS_DEFAULTS, startingHp };
    expect(isValidDuelSettings(settings)).toBe(true);
    const room = configured({ startingHp });
    expect(room.snapshot(0).settings.startingHp).toBe(startingHp);
    expect(room.snapshot(0).hp).toEqual([startingHp, startingHp]);
  });

  it.each([15, 25, 45, 60, 90])('gives both players the chosen %i-second question deadline', questionSeconds => {
    const room = configured({ questionSeconds });
    const question = begin(room);
    expect(question.settings.questionSeconds).toBe(questionSeconds);
    expect(question.deadline - question.now).toBe(questionSeconds * 1000);
    room.tick(question.deadline - 1);
    expect(room.snapshot(question.deadline - 1).phase).toBe('question');
    room.tick(question.deadline);
    expect(room.snapshot(question.deadline).history[0].results.map(answer => answer.points)).toEqual([0, 0]);
  });

  it.each([
    0, -1, 99, 10_001, 300.5, NaN, Infinity, -Infinity, '300', null, true,
  ])('rejects invalid HP value %s instead of coercing or silently defaulting it', startingHp => {
    const settings = { ...SETTINGS_DEFAULTS, startingHp };
    expect(isValidDuelSettings(settings)).toBe(false);
    expect(() => new DuelEngine('Host', 'invalid-hp-match', fixture.ids, settings as SettingsUnderTest)).toThrow();
  });

  it.each([0, -1, 10, 20, 30, 91, 25.5, NaN, Infinity, '25', null])('rejects invalid timer value %s', questionSeconds => {
    const settings = { ...SETTINGS_DEFAULTS, questionSeconds };
    expect(isValidDuelSettings(settings)).toBe(false);
    expect(() => new DuelEngine('Host', 'invalid-timer-match', fixture.ids, settings as SettingsUnderTest)).toThrow();
  });

  it.each([0, 1, '', 'false', 'true', null, undefined])('requires damageScaling to be a literal boolean, not %s', damageScaling => {
    const settings = { ...SETTINGS_DEFAULTS, damageScaling };
    expect(isValidDuelSettings(settings)).toBe(false);
    expect(() => new DuelEngine('Host', 'invalid-scaling-match', fixture.ids, settings as unknown as SettingsUnderTest)).toThrow();
  });

  it('rejects missing fields, arrays, and unknown setting fields from a protocol payload', () => {
    const invalid = [
      null, false, 300, [], {},
      { startingHp: 300, questionSeconds: 25 },
      { startingHp: 300, damageScaling: true },
      { questionSeconds: 25, damageScaling: true },
      { ...SETTINGS_DEFAULTS, maxRounds: 15 },
      { ...SETTINGS_DEFAULTS, opponentHp: 1 },
    ];
    for (const settings of invalid) {
      expect(isValidDuelSettings(settings)).toBe(false);
      expect(() => new DuelEngine('Host', 'invalid-shape-match', fixture.ids, settings as SettingsUnderTest)).toThrow();
    }
    // Omitted constructor settings may default, but an omitted field in a received snapshot may not.
    expect(isValidDuelSettings(undefined)).toBe(false);
  });

  it('copies settings at construction and does not expose mutable engine settings through snapshots', () => {
    const input = { startingHp: 175, questionSeconds: 45, damageScaling: false };
    const room = new DuelEngine('Host', 'settings-copy-match', fixture.ids, input);
    input.startingHp = 10_000;
    input.questionSeconds = 90;
    input.damageScaling = true;
    expect(room.snapshot(0).settings).toEqual({ startingHp: 175, questionSeconds: 45, damageScaling: false });
    const view = room.snapshot(0);
    view.settings.startingHp = 100;
    view.settings.questionSeconds = 15;
    view.settings.damageScaling = true;
    expect(room.snapshot(0).settings).toEqual({ startingHp: 175, questionSeconds: 45, damageScaling: false });
    expect(room.snapshot(0).hp).toEqual([175, 175]);
    expect(SETTINGS_DEFAULTS).toEqual({ startingHp: 300, questionSeconds: 25, damageScaling: true });
  });

  it('keeps damage at 1× past rounds 5 and 8 when scaling is disabled', async () => {
    const room = configured({ startingHp: 1000, damageScaling: false });
    for (let round = 0; round < 8; round++) await play(room, 'Clever', 'Common');
    const state = room.snapshot(1_000_000);
    expect(state.round).toBe(8);
    expect(state.history.map(round => round.multiplier)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect(state.history.map(round => round.damage)).toEqual([5, 5, 5, 5, 5, 5, 5, 5]);
    expect(state.hp).toEqual([1000, 960]);
  });

  it('uses the normal round-5 and round-8 ramp when scaling is enabled', async () => {
    const room = configured({ startingHp: 1000, damageScaling: true });
    for (let round = 0; round < 8; round++) await play(room, 'Clever', 'Common');
    const state = room.snapshot(1_000_000);
    expect(state.history.map(round => round.multiplier)).toEqual([1, 1, 1, 1, 2, 2, 2, 3]);
    expect(state.history.map(round => round.damage)).toEqual([5, 5, 5, 5, 10, 10, 10, 15]);
    expect(state.hp).toEqual([1000, 935]);
  });

  it('applies normal damage to HP above 300 without clamping it to the old default', async () => {
    const room = configured({ startingHp: 10_000 });
    const state = await play(room, 'Common', '');
    expect(state.hp).toEqual([10_000, 9990]);
    expect(state.phase).toBe('result');
    expect(state.settings.startingHp).toBe(10_000);
  });

  it('ends a low-HP match on knockout and clamps only at zero', async () => {
    const room = configured({ startingHp: 100 });
    expect((await play(room, 'Gem', 'Common')).hp).toEqual([100, 10]);
    const final = await play(room, 'Gem', 'Common');
    expect(final.hp).toEqual([100, 0]);
    expect(final.phase).toBe('finished');
    expect(final.winner).toBe(0);
  });

  it('preserves custom settings on rematch while resetting HP, history, and the timer', async () => {
    const selected = { startingHp: 175, questionSeconds: 90, damageScaling: false };
    const room = configured(selected, ['fixture-1', 'fixture-2']);
    await play(room, 'Clever', 'Common');
    const previous = await play(room, 'Common', 'Common');
    expect(previous.phase).toBe('finished');
    expect(previous.hp).toEqual([175, 170]);
    room.ready(0, 1_000_000);
    room.ready(1, 1_000_000);
    const reset = room.snapshot(1_000_000);
    expect(reset.matchId).not.toBe(previous.matchId);
    expect(reset.settings).toEqual(selected);
    expect(reset.hp).toEqual([175, 175]);
    expect(reset.history).toEqual([]);
    expect(reset.phase).toBe('countdown');
    room.tick(reset.deadline);
    const question = room.snapshot(reset.deadline);
    expect(question.deadline - question.now).toBe(90_000);
    expect(question.settings.damageScaling).toBe(false);
  });
});
