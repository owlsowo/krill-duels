import './style.css';
import '@fontsource-variable/space-grotesk';
import '@fontsource/press-start-2p/latin-400.css';
import { PROMPTS, promptById } from './data';
import { multiplier, type DuelState } from './duel-engine';
import { DEFAULT_SETTINGS, TIME_OPTIONS, validSettings, type DuelSettings } from './settings';
import { PracticeSession } from './practice';
import { AnswerIndex } from './match';
import type { Prompt } from './types';
import { scoreLabel, scoringLabel, scoringExplanation } from './scoring-description';
import { DuelRoom, roomFromHash, HTTPS_ROOMS } from './room';
import { getPromptHints, hintCost } from './hints';
import { hintMarkup } from './hint-display';
import { clockMarkup, duelRemaining, duelTimer, questionTimer, timerMarkup, type TimerDisplay } from './timer-display';

const app = document.querySelector<HTMLElement>('#app')!;
const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]!);
let room: DuelRoom | null = null;
let practice: PracticeSession | null = null;
let mode: 'solo' | 'duel' = 'duel';
let settings: DuelSettings = { ...DEFAULT_SETTINGS };
try { const saved = JSON.parse(localStorage.getItem('krill-duels:settings') || 'null'); if (validSettings(saved)) settings = saved; } catch { /* Optional preferences. */ }
const ANSWER_COUNT = PROMPTS.reduce((count,prompt) => count + prompt.answers.length,0);
const roundFactor = (s: DuelState) => s.settings.damageScaling ? multiplier(s.round) : 1;
let state: DuelState | null = null;
let status = '';
let error = '';
let answerHint = '';
let answerSuggestions: string[] = [];
let joining = false;
let submitting = false;
let hintPending: object | null = null;
let hintMessage = '';
let offset = 0;
let lastKey = '';
let announced = '';
let savedName = 'Player';
try { savedName = localStorage.getItem('krill-duels:name') || 'Player'; } catch { /* Preferences are optional. */ }

app.innerHTML = `<div class="ocean" aria-hidden="true"></div><div class="shell"><header class="masthead"><a class="wordmark" href="${location.pathname}">KRILL<span>DUELS</span></a><span class="edition">RARE-ANSWER BATTLES</span><button class="quiet" data-action="help">How to play</button></header><div id="screen"></div><footer><span>Independent fan game · historical and estimated scores</span><a href="https://krillionanswers.com/data-sources/" target="_blank" rel="noopener">Archive source ↗</a><a href="https://github.com/owlsowo/krill-duels" target="_blank" rel="noopener">Source code ↗</a></footer></div><div id="announcement" class="sr-only" role="status" aria-live="polite"></div><dialog id="help"><button class="close" data-action="close-help" aria-label="Close instructions">×</button><div class="eyebrow">HOW TO PLAY</div><h2>Make your answer count.</h2><ol><li>Create a duel and send the invite link to a friend.</li><li>Choose HP, answer time, and damage rules when creating a duel. Both players press Ready to get the same random question.</li><li>Rare answers earn more points. The score difference damages the lower scorer’s HP.</li><li>With increasing damage enabled, damage doubles at round 5 and triples at round 8. Reach 0 HP and you’re out.</li></ol><p>Every question offers three spelling hints that guide you toward one accepted answer. Press Hint for starting letters, then More letters to uncover more of that same answer. The third hint leaves just one character to fill in. You can still submit a different answer. The hinted answer’s point value is shown before you buy. The next cost is shown beneath the button: 5%, 10%, 15% of starting HP and so on, increasing with every hint you buy in that match. Costs reset on Play again. You must have HP left after buying a hint. The timer keeps running. Hints are free in solo practice.</p><p>Solo practice uses the same questions and scores, without an opponent. In duels, questions don’t repeat within a room, including when you press Play again. After the whole bank is used, the next game starts a fresh shuffle. Both players need to keep their tabs open during a duel. No Krillion purchase or extension is needed.</p><p class="fine">Each question shows its scoring method. Historical scores are editorial grades; reviewed questions correct known answer-list errors. New questions use estimated familiarity from 2025 English Wikipedia readership, relative to the other accepted answers. News and language can affect that estimate. Equivalent names share a score where reviewed aliases are available; small spelling mistakes can offer a suggestion. Unlisted answers can be retried before time expires. This is casual play between friends.</p><button class="primary" data-action="close-help">Got it</button></dialog>`;
const screen = document.querySelector<HTMLElement>('#screen')!;

function announce(message: string): void {
  if (message === announced) return;
  announced = message;
  document.querySelector('#announcement')!.textContent = message;
}

function connectionReport(): string {
  return JSON.stringify({ ...(room?.diagnostics() ?? { stage: 'idle' }), online: navigator.onLine, browser: navigator.userAgent }, null, 2);
}

function connectionHelp(): string {
  return `<details class="connection-help"><summary>Connection help</summary><p>Keep both game tabs open and use the host’s latest invite. After an update, both refresh and create a new room.</p><p>If joining keeps failing, try another network or, if you use a VPN, another VPN server. Then try joining again.</p><p>${HTTPS_ROOMS ? 'This version connects through the website. Both players must use invites from this site.' : '<a href="https://krill-duels-play.owlsowo1.chatgpt.site/">Try the HTTPS version ↗</a> if joining keeps failing. Both players must open it and create a new room there.'} Still unable to connect? Copy the details below when reporting the problem.</p><label for="connection-report">Connection details</label><textarea id="connection-report" readonly rows="8" spellcheck="false">${esc(connectionReport())}</textarea><button class="quiet" data-action="copy-diagnostics">Copy connection details</button><span id="diagnostic-status" class="fine" role="status"></span></details>`;
}

function suggestionButtons(disabled = false): string {
  if (!answerSuggestions.length) return '';
  return `<div class="answer-suggestions" role="group" aria-label="Spelling suggestions"><span>Did you mean…?</span>${answerSuggestions.map(answer => `<button type="button" class="secondary" data-action="use-suggestion" data-answer="${esc(answer)}" ${disabled ? 'disabled' : ''}>${esc(answer)}</button>`).join('')}<small>Choose a spelling, then press Lock in to confirm.</small></div>`;
}

function playerCard(name: string, hp: number, side: number, detail: string): string {
  const maxHp = state?.settings.startingHp ?? settings.startingHp;
  return `<section class="player player-${side}"><div class="player-id"><span class="avatar" aria-hidden="true">${side === 0 ? '🦐' : '🦑'}</span><div><span class="player-label">${side === 0 ? 'PLAYER 01' : 'PLAYER 02'}</span><h2>${esc(name)}</h2></div><strong class="hp">${hp}<small> HP</small></strong></div><div class="health-track" role="meter" aria-label="${esc(name)} health" aria-valuemin="0" aria-valuemax="${maxHp}" aria-valuenow="${hp}"><div class="health-fill" style="width:${hp / maxHp * 100}%"></div></div><div class="player-status">${esc(detail)}</div></section>`;
}

function render(force = false): void {
  if (practice) { renderPractice(force); return; }
  const key = state ? JSON.stringify([state.matchId,state.phase,state.round,state.hp,state.ready,state.committed,state.connected,state.history.length,state.hintUses,state.hintLevels,status,error,submitting,!!hintPending,hintMessage,answerHint,answerSuggestions]) : `${joining}|${status}|${error}|${roomFromHash()}`;
  if (!force && key === lastKey) return;
  lastKey = key;
  const currentInput = screen.querySelector<HTMLInputElement>('#answer');
  const previousAnswer = currentInput?.value;
  const selection = currentInput?.selectionStart;
  const answerFocused = document.activeElement === currentInput;
  const previousName = screen.querySelector<HTMLInputElement>('#name')?.value;
  const openDetails = [...screen.querySelectorAll<HTMLDetailsElement>('details[open]')].map(detail => detail.className);
  const answerScroll = screen.querySelector('.answer-list')?.scrollTop ?? 0;
  const restoreDetails = () => {
    screen.querySelectorAll<HTMLDetailsElement>('details').forEach(detail => { detail.open = openDetails.includes(detail.className); });
    const answers = screen.querySelector('.answer-list'); if (answers) answers.scrollTop = answerScroll;
  };
  const mySeat = room?.seat ?? 0;
  if (!state) {
    renderHome(previousName ?? savedName);
    restoreDetails(); bindForms(); return;
  }
  const s = state;
  const last = s.history.at(-1);
  const prompt = s.promptId ? promptById(s.promptId) : null;
  const frozen = !s.connected && s.phase !== 'lobby' && s.phase !== 'finished';
  const details = ([0,1] as const).map(i => !s.connected && i===1 ? 'Waiting for connection' : s.ready[i] ? 'Ready' : s.committed[i] && ['question','reveal'].includes(s.phase) ? 'Answer locked' : i===mySeat ? 'You' : 'Opponent');
  let content = '';
  if (s.phase === 'lobby') {
    content = `<div class="lobby-content"><span class="eyebrow">PRIVATE DUEL</span><h1>${s.connected ? 'Two minds.<br><em>One winner.</em>' : 'Invite your<br><em>rival.</em>'}</h1><p>${s.connected ? 'Both players press Ready to start the first question.' : 'Send this link to a friend. Keep this tab open while you play.'}</p><label class="sr-only" for="invite">Invite link</label><p class="room-rules">${s.settings.startingHp.toLocaleString()} HP · ${s.settings.questionSeconds} seconds · ${s.settings.damageScaling ? 'Increasing damage' : 'Steady 1× damage'}</p><div class="invite-row"><input id="invite" readonly value="${esc(room!.invite)}"><button class="secondary" data-action="copy">Copy invite</button></div><button class="primary" data-action="ready" ${!s.connected || s.ready[mySeat] ? 'disabled' : ''}>${s.ready[mySeat] ? 'Waiting for your friend…' : s.connected ? 'I’m ready →' : 'Waiting for friend…'}</button></div>`;
  } else if (s.phase === 'countdown') {
    content = `<div class="countdown-content"><span class="eyebrow">ROUND ${s.round} · ${roundFactor(s)}× DAMAGE</span><h1>Get ready.</h1><div id="countdown" class="big-count" aria-live="off">3</div><p>A new question. A chance to turn the tide.</p></div>`;
  } else if (s.phase === 'question' || s.phase === 'reveal') {
    const locked = s.committed[mySeat] || s.phase === 'reveal' || submitting;
    const timer = duelTimer(s, Date.now(), offset);
    content = `<div class="question-top"><span class="eyebrow">${esc(prompt?.category || 'TRIVIA')}</span>${clockMarkup(timer)}</div><h1 class="question">${esc(prompt?.prompt)}</h1>${questionNotes(prompt)}${hintMarkup(s.promptId!, s.hintLevels[mySeat], { cost:hintCost(s.settings.startingHp,s.hintUses[mySeat]), hp:s.hp[mySeat], disabled:locked || frozen || timer.seconds === 0, pending:!!hintPending, message:hintMessage })}${timerMarkup(timer)}<form id="answer-form"><label for="answer">${locked ? 'YOUR ANSWER IS LOCKED' : 'YOUR ANSWER'}</label><div class="answer-row"><input id="answer" maxlength="160" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Think of something less obvious…" ${locked || frozen ? 'disabled' : ''}><button class="primary" type="submit" ${locked || frozen ? 'disabled' : ''}>${locked ? 'Locked ✓' : 'Lock in →'}</button></div><div class="answer-foot"><span id="answer-hint" ${answerHint ? 'role="alert"' : ''}>${esc(answerHint || (s.phase === 'reveal' ? 'Revealing both answers…' : locked ? 'Waiting for the other answer…' : 'Press Enter to lock in. Rarer answers score higher.'))}</span>${!locked ? `<button class="quiet" type="button" data-action="skip" ${frozen ? 'disabled' : ''}>Skip</button>` : ''}</div>${suggestionButtons(locked || frozen)}</form>`;
  } else {
    const finished = s.phase === 'finished';
    const headline = finished ? s.winner === null ? 'An even match.' : s.winner === mySeat ? 'You win.' : 'You’re sunk.' : last?.loser === null ? 'No damage.' : last?.loser === mySeat ? 'That one hurt.' : 'Direct hit.';
    content = `<div class="result-head"><span class="eyebrow">${finished ? 'DUEL COMPLETE' : `ROUND ${s.round} RESULTS`}</span><h1>${headline}</h1><p>${esc(finished ? s.reason : last?.damage ? `${s.names[last.loser!]} takes ${last.damage} damage${last.multiplier>1 ? ` at ${last.multiplier}×` : ''}.` : 'Equal scores. Both HP bars stay put.')}</p></div>${last ? `<p class="result-prompt">${esc(promptById(last.promptId)?.prompt)}</p><div class="result-grid">${last.results.map((result,i)=>`<div class="answer-result player-${i}"><div class="result-name">${esc(s.names[i])}</div><strong>${result.points}<small> pts</small></strong><h2>${esc(result.answer || (result.input ? `“${result.input}”` : 'No answer'))}</h2><span class="rarity score-${result.points}">${esc(scoreLabel(result.points, promptById(last.promptId)))}</span></div>`).join('')}</div>` : ''}<button class="primary" data-action="ready" ${!s.connected || s.ready[mySeat] ? 'disabled' : ''}>${s.ready[mySeat] ? 'Waiting for your friend…' : finished ? 'Play again →' : 'Ready for next question →'}</button>${last ? answerSheet(last.promptId) : ''}`;
  }
  screen.innerHTML = `<section class="match"><div class="match-heading"><span class="eyebrow">${s.phase==='lobby' ? 'LIVE 1V1' : `ROUND ${s.round} · ${roundFactor(s)}× DAMAGE`}</span><button class="quiet" data-action="leave">Leave duel</button></div><div class="health-board">${playerCard(s.names[0],s.hp[0],0,details[0])}<span class="versus">VS</span>${playerCard(s.names[1],s.hp[1],1,details[1])}</div>${frozen ? `<div class="connection-warning" role="status">Connection interrupted. Round paused while both players reconnect.</div>` : ''}<section class="arena ${s.phase}">${content}</section><div class="match-foot"><span class="status">${esc(status)}</span><button class="quiet" data-action="copy">Copy invite link</button></div>${error ? `<section class="connection-warning" role="alert">${esc(error)} <button class="secondary" data-action="retry">Reconnect</button><button class="quiet" data-action="home">New room</button></section>` : ''}${connectionHelp()}${s.history.length > 1 ? `<details class="history"><summary>Match history · ${s.history.length} rounds</summary>${s.history.slice().reverse().map(r=>`<div class="history-row"><b>${r.round}</b><span>${esc(promptById(r.promptId)?.prompt)}</span><strong>${r.results[0].points} : ${r.results[1].points}</strong><small>${r.damage ? `${r.damage} damage` : 'Tie'}</small></div>`).join('')}</details>` : ''}</section>`;
  bindForms();
  restoreDetails();
  const input = screen.querySelector<HTMLInputElement>('#answer');
  if (input && previousAnswer !== undefined) { input.value = previousAnswer; if (answerFocused && !input.disabled) { input.focus({preventScroll:true}); input.setSelectionRange(selection ?? input.value.length,selection ?? input.value.length); } }
  if (input && !input.disabled && previousAnswer === undefined) input.focus({preventScroll:true});
  paintClock();
  if (s.phase === 'question' && prompt) announce(`Round ${s.round}. ${prompt.prompt}. ${s.settings.questionSeconds} seconds.`);
  else if (s.phase === 'result' && last) announce(`Round complete. ${s.names[0]} ${last.results[0].points} points. ${s.names[1]} ${last.results[1].points} points. ${last.damage} damage.`);
  else if (s.phase === 'finished') announce(s.winner === null ? 'The duel is a draw.' : `${s.names[s.winner]} wins the duel.`);
}

function bindForms(): void {
  screen.querySelector('#start-form')?.addEventListener('submit', event => { event.preventDefault(); void startPlay(); });
  screen.querySelector('#answer-form')?.addEventListener('submit', event => { event.preventDefault(); void submit(false); });
}

async function connect(): Promise<void> {
  if (joining) return;
  const name = screen.querySelector<HTMLInputElement>('#name')?.value.trim().slice(0,24) || savedName;
  savedName = name;
  try { localStorage.setItem('krill-duels:name', name); } catch { /* Optional preferences. */ }
  readSettings();
  room?.dispose(false);
  practice = null; room = null; state = null; error = ''; joining = true; status = 'Connecting to the room service…'; lastKey = ''; render();
  const next = new DuelRoom(name, roomFromHash(), {
    change: value => {
      if (room !== next) return;
      if (HTTPS_ROOMS && next.seat === 0 && !state) history.replaceState(null, '', next.invite);
      const changedRound = value.matchId !== state?.matchId || value.round !== state?.round;
      if (state && value.hintLevels[next.seat] > state.hintLevels[next.seat]) hintMessage = '';
      if (changedRound) { answerHint = ''; answerSuggestions = []; submitting = false; hintPending = null; hintMessage = ''; }
      offset = next.hostClockOffset ?? Date.now() - value.now;
      state = value; joining = false; error = ''; render();
    },
    status: value => { if (room !== next) return; status = value; render(); },
    error: value => { if (room !== next) return; error = value; joining = false; render(); },
  }, settings);
  room = next;
  try { await next.open(); } catch {
    next.dispose(false);
    if (room !== next) return;
    error = 'Could not open the room. Check your connection and try again.'; joining = false; render();
  }
}

async function submit(skip: boolean): Promise<void> {
  if (practice) { submitPractice(skip); return; }
  if (!room || !state || state.phase !== 'question' || submitting) return;
  const input = screen.querySelector<HTMLInputElement>('#answer')?.value ?? '';
  if (!skip) {
    const prompt = promptById(state.promptId!);
    const index = prompt ? new AnswerIndex(prompt) : null;
    if (!input.trim() || !index?.match(input)) {
      answerSuggestions = index?.suggest(input) ?? [];
      answerHint = input.trim() ? answerSuggestions.length ? 'That spelling was not found in the accepted list.' : 'Not found in the accepted list. Try another answer or skip.' : 'Type an answer first, or choose Skip.';
      render(); screen.querySelector<HTMLInputElement>('#answer')?.focus(); return;
    }
  }
  answerHint = ''; answerSuggestions = []; submitting = true; render();
  try {
    const accepted = await room.submit(skip ? '' : input);
    if (!accepted) { submitting = false; answerHint = 'The answer could not lock before the round closed.'; render(); }
  } catch { submitting = false; answerHint = 'Could not lock that answer. Try again.'; render(); }
}

async function requestHint(): Promise<void> {
  if (practice) {
    if (practice.tick()) { render(); return; }
    practice.hint(); render(); return;
  }
  if (!room || !state || hintPending || submitting || state.phase !== 'question' ||
      !state.connected || state.committed[room.seat] || duelRemaining(state, Date.now(), offset) === 0) return;
  const seat = room.seat;
  if (state.hintLevels[seat] >= getPromptHints(state.promptId!).length ||
      hintCost(state.settings.startingHp, state.hintUses[seat]) >= state.hp[seat]) return;
  const currentRoom = room;
  const request = {};
  const matchId = state.matchId, round = state.round;
  hintPending = request; hintMessage = ''; render();
  let message = '';
  try {
    if (!await currentRoom.hint()) message = 'Could not confirm the hint. Reconnect to refresh your HP and hints.';
  } catch { message = 'Could not confirm the hint. Reconnect to refresh your HP and hints.'; }
  if (hintPending !== request || room !== currentRoom || state?.matchId !== matchId || state?.round !== round) return;
  hintPending = null; hintMessage = message; render();
}

function paintClock(): void {
  if (practice) {
    if (practice.tick()) { answerHint = ''; answerSuggestions = []; render(); }
    const p = practice.snapshot();
    updateClock(questionTimer(p.phase, p.deadline, p.questionSeconds, Date.now()));
    return;
  }
  if (!state) return;
  const now = Date.now();
  const remaining = duelRemaining(state, now, offset);
  updateClock(duelTimer(state, now, offset));
  const countdown = screen.querySelector('#countdown');
  if (countdown) countdown.textContent = String(Math.max(1,Math.ceil(remaining/1000)));
  if (state.phase === 'question' && remaining === 0) {
    const input = screen.querySelector<HTMLInputElement>('#answer'); if (input) input.disabled = true;
    const hintButton = screen.querySelector<HTMLButtonElement>('[data-action=hint]'); if (hintButton) hintButton.disabled = true;
  }
}

function home(): void {
  room?.dispose(); room = null; practice = null; state = null; error = ''; status = ''; joining = false; answerHint = ''; answerSuggestions = []; submitting = false;
  hintPending = null; hintMessage = '';
  history.replaceState(null,'',location.pathname); lastKey = ''; render();
}

app.addEventListener('click', async event => {
  const action = (event.target as Element).closest<HTMLElement>('[data-action]')?.dataset.action;
  if (action === 'help') (document.querySelector('#help') as HTMLDialogElement).showModal();
  if (action === 'close-help') (document.querySelector('#help') as HTMLDialogElement).close();
  if (action === 'ready') { answerHint = ''; answerSuggestions = []; submitting = false; room?.ready(); }
  if (action === 'skip') void submit(true);
  if (action === 'hint') void requestHint();
  if (action === 'use-suggestion') {
    const chosen = (event.target as Element).closest<HTMLElement>('[data-answer]')?.dataset.answer;
    const input = screen.querySelector<HTMLInputElement>('#answer');
    if (!chosen || !answerSuggestions.includes(chosen) || !input || input.disabled || submitting) return;
    input.value = chosen; answerSuggestions = []; answerHint = 'Spelling updated. Press Lock in to confirm.';
    render(); screen.querySelector<HTMLInputElement>('#answer')?.focus();
  }
  if (action === 'mode') {
    readSettings(); savedName = screen.querySelector<HTMLInputElement>('#name')?.value || savedName;
    mode = (event.target as Element).closest<HTMLElement>('[data-mode]')?.dataset.mode === 'solo' ? 'solo' : 'duel';
    render(true);
  }
  if (action === 'practice-next' && practice) {
    nextPracticeRound();
  }
  if (action === 'home') home();
  if (action === 'cancel') {
    room?.dispose(false); room = null; state = null; joining = false; error = '';
    status = 'Connection cancelled. You can try again.'; lastKey = ''; render();
  }
  if (action === 'leave' && confirm('Leave this duel? Your friend will win if the match is in progress.')) home();
  if (action === 'retry') {
    if (room && (HTTPS_ROOMS || room.seat === 1)) history.replaceState(null,'',room.invite);
    else if (state) { error = 'Create a new room and send a fresh invite, or try the HTTPS version in Connection help.'; render(); return; }
    await connect();
  }
  if (action === 'copy' && room) {
    try { await navigator.clipboard.writeText(room.invite); status = 'Invite copied. Send it to your friend.'; render(); }
    catch { const input = screen.querySelector<HTMLInputElement>('#invite'); if (input) { input.focus(); input.select(); } else { status = room.invite; render(); } }
  }
  if (action === 'copy-diagnostics') {
    const report = screen.querySelector<HTMLTextAreaElement>('#connection-report');
    if (report) report.value = connectionReport();
    const feedback = screen.querySelector('#diagnostic-status');
    try { await navigator.clipboard.writeText(connectionReport()); if (feedback) feedback.textContent = 'Copied. Share these details when reporting a problem.'; }
    catch { report?.focus(); report?.select(); if (feedback) feedback.textContent = 'Select and copy the details above.'; }
  }
});
window.addEventListener('hashchange', () => { if (!room) render(true); });
screen.addEventListener('input', event => {
  if ((event.target as HTMLElement).id === 'answer' && (answerHint || answerSuggestions.length)) {
    answerHint = ''; answerSuggestions = []; render();
  }
});
screen.addEventListener('change', event => {
  const target = event.target as HTMLInputElement | HTMLSelectElement;
  if (!['starting-hp','question-time','damage-mode'].includes(target.id)) return;
  readSettings();
  if (target.id === 'damage-mode' && target.nextElementSibling) target.nextElementSibling.textContent = settings.damageScaling ? '2× at round 5, 3× at round 8' : 'Score difference only';
});
window.addEventListener('beforeunload', event => { if (room && state && state.phase !== 'finished') { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', () => room?.dispose(!HTTPS_ROOMS));
window.addEventListener('pageshow', event => { if (event.persisted && room && HTTPS_ROOMS) void connect(); });
window.setInterval(paintClock,100);
render();

// Optional agent access uses the same controls and state as the visible game.
import { installGameTools, type ModelContext } from './agent-tools';
const visibleStatus = () => practice ? ({mode:'solo',...practice.snapshot(),hints:getPromptHints(practice.snapshot().promptId).slice(0,practice.snapshot().hintLevel),error:answerHint || null}) : ({ mode:'duel', settings:state?.settings ?? settings, status, error: error || answerHint || null, phase: state?.phase ?? (joining ? 'connecting' : 'home'), round: state?.round ?? 0, hp: state?.hp, players: state?.names, hints:state?.promptId ? getPromptHints(state.promptId).slice(0,state.hintLevels[room?.seat ?? 0]) : [], hintCost:state ? hintCost(state.settings.startingHp,state.hintUses[room?.seat ?? 0]) : null, invite: room?.invite, ready: state?.ready, question: state?.phase === 'question' ? promptById(state.promptId!)?.prompt : null, answerLocked: state ? state.committed[room?.seat ?? 0] : false });
const removeGameTools = installGameTools((document as Document & { modelContext?: ModelContext }).modelContext, {
  status: visibleStatus,
  configure: value => {
    if (room || practice || joining || roomFromHash()) throw new Error('Settings can only be changed before creating your own game.');
    settings = {...value}; render(true); readSettings(); return visibleStatus();
  },
  start: async (choice,name) => {
    if (room || practice || joining) throw new Error('A game is already active or connecting.');
    readSettings(); mode = choice; savedName = name;
    if (mode === 'solo' && roomFromHash()) history.replaceState(null,'',location.pathname);
    render(true);
    const input = screen.querySelector<HTMLInputElement>('#name'); if (input) input.value = name;
    await startPlay(); return visibleStatus();
  },
  next: () => {
    if (practice) {
      if (practice.snapshot().phase === 'question') throw new Error('Answer or skip this question first.');
      nextPracticeRound(); return visibleStatus();
    }
    if (!room || !state?.connected || !['lobby','result','finished'].includes(state.phase)) throw new Error('Ready is not available right now.');
    answerHint = ''; answerSuggestions = []; submitting = false; room.ready(); return visibleStatus();
  },
  answer: async answer => {
    const input = screen.querySelector<HTMLInputElement>('#answer');
    if (!input || input.disabled || submitting || (!practice && state?.phase !== 'question')) throw new Error('There is no open answer form.');
    input.value = answer; await submit(!answer); return visibleStatus();
  },
});
window.addEventListener('pagehide', removeGameTools, { once: true });

function renderHome(name: string): void {
  const invited = !!roomFromHash();
  const soloMode = !invited && mode === 'solo';
  const selectTime = `<label for="question-time">Time per question</label><select id="question-time">${TIME_OPTIONS.map(seconds=>`<option value="${seconds}" ${seconds===settings.questionSeconds?'selected':''}>${seconds} seconds</option>`).join('')}</select>`;
  screen.innerHTML = `<section class="start setup"><div class="start-heading"><span class="eyebrow">${invited?'YOUR FRIEND SENT AN INVITE':'RARE ANSWERS. REAL POINTS.'}</span><h1>${invited?'Your duel awaits.':'Play your way.'}</h1><p>${invited?'Join the room, check the rules, and press Ready.':'Practice on your own or challenge a friend to an HP battle.'}</p></div><section class="start-controls">${invited?'':`<div class="mode-picker" aria-label="Game mode"><button class="mode-choice ${soloMode?'selected':''}" data-action="mode" data-mode="solo" ${joining?'disabled':''} aria-pressed="${soloMode}"><span aria-hidden="true">🦐</span><strong>Solo practice</strong><small>Find rare answers at your own pace</small></button><button class="mode-choice ${!soloMode?'selected':''}" data-action="mode" data-mode="duel" ${joining?'disabled':''} aria-pressed="${!soloMode}"><span aria-hidden="true">⚔️</span><strong>Create duel</strong><small>Invite a friend and battle for HP</small></button></div>`}<form id="start-form">${soloMode?'':`<label for="name">Your name</label><input id="name" ${joining?'disabled':''} maxlength="24" autocomplete="nickname" value="${esc(name)}" placeholder="Player">`}${invited?'':`<fieldset class="settings" ${joining?'disabled':''}><legend>${soloMode?'Practice settings':'Duel settings'}</legend><div class="settings-grid ${soloMode?'solo-settings':''}">${soloMode?'':`<div><label for="starting-hp">Starting HP</label><input id="starting-hp" type="number" min="100" max="10000" step="1" value="${settings.startingHp}" required><small>100–10,000 · higher means longer</small></div>`}<div>${selectTime}</div>${soloMode?'':`<div><label for="damage-mode">Damage</label><select id="damage-mode"><option value="scaling" ${settings.damageScaling?'selected':''}>Increasing 1× → 3×</option><option value="steady" ${!settings.damageScaling?'selected':''}>Steady 1×</option></select><small>${settings.damageScaling?'2× at round 5, 3× at round 8':'Score difference only'}</small></div>`}</div></fieldset>`}<button class="primary start-button" type="submit" ${joining?'disabled':''}>${joining?'Connecting…':invited?'Join duel →':soloMode?'Start solo practice →':'Create duel →'}</button></form>${joining?'<button class="quiet" data-action="cancel">Cancel connection</button>':''}<div class="game-facts"><span>${PROMPTS.length.toLocaleString()} questions</span><span>${ANSWER_COUNT.toLocaleString()} scored answers</span></div><p class="status" role="status">${esc(status || (invited?'The host’s settings apply to both players.':soloMode?'No room or connection needed once the game loads.':'Create a private room and share its invite link.'))}</p>${error?`<p class="error" role="alert">${esc(error)}</p><button class="quiet" data-action="retry">Try again</button>`:''}${soloMode?'':connectionHelp()}${invited?'<button class="quiet" data-action="home">Play solo or create your own duel</button>':''}</section></section>`;
}

function readSettings(): void {
  const hp = screen.querySelector<HTMLInputElement>('#starting-hp');
  const seconds = screen.querySelector<HTMLSelectElement>('#question-time');
  const damage = screen.querySelector<HTMLSelectElement>('#damage-mode');
  const next = { startingHp:hp ? Number(hp.value) : settings.startingHp, questionSeconds:seconds ? Number(seconds.value) : settings.questionSeconds, damageScaling:damage ? damage.value==='scaling' : settings.damageScaling };
  if (validSettings(next)) settings = next;
  try { localStorage.setItem('krill-duels:settings',JSON.stringify(settings)); } catch { /* Optional preferences. */ }
}

async function startPlay(): Promise<void> {
  if (roomFromHash() || mode === 'duel') { await connect(); return; }
  startPractice();
}
function startPractice(): void {
  readSettings(); room?.dispose(); room = null; state = null; joining = false; submitting = false; error = ''; status = ''; answerHint = ''; answerSuggestions = [];
  hintPending = null; hintMessage = '';
  practice = new PracticeSession(settings.questionSeconds); lastKey = ''; render(true);
}

function questionNotes(prompt?: Prompt | null): string {
  if (!prompt) return '';
  return `<div class="question-notes"><span class="scoring-basis">${esc(scoringLabel(prompt))}</span>${prompt.rules ? `<p>${esc(prompt.rules)}</p>` : ''}</div>`;
}

function answerSheet(promptId: string): string {
  const prompt = promptById(promptId)!;
  return `<details class="answer-sheet"><summary>See accepted answers for this question</summary><p class="fine"><strong>${esc(scoringLabel(prompt))}</strong> · <a href="${esc(prompt.source)}" target="_blank" rel="noopener">Question source ↗</a></p><p class="fine">${esc(scoringExplanation(prompt))}</p>${prompt.scoring === 'estimated' ? '<p class="fine">Scores stay fixed for this question-bank version. Readership excludes views recorded under redirect names.</p>' : ''}<div class="answer-list">${[...prompt.answers].sort((a,b)=>b.score-a.score).map(answer=>`<div><span>${esc(answer.answer)}</span><b>${answer.score}</b></div>`).join('')}</div></details>`;
}

function renderPractice(force = false): void {
  if (!practice) return;
  const p = practice.snapshot();
  const key = `solo|${p.phase}|${p.round}|${p.total}|${p.hintLevel}|${answerHint}|${JSON.stringify(answerSuggestions)}`;
  if (!force && key === lastKey) return;
  lastKey = key;
  const oldInput = screen.querySelector<HTMLInputElement>('#answer');
  const value = oldInput?.value ?? '';
  const focused = document.activeElement === oldInput;
  const selection = oldInput?.selectionStart;
  const prompt = promptById(p.promptId)!;
  const last = p.history.at(-1);
  const timer = questionTimer(p.phase, p.deadline, p.questionSeconds, Date.now());
  const content = p.phase === 'question'
    ? `<div class="question-top"><span class="eyebrow">${esc(prompt.category)}</span>${clockMarkup(timer)}</div><h1 class="question">${esc(prompt.prompt)}</h1>${questionNotes(prompt)}${hintMarkup(p.promptId,p.hintLevel,{cost:null,disabled:timer.seconds === 0})}${timerMarkup(timer)}<form id="answer-form"><label for="answer">YOUR ANSWER</label><div class="answer-row"><input id="answer" maxlength="160" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Think of something less obvious…"><button class="primary" type="submit">Lock in →</button></div><div class="answer-foot"><span ${answerHint?'role="alert"':''}>${esc(answerHint || 'Rarer answers score higher. Press Enter to lock in.')}</span><button class="quiet" type="button" data-action="skip">Skip</button></div>${suggestionButtons()}</form>`
    : `<div class="result-head"><span class="eyebrow">${p.phase==='finished'?'PRACTICE COMPLETE':`QUESTION ${p.round} RESULTS`}</span><h1>${p.phase==='finished'?'Bank completed.':last!.points>=85?'Rare find.':last!.points?'Points on the board.':'Keep exploring.'}</h1><p>${p.phase==='finished'?`${p.total.toLocaleString()} points across ${p.questionCount} questions.`:'Review your answer, then try the next random question.'}</p></div><p class="result-prompt">${esc(prompt.prompt)}</p><div class="answer-result solo-result player-0"><strong>${last!.points}<small> pts</small></strong><h2>${esc(last!.answer || (last!.input?`“${last!.input}”`:'No answer'))}</h2><span class="rarity score-${last!.points}">${esc(scoreLabel(last!.points, prompt))}</span></div><button class="primary" data-action="practice-next">${p.phase==='finished'?'New practice run →':'Next random question →'}</button>${answerSheet(p.promptId)}`;
  screen.innerHTML = `<section class="match practice"><div class="match-heading"><span class="eyebrow">SOLO PRACTICE</span><button class="quiet" data-action="home">Back to setup</button></div><div class="practice-stats"><div><span>Question</span><strong>${p.round}<small> / ${p.questionCount}</small></strong></div><div><span>Total points</span><strong>${p.total.toLocaleString()}</strong></div><div><span>Answer time</span><strong>${p.questionSeconds}<small> sec</small></strong></div></div><section class="arena ${p.phase}">${content}</section><p class="fine">Each question appears once per run. Both modes use the same scores.</p></section>`;
  bindForms();
  const input = screen.querySelector<HTMLInputElement>('#answer');
  if (input) { input.value = value; if (focused || !oldInput) input.focus({preventScroll:true}); if (selection !== null && selection !== undefined) input.setSelectionRange(selection,selection); }
  updateClock(questionTimer(p.phase, p.deadline, p.questionSeconds, Date.now()));
  announce(p.phase==='question'?`Question ${p.round}. ${prompt.prompt}. ${p.questionSeconds} seconds.`:`${last!.points} points. Total ${p.total} points.`);
}

function submitPractice(skip: boolean): void {
  if (!practice || practice.snapshot().phase !== 'question') return;
  if (practice.tick()) { answerHint = ''; answerSuggestions = []; render(); return; }
  const input = screen.querySelector<HTMLInputElement>('#answer')?.value ?? '';
  const prompt = promptById(practice.snapshot().promptId)!;
  const index = new AnswerIndex(prompt);
  if (!skip && (!input.trim() || !index.match(input))) {
    answerSuggestions = index.suggest(input);
    answerHint = input.trim() ? answerSuggestions.length ? 'That spelling was not found in the accepted list.' : 'Not found in the accepted list. Try another answer or skip.' : 'Type an answer first, or choose Skip.';
    render(); screen.querySelector<HTMLInputElement>('#answer')?.focus(); return;
  }
  answerHint = ''; answerSuggestions = []; practice.submit(skip?'':input); render();
}
function updateClock(timer: TimerDisplay): void {
  const seconds = screen.querySelector('#seconds');
  const fill = screen.querySelector<HTMLElement>('#timer-fill');
  if (seconds) seconds.textContent = String(timer.seconds);
  if (fill) fill.style.width = `${timer.percent}%`;
}

function nextPracticeRound(): void {
  if (!practice) return;
  answerHint = ''; answerSuggestions = [];
  if (practice.snapshot().phase === 'finished') practice = new PracticeSession(practice.snapshot().questionSeconds);
  else practice.next();
  render(true);
}
