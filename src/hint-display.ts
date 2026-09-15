import { getPromptHints } from './hints';

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]!);

interface HintOptions {
  /** Null means free solo practice. */
  cost: number | null;
  hp?: number;
  disabled?: boolean;
  pending?: boolean;
  message?: string;
}

/** Only purchased context enters the page, including accessibility text. */
export function hintMarkup(promptId: string, level: number, options: HintOptions): string {
  const hints = getPromptHints(promptId);
  if (!hints.length) return '';
  const exhausted = level >= hints.length;
  const affordable = options.cost === null || (options.hp ?? 0) > options.cost;
  const disabled = exhausted || !affordable || options.disabled || options.pending;
  const label = options.pending ? 'Getting hint…' : exhausted ? 'All hints shown' : level ? 'Better hint' : 'Hint';
  const price = exhausted ? 'No more hints for this question' : options.cost === null ? 'Free in solo practice' : `Next hint: ${options.cost} HP damage`;
  const notice = options.message || (!exhausted && !affordable ? 'You must have HP left after buying a hint.' : '');
  return `<section class="context-hints" aria-label="Question hints"><div class="hint-purchase"><button type="button" class="secondary" data-action="hint" aria-describedby="hint-cost" ${disabled ? 'disabled' : ''}>${label}</button><small id="hint-cost">${price}</small></div><div class="hint-context" aria-live="polite" aria-atomic="false">${hints.slice(0, level).map((hint, i) => `<p><span>Hint ${i + 1}</span>${escapeHtml(hint)}</p>`).join('')}${notice ? `<p class="hint-notice" role="status">${escapeHtml(notice)}</p>` : ''}</div></section>`;
}
