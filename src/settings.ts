export interface DuelSettings {
  startingHp: number;
  questionSeconds: number;
  damageScaling: boolean;
  playerCount: number;
}
export const TIME_OPTIONS = [15, 25, 45, 60, 90] as const;
export const PLAYER_COUNT_MIN = 2;
export const PLAYER_COUNT_MAX = 6;
export const DEFAULT_SETTINGS: DuelSettings = {
  startingHp: 300, questionSeconds: 25, damageScaling: true, playerCount: 2,
};
export function validSettings(value: unknown): value is DuelSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const s = value as DuelSettings;
  return Object.keys(s).length === 4 && Number.isInteger(s.startingHp) && s.startingHp >= 100 && s.startingHp <= 10_000 &&
    (TIME_OPTIONS as readonly number[]).includes(s.questionSeconds) && typeof s.damageScaling === 'boolean' &&
    Number.isInteger(s.playerCount) && s.playerCount >= PLAYER_COUNT_MIN && s.playerCount <= PLAYER_COUNT_MAX;
}
/** Accept current settings or legacy 3-key saves (defaulting to 2 players). */
export function normalizeSettings(value: unknown): DuelSettings | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<DuelSettings>;
  const next: DuelSettings = {
    startingHp: raw.startingHp as number,
    questionSeconds: raw.questionSeconds as number,
    damageScaling: raw.damageScaling as boolean,
    playerCount: Number.isInteger(raw.playerCount) ? raw.playerCount as number : 2,
  };
  return validSettings(next) ? next : null;
}
export function settingsCopy(value: DuelSettings): DuelSettings {
  if (validSettings(value)) return { ...value };
  // Legacy local saves omitted playerCount (exactly the original three fields).
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 3) {
    const normalized = normalizeSettings(value);
    if (normalized) return normalized;
  }
  throw new Error('Choose 100–10,000 HP, 2–6 players, a supported timer, and a damage setting.');
}
