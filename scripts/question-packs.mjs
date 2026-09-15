import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { digest, normalizeAnswer, validateInputs } from './curated-scoring.mjs';

export const MAX_PACKS = 100;
export const MAX_QUESTIONS_PER_PACK = 100;
const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const assert = (condition, message) => { if (!condition) throw new Error(message); };

export function draftQuestionPack(id) {
  assert(typeof id === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id), 'Use a lowercase hyphenated pack ID, e.g. nasa-history.');
  return {
    schemaVersion: 1, id, title: 'TODO: descriptive pack title', status: 'draft',
    questions: [{
      id: `curated-${id}-topic`, category: 'TODO', prompt: 'TODO: independently written question',
      rules: 'TODO: exact eligibility, exclusions and dates; no answer spoilers', reviewedAt: '',
      sources: [{ title: 'TODO: authoritative membership source', url: '', retrievedAt: '' }],
      answers: [{ answer: 'TODO: complete eligible set, minimum two answers', aliases: [], entityId: '', article: '' }],
    }],
  };
}

export function validatePack(pack, filename) {
  assert(pack && typeof pack === 'object' && !Array.isArray(pack) && pack.schemaVersion === 1, `${filename}: expected question-pack schema 1`);
  assert(typeof pack.id === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pack.id) && filename === `${pack.id}.json`, `${filename}: pack ID must match its filename`);
  assert(pack.status === 'reviewed', `${filename}: draft or unreviewed pack; complete manual source review before publishing`);
  assert(typeof pack.title === 'string' && pack.title.trim(), `${filename}: missing pack title`);
  assert(Array.isArray(pack.questions) && pack.questions.length > 0 && pack.questions.length <= MAX_QUESTIONS_PER_PACK, `${filename}: expected 1–${MAX_QUESTIONS_PER_PACK} reviewed questions`);
  validateInputs(pack.questions);
  return pack;
}

/** Exact normalized duplicates are mechanical checks; semantic overlap still needs review. */
export function mergeReviewedQuestions(base, packs, archive = [], corrections = []) {
  const questions = validateInputs([...validateInputs(base), ...packs.flatMap(pack => pack.questions)]);
  const archiveIds = new Set(archive.map(question => question.id));
  const archiveTexts = new Map(archive.map(question => [normalizeAnswer(question.prompt), question.id]));
  for (const correction of corrections) if (correction.prompt) archiveTexts.set(normalizeAnswer(correction.prompt), correction.promptId);
  for (const question of questions) {
    assert(!archiveIds.has(question.id), `${question.id}: duplicate question ID in historical bank`);
    const duplicate = archiveTexts.get(normalizeAnswer(question.prompt));
    assert(!duplicate, `${question.id}: duplicate prompt already in historical bank (${duplicate})`);
  }
  return questions;
}

export async function loadReviewedInputs(root) {
  const inputFiles = [];
  async function readInput(relative) {
    const text = await readFile(resolve(root, relative), 'utf8');
    assert(Buffer.byteLength(text) <= MAX_INPUT_BYTES, `${relative}: input exceeds 2 MiB`);
    const value = JSON.parse(text);
    inputFiles.push({ path: relative, sha256: digest(value) });
    return value;
  }
  const base = await readInput('data/curated-questions.json');
  const directory = resolve(root, 'data/question-packs');
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; entries = []; }
  const files = entries.filter(entry => entry.name.endsWith('.json')).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  assert(files.length <= MAX_PACKS, `Expected at most ${MAX_PACKS} question packs`);
  const packs = [];
  for (const file of files) {
    assert(file.isFile(), `${file.name}: question packs must be regular JSON files`);
    packs.push(validatePack(await readInput(`data/question-packs/${file.name}`), file.name));
  }
  const archive = JSON.parse(await readFile(resolve(root, 'src/catalog.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(resolve(root, 'public/catalog-corrections.json'), 'utf8'));
  const questions = mergeReviewedQuestions(base, packs, archive, manifest.corrections);
  return { questions, inputFiles, packs: packs.map(({ id, title, questions }) => ({ id, title, questionIds: questions.map(question => question.id) })) };
}
