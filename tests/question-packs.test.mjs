import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { draftQuestionPack, loadReviewedInputs, mergeReviewedQuestions, validatePack } from '../scripts/question-packs.mjs';
import { MAX_REVIEWED_QUESTIONS, missingArticleCount, resolutionUrl, validateInputs } from '../scripts/curated-scoring.mjs';

function question(id = 'fixture') {
  return {
    id: `curated-${id}`, category: 'Test', prompt: `Name a ${id} fixture`, rules: 'Two eligible test entities.',
    reviewedAt: '2026-09-15', sources: [{ title: 'Fixture', url: 'https://example.org/facts' }],
    answers: ['One', 'Two'].map((answer, index) => ({ answer, aliases: [], article: answer, entityId: `Q${index + 1}` })),
  };
}
const pack = id => ({ schemaVersion: 1, id, title: 'Test pack', status: 'reviewed', questions: [question(id)] });
const temporary = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), 'krill-question-packs-')); temporary.push(root);
  await save(root, 'data/curated-questions.json', [question('base')]);
  await save(root, 'src/catalog.json', [{ id: 'archive-fixture', prompt: 'Name a historical item' }]);
  await save(root, 'public/catalog-corrections.json', { corrections: [{ promptId: 'archive-fixture', prompt: 'Name a corrected item' }] });
  return root;
}
async function save(root, file, value) {
  const path = join(root, file); await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value)}\n`);
}

describe('reviewed question packs', () => {
  it('loads the existing base, then filename-sorted packs, with stable source hashes', async () => {
    const root = await fixtureRoot();
    await save(root, 'data/question-packs/zeta.json', pack('zeta'));
    await save(root, 'data/question-packs/alpha.json', pack('alpha'));
    await save(root, 'data/question-drafts/unreviewed.json', draftQuestionPack('unreviewed'));
    const result = await loadReviewedInputs(root);
    expect(result.questions.map(q => q.id)).toEqual(['curated-base', 'curated-alpha', 'curated-zeta']);
    expect(result.inputFiles.map(file => file.path)).toEqual(['data/curated-questions.json', 'data/question-packs/alpha.json', 'data/question-packs/zeta.json']);
    expect(result.inputFiles.every(file => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true);
    expect(await loadReviewedInputs(root)).toEqual(result);
  });

  it('supports the original bank without a pack directory', async () => {
    const result = await loadReviewedInputs(await fixtureRoot());
    expect(result.questions).toHaveLength(1); expect(result.packs).toEqual([]);
  });

  it('fails an active draft rather than silently shipping or skipping it', async () => {
    const root = await fixtureRoot();
    await save(root, 'data/question-packs/draft.json', draftQuestionPack('draft'));
    await expect(loadReviewedInputs(root)).rejects.toThrow('draft or unreviewed pack');
    expect(() => validateInputs([{ ...question(), status: 'draft' }])).toThrow('draft or unreviewed question');
  });

  it('rejects malformed pack metadata, unreviewed facts and ambiguous aliases', () => {
    for (const change of [{ schemaVersion: 2 }, { id: 'different' }, { title: '' }, { status: 'pending' }, { questions: [] }]) {
      expect(() => validatePack({ ...pack('valid'), ...change }, 'valid.json')).toThrow();
    }
    const invalid = pack('valid'); invalid.questions[0].sources = [];
    expect(() => validatePack(invalid, 'valid.json')).toThrow('missing factual sources');
    invalid.questions[0] = question(); invalid.questions[0].answers[1].aliases = ['ONE'];
    expect(() => validatePack(invalid, 'valid.json')).toThrow('ambiguous alias');
  });

  it('detects duplicate IDs/text across the base and packs and both archive wordings', async () => {
    const root = await fixtureRoot();
    const candidate = pack('duplicate'); candidate.questions[0].id = 'curated-base';
    await save(root, 'data/question-packs/duplicate.json', candidate);
    await expect(loadReviewedInputs(root)).rejects.toThrow('duplicate question ID');
    for (const prompt of ['NAME A BASE FIXTURE!', 'Name a historical item?', 'Name a corrected item.']) {
      candidate.questions[0] = { ...question('duplicate'), prompt };
      await save(root, 'data/question-packs/duplicate.json', candidate);
      await expect(loadReviewedInputs(root)).rejects.toThrow('duplicate prompt');
    }
    expect(() => mergeReviewedQuestions([question()], [], [{ id: 'curated-fixture', prompt: 'Other text' }])).toThrow('duplicate question ID');
  });

  it('allows expansion beyond 40 but retains explicit catalog and pack bounds', () => {
    const questions = Array.from({ length: 41 }, (_, i) => question(`item-${i}`));
    expect(validateInputs(questions)).toHaveLength(41);
    expect(() => validateInputs(Array(MAX_REVIEWED_QUESTIONS + 1).fill(question()))).toThrow(`1–${MAX_REVIEWED_QUESTIONS}`);
    expect(() => validatePack({ ...pack('large'), questions: Array.from({ length: 101 }, (_, i) => question(`item-${i}`)) }, 'large.json')).toThrow('1–100');
  });

  it('scaffolds explicitly invalid drafts and prevents path traversal in their IDs', () => {
    const draft = draftQuestionPack('nasa-history');
    expect(draft.status).toBe('draft'); expect(draft.questions[0].reviewedAt).toBe('');
    expect(draft.questions[0].answers[0].entityId).toBe('');
    expect(() => validatePack(draft, 'nasa-history.json')).toThrow('manual source review');
    for (const id of ['../outside', 'UPPER', '', 'a/b']) expect(() => draftQuestionPack(id)).toThrow();
  });

  it('limits missing articles without counting hundreds of complete cached series', () => {
    const answers = Array.from({ length: 600 }, (_, i) => ({ answer: `Article ${i}`, article: `Article_${i}`, entityId: `Q${i + 1}` }));
    const cache = { resolutions: {}, pageviews: {} };
    for (const [i, answer] of answers.entries()) {
      const title = answer.article.replaceAll('_', ' ');
      cache.resolutions[title] = { sourceUrl: resolutionUrl(answer.article), retrievedAt: '2026-09-15', response: { query: { pages: [{ pageid: i + 1, ns: 0, title, pageprops: { wikibase_item: answer.entityId } }] } } };
      cache.pageviews[title] = { cached: true };
    }
    expect(missingArticleCount([{ answers }], cache)).toBe(0);
    delete cache.resolutions['Article 0']; delete cache.pageviews['Article 1'];
    expect(missingArticleCount([{ answers: [...answers, answers[0]] }], cache)).toBe(2);
    cache.resolutions['Article 2'].response.query.pages[0].pageprops.wikibase_item = 'Q999999';
    expect(() => missingArticleCount([{ answers }], cache)).toThrow('identity mismatch');
  });
});
