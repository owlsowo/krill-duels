import { getHintGuide } from './hints';

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]!);

interface HintOptions {
  /** Null means free solo practice. */
  cost: number | null;
  hp?: number;
  disabled?: boolean;
  pending?: boolean;
  message?: string;
}

/** Only the purchased letter pattern enters the page, including accessibility text. */
export function hintMarkup(promptId: string, level: number, options: HintOptions): string {
  const guide = getHintGuide(promptId);
  if (!guide) return '';
  const unlocked = Math.max(0, Math.min(3, Math.floor(level)));
  const exhausted = unlocked === 3;
  const affordable = options.cost === null || (options.hp ?? 0) > options.cost;
  const disabled = exhausted || !affordable || options.disabled || options.pending;
  const label = options.pending ? 'Getting hint…' : exhausted ? 'All hints shown' : unlocked ? 'More letters' : 'Hint';
  const price = exhausted ? 'No more hints for this question' : options.cost === null ? 'Free in solo practice' : `Next hint: ${options.cost} HP damage`;
  const notice = options.message || (!exhausted && !affordable ? 'You must have HP left after buying a hint.' : '');
  const pattern = unlocked ? guide.patterns[unlocked - 1] : '';
  const spelling = Array.from(pattern).map(character => character === '_' ? 'blank' : character === ' ' ? ' / ' : character).join(' ');
  const clue = unlocked
    ? `<p class="hint-heading">Hint ${unlocked}/3 · One ${guide.score}-point answer</p><div class="hint-pattern" role="img" aria-label="${escapeHtml(spelling)}">${pattern.split(' ').map(word => `<span aria-hidden="true">${escapeHtml(word)}</span>`).join(' ')}</div><p class="hint-detail">Word lengths: ${guide.wordLengths.join(' + ')} · ${unlocked === 3 ? 'Fill the missing character, then lock in your answer.' : 'Each purchase reveals more of this same answer.'}</p>`
    : `<p class="hint-preview">Reveal letters for one <strong>${guide.score}-point answer</strong>. More letters with each hint.</p>`;
  return `<section class="context-hints" aria-label="Question hints"><div class="hint-purchase"><button type="button" class="secondary" data-action="hint" aria-describedby="hint-cost" ${disabled ? 'disabled' : ''}>${label}</button><small id="hint-cost">${price}</small></div><div class="hint-context" aria-live="polite" aria-atomic="true">${clue}${notice ? `<p class="hint-notice" role="status">${escapeHtml(notice)}</p>` : ''}</div></section>`;
}
