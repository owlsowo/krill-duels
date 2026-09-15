import './style.css';
import { PROMPTS, promptById } from './data';
import { HP, QUESTION_MS, multiplier, type DuelState } from './duel-engine';
import { AnswerIndex } from './match';
import { DuelRoom, roomFromHash } from './network';

const app = document.querySelector<HTMLElement>('#app')!;
const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]!);
const scoreLabels: Record<number, string> = { 0: 'Miss', 10: 'Plankton', 15: 'Too clever', 30: 'Schooler', 60: 'Rare', 85: 'Deep cut', 100: 'One in a Krillion' };
let room: DuelRoom | null = null;
let state: DuelState | null = null;
let status = '';
let error = '';
let answerHint = '';
let joining = false;
let submitting = false;
let offset = 0;
let lastKey = '';
let announced = '';
let savedName = 'Player';
try { savedName = localStorage.getItem('krill-duels:name') || 'Player'; } catch { /* Preferences are optional. */ }

app.innerHTML = `<div class="ocean" aria-hidden="true"></div><div class="shell"><header class="masthead"><a class="wordmark" href="${location.pathname}">KRILL<span>DUELS</span></a><span class="edition">RARE-ANSWER BATTLES</span><button class="quiet" data-action="help">How to play</button></header><div id="screen"></div><footer><span>Independent fan game · historical scores</span><a href="https://krillionanswers.com/data-sources/" target="_blank" rel="noopener">Question source ↗</a><a href="https://github.com/owlsowo/krill-duels" target="_blank" rel="noopener">Source code ↗</a></footer></div><div id="announcement" class="sr-only" role="status" aria-live="polite"></div><dialog id="help"><button class="close" data-action="close-help" aria-label="Close instructions">×</button><div class="eyebrow">HOW TO PLAY</div><h2>Make your answer count.</h2><ol><li>Create a duel and send the invite link to a friend.</li><li>Both press Ready. You get the same random question and 25 seconds to answer.</li><li>Rare answers earn more points. The score difference damages the lower scorer’s HP.</li><li>Damage doubles at round 5 and triples at round 8. Reach 0 HP and you’re out.</li></ol><p>Questions don’t repeat within a match. Both players need to keep their tabs open. No Krillion purchase or extension is needed.</p><p class="fine">Scores come from historical third-party answer records. They may differ from today’s official game. Case, accents and punctuation are ignored; unlisted answers can be retried before time expires. This is casual play between friends.</p><button class="primary" data-action="close-help">Got it</button></dialog>`;
const screen = document.querySelector<HTMLElement>('#screen')!;

function announce(message: string): void {
  if (message === announced) return;
  announced = message;
  document.querySelector('#announcement')!.textContent = message;
}

function playerCard(name: string, hp: number, side: number, detail: string): string {
  return `<section class="player player-${side}"><div class="player-id"><span class="avatar" aria-hidden="true">${side === 0 ? '🦐' : '🦑'}</span><div><span class="player-label">${side === 0 ? 'PLAYER 01' : 'PLAYER 02'}</span><h2>${esc(name)}</h2></div><strong class="hp">${hp}<small> HP</small></strong></div><div class="health-track" role="meter" aria-label="${esc(name)} health" aria-valuemin="0" aria-valuemax="${HP}" aria-valuenow="${hp}"><div class="health-fill" style="width:${hp / HP * 100}%"></div></div><div class="player-status">${esc(detail)}</div></section>`;
}

function render(force = false): void {
  const key = state ? JSON.stringify([state.matchId,state.phase,state.round,state.hp,state.ready,state.committed,state.connected,state.history.length,status,error,submitting,answerHint]) : `${joining}|${status}|${error}|${roomFromHash()}`;
  if (!force && key === lastKey) return;
  lastKey = key;
  const currentInput = screen.querySelector<HTMLInputElement>('#answer');
  const previousAnswer = currentInput?.value;
  const selection = currentInput?.selectionStart;
  const answerFocused = document.activeElement === currentInput;
  const previousName = screen.querySelector<HTMLInputElement>('#name')?.value;
  const mySeat = room?.seat ?? 0;
  if (!state) {
    const invited = !!roomFromHash();
    screen.innerHTML = `<section class="start"><div class="start-heading"><span class="eyebrow">${invited ? 'YOUR FRIEND IS WAITING' : 'ONE OCEAN. TWO RIVALS.'}</span><h1>${invited ? 'Ready to<br><em>dive in?</em>' : 'Think deeper.<br><em>Hit harder.</em>'}</h1><p>A rare-answer trivia duel. Send a link, share a question,<br class="desktop"> and chip away at your friend’s HP.</p></div><div class="versus-preview">${playerCard('You',HP,0,'Rare answers deal damage')}<span class="versus">VS</span>${playerCard('Your friend',HP,1,'Last player floating wins')}</div><section class="start-controls"><form id="start-form"><label for="name">Your name</label><div class="start-row"><input id="name" maxlength="24" autocomplete="nickname" value="${esc(previousName ?? savedName)}" placeholder="Player"><button class="primary" type="submit" ${joining ? 'disabled' : ''}>${joining ? 'Connecting…' : invited ? 'Join duel →' : 'Create a duel →'}</button></div></form><div class="game-facts"><span>300 starting HP</span><span>25 seconds</span><span>${PROMPTS.length.toLocaleString()} questions</span></div><p class="status" role="status">${esc(status || (invited ? 'Same questions. Same clock. May the rarer answer win.' : 'Free to play. No account or extension needed.'))}</p>${error ? `<p class="error" role="alert">${esc(error)}</p><button class="quiet" data-action="retry">Try again</button>` : ''}${invited ? '<button class="quiet" data-action="home">Create your own room instead</button>' : ''}</section></section>`;
    bindForms(); return;
  }
  const s = state;
  const last = s.history.at(-1);
  const prompt = s.promptId ? promptById(s.promptId) : null;
  const frozen = !s.connected && s.phase !== 'lobby' && s.phase !== 'finished';
  const details = ([0,1] as const).map(i => !s.connected && i===1 ? 'Waiting for connection' : s.ready[i] ? 'Ready' : s.committed[i] && ['question','reveal'].includes(s.phase) ? 'Answer locked' : i===mySeat ? 'You' : 'Opponent');
  let content = '';
  if (s.phase === 'lobby') {
    content = `<div class="lobby-content"><span class="eyebrow">PRIVATE DUEL</span><h1>${s.connected ? 'Two minds.<br><em>One winner.</em>' : 'Invite your<br><em>rival.</em>'}</h1><p>${s.connected ? 'Both players press Ready to start the first question.' : 'Send this link to a friend. Keep this tab open while you play.'}</p><label class="sr-only" for="invite">Invite link</label><div class="invite-row"><input id="invite" readonly value="${esc(room!.invite)}"><button class="secondary" data-action="copy">Copy invite</button></div><button class="primary" data-action="ready" ${!s.connected || s.ready[mySeat] ? 'disabled' : ''}>${s.ready[mySeat] ? 'Waiting for your friend…' : s.connected ? 'I’m ready →' : 'Waiting for friend…'}</button></div>`;
  } else if (s.phase === 'countdown') {
    content = `<div class="countdown-content"><span class="eyebrow">ROUND ${s.round} · ${multiplier(s.round)}× DAMAGE</span><h1>Get ready.</h1><div id="countdown" class="big-count" aria-live="off">3</div><p>A new question. A chance to turn the tide.</p></div>`;
  } else if (s.phase === 'question' || s.phase === 'reveal') {
    const locked = s.committed[mySeat] || s.phase === 'reveal' || submitting;
    content = `<div class="question-top"><span class="eyebrow">${esc(prompt?.category || 'TRIVIA')}</span><div class="clock"><span id="seconds">25</span><small>SEC</small></div></div><h1 class="question">${esc(prompt?.prompt)}</h1><div class="timer-track" aria-hidden="true"><div id="timer-fill"></div></div><form id="answer-form"><label for="answer">${locked ? 'YOUR ANSWER IS LOCKED' : 'YOUR ANSWER'}</label><div class="answer-row"><input id="answer" maxlength="160" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Think of something less obvious…" ${locked || frozen ? 'disabled' : ''}><button class="primary" type="submit" ${locked || frozen ? 'disabled' : ''}>${locked ? 'Locked ✓' : 'Lock in →'}</button></div><div class="answer-foot"><span id="answer-hint" ${answerHint ? 'role="alert"' : ''}>${esc(answerHint || (s.phase === 'reveal' ? 'Revealing both answers…' : locked ? 'Waiting for the other answer…' : 'Press Enter to lock in. Rarer answers score higher.'))}</span>${!locked ? '<button class="quiet" type="button" data-action="skip">Skip</button>' : ''}</div></form>`;
  } else {
    const finished = s.phase === 'finished';
    const headline = finished ? s.winner === null ? 'An even match.' : s.winner === mySeat ? 'You win.' : 'You’re sunk.' : last?.loser === null ? 'No damage.' : last?.loser === mySeat ? 'That one hurt.' : 'Direct hit.';
    content = `<div class="result-head"><span class="eyebrow">${finished ? 'DUEL COMPLETE' : `ROUND ${s.round} RESULTS`}</span><h1>${headline}</h1><p>${esc(finished ? s.reason : last?.damage ? `${s.names[last.loser!]} takes ${last.damage} damage${last.multiplier>1 ? ` at ${last.multiplier}×` : ''}.` : 'Equal scores. Both HP bars stay put.')}</p></div>${last ? `<p class="result-prompt">${esc(promptById(last.promptId)?.prompt)}</p><div class="result-grid">${last.results.map((result,i)=>`<div class="answer-result player-${i}"><div class="result-name">${esc(s.names[i])}</div><strong>${result.points}<small> pts</small></strong><h2>${esc(result.answer || (result.input ? `“${result.input}”` : 'No answer'))}</h2><span class="rarity score-${result.points}">${esc(scoreLabels[result.points])}</span></div>`).join('')}</div>` : ''}<button class="primary" data-action="ready" ${!s.connected || s.ready[mySeat] ? 'disabled' : ''}>${s.ready[mySeat] ? 'Waiting for your friend…' : finished ? 'Rematch · new shuffle →' : 'Ready for next question →'}</button>${last ? `<details class="answer-sheet"><summary>See accepted answers for this question</summary><p class="fine">Historical archive · <a href="${esc(promptById(last.promptId)?.source)}" target="_blank" rel="noopener">View source ↗</a></p><div class="answer-list">${[...(promptById(last.promptId)?.answers ?? [])].sort((a,b)=>b.score-a.score).map(a=>`<div><span>${esc(a.answer)}</span><b>${a.score}</b></div>`).join('')}</div></details>` : ''}`;
  }
  screen.innerHTML = `<section class="match"><div class="match-heading"><span class="eyebrow">${s.phase==='lobby' ? 'LIVE 1V1' : `ROUND ${s.round} · ${multiplier(s.round)}× DAMAGE`}</span><button class="quiet" data-action="leave">Leave duel</button></div><div class="health-board">${playerCard(s.names[0],s.hp[0],0,details[0])}<span class="versus">VS</span>${playerCard(s.names[1],s.hp[1],1,details[1])}</div>${frozen ? `<div class="connection-warning" role="status">Connection interrupted. Round paused while your friend reconnects.</div>` : ''}<section class="arena ${s.phase}">${content}</section><div class="match-foot"><span class="status">${esc(status)}</span><button class="quiet" data-action="copy">Copy invite link</button></div>${error ? `<section class="connection-warning" role="alert">${esc(error)} <button class="secondary" data-action="retry">Reconnect</button><button class="quiet" data-action="home">New room</button></section>` : ''}${s.history.length > 1 ? `<details class="history"><summary>Match history · ${s.history.length} rounds</summary>${s.history.slice().reverse().map(r=>`<div class="history-row"><b>${r.round}</b><span>${esc(promptById(r.promptId)?.prompt)}</span><strong>${r.results[0].points} : ${r.results[1].points}</strong><small>${r.damage ? `${r.damage} damage` : 'Tie'}</small></div>`).join('')}</details>` : ''}</section>`;
  bindForms();
  const input = screen.querySelector<HTMLInputElement>('#answer');
  if (input && previousAnswer !== undefined) { input.value = previousAnswer; if (answerFocused && !input.disabled) { input.focus({preventScroll:true}); input.setSelectionRange(selection ?? input.value.length,selection ?? input.value.length); } }
  if (input && !input.disabled && previousAnswer === undefined) input.focus({preventScroll:true});
  paintClock();
  if (s.phase === 'question' && prompt) announce(`Round ${s.round}. ${prompt.prompt}. 25 seconds.`);
  else if (s.phase === 'result' && last) announce(`Round complete. ${s.names[0]} ${last.results[0].points} points. ${s.names[1]} ${last.results[1].points} points. ${last.damage} damage.`);
  else if (s.phase === 'finished') announce(s.winner === null ? 'The duel is a draw.' : `${s.names[s.winner]} wins the duel.`);
}

function bindForms(): void {
  screen.querySelector('#start-form')?.addEventListener('submit', event => { event.preventDefault(); void connect(); });
  screen.querySelector('#answer-form')?.addEventListener('submit', event => { event.preventDefault(); void submit(false); });
}

async function connect(): Promise<void> {
  if (joining) return;
  const name = screen.querySelector<HTMLInputElement>('#name')?.value.trim().slice(0,24) || savedName;
  savedName = name;
  try { localStorage.setItem('krill-duels:name', name); } catch { /* Optional preferences. */ }
  room?.dispose(false);
  room = null; state = null; error = ''; joining = true; status = 'Connecting to the room service…'; lastKey = ''; render();
  const next = new DuelRoom(name, roomFromHash(), {
    change: value => {
      if (room !== next) return;
      const changedRound = value.matchId !== state?.matchId || value.round !== state?.round;
      if (changedRound) { answerHint = ''; submitting = false; }
      offset = next.hostClockOffset ?? Date.now() - value.now;
      state = value; joining = false; error = ''; render();
    },
    status: value => { if (room !== next) return; status = value; render(); },
    error: value => { if (room !== next) return; error = value; joining = false; render(); },
  });
  room = next;
  try { await next.open(); } catch { error = 'Could not open the room. Check your connection and try again.'; joining = false; render(); }
}

async function submit(skip: boolean): Promise<void> {
  if (!room || !state || state.phase !== 'question' || submitting) return;
  const input = screen.querySelector<HTMLInputElement>('#answer')?.value ?? '';
  if (!skip) {
    const prompt = promptById(state.promptId!);
    if (!input.trim() || !prompt || !new AnswerIndex(prompt).match(input)) {
      answerHint = input.trim() ? 'Not found in this archive. Try another answer or skip.' : 'Type an answer first, or choose Skip.';
      render(); screen.querySelector<HTMLInputElement>('#answer')?.focus(); return;
    }
  }
  answerHint = ''; submitting = true; render();
  try {
    const accepted = await room.submit(skip ? '' : input);
    if (!accepted) { submitting = false; answerHint = 'The answer could not lock before the round closed.'; render(); }
  } catch { submitting = false; answerHint = 'Could not lock that answer. Try again.'; render(); }
}

function paintClock(): void {
  if (!state) return;
  const reference = !state.connected && state.reconnectUntil ? state.reconnectUntil - 30_000 : Date.now() - offset;
  const remaining = Math.max(0, state.deadline - reference);
  const seconds = screen.querySelector('#seconds');
  const fill = screen.querySelector<HTMLElement>('#timer-fill');
  if (seconds) seconds.textContent = state.phase === 'reveal' ? '0' : String(Math.ceil(remaining / 1000));
  if (fill) fill.style.width = `${state.phase === 'reveal' ? 0 : Math.min(100,remaining/QUESTION_MS*100)}%`;
  const countdown = screen.querySelector('#countdown');
  if (countdown) countdown.textContent = String(Math.max(1,Math.ceil(remaining/1000)));
  if (state.phase === 'question' && remaining === 0) {
    const input = screen.querySelector<HTMLInputElement>('#answer'); if (input) input.disabled = true;
  }
}

function home(): void {
  room?.dispose(); room = null; state = null; error = ''; status = ''; joining = false; answerHint = ''; submitting = false;
  history.replaceState(null,'',location.pathname); lastKey = ''; render();
}

app.addEventListener('click', async event => {
  const action = (event.target as Element).closest<HTMLElement>('[data-action]')?.dataset.action;
  if (action === 'help') (document.querySelector('#help') as HTMLDialogElement).showModal();
  if (action === 'close-help') (document.querySelector('#help') as HTMLDialogElement).close();
  if (action === 'ready') { answerHint = ''; submitting = false; room?.ready(); }
  if (action === 'skip') void submit(true);
  if (action === 'home') home();
  if (action === 'leave' && confirm('Leave this duel? Your friend will win if the match is in progress.')) home();
  if (action === 'retry') {
    if (room?.seat === 1) history.replaceState(null,'',room.invite);
    else if (state) { error = 'A host room cannot survive a closed connection. Create a new room and send a fresh invite.'; render(); return; }
    await connect();
  }
  if (action === 'copy' && room) {
    try { await navigator.clipboard.writeText(room.invite); status = 'Invite copied. Send it to your friend.'; render(); }
    catch { const input = screen.querySelector<HTMLInputElement>('#invite'); if (input) { input.focus(); input.select(); } else { status = room.invite; render(); } }
  }
});
window.addEventListener('hashchange', () => { if (!room) render(true); });
window.addEventListener('beforeunload', event => { if (room && state && state.phase !== 'finished') { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', () => room?.dispose());
window.setInterval(paintClock,100);
render();

// Optional agent access uses the same controls and state as the visible game.
import { installGameTools, type ModelContext } from './agent-tools';
const visibleStatus = () => ({ status, error: error || answerHint || null, phase: state?.phase ?? (joining ? 'connecting' : 'home'), round: state?.round ?? 0, hp: state?.hp, players: state?.names, invite: room?.invite, ready: state?.ready, question: state?.phase === 'question' ? promptById(state.promptId!)?.prompt : null, answerLocked: state ? state.committed[room?.seat ?? 0] : false });
const removeGameTools = installGameTools((document as Document & { modelContext?: ModelContext }).modelContext, {
  status: visibleStatus,
  ready: () => {
    if (!room || !state?.connected || !['lobby','result','finished'].includes(state.phase)) throw new Error('Ready is not available right now.');
    answerHint = ''; submitting = false; room.ready(); return visibleStatus();
  },
  start: async name => {
    const input = screen.querySelector<HTMLInputElement>('#name');
    if (!input || joining || room) throw new Error('A room is already active or connecting.');
    input.value = name; await connect(); return visibleStatus();
  },
  answer: async answer => {
    const input = screen.querySelector<HTMLInputElement>('#answer');
    if (!input || input.disabled || submitting || state?.phase !== 'question') throw new Error('There is no open answer form.');
    input.value = answer; await submit(false); return visibleStatus();
  },
});
window.addEventListener('pagehide', removeGameTools, { once: true });
