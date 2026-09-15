export interface DuelSettings { startingHp: number; questionSeconds: number; damageScaling: boolean }
export const TIME_OPTIONS = [15, 25, 45, 60, 90] as const;
export const DEFAULT_SETTINGS: DuelSettings = { startingHp: 300, questionSeconds: 25, damageScaling: true };
export function validSettings(value: unknown): value is DuelSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const s = value as DuelSettings;
  return Object.keys(s).length === 3 && Number.isInteger(s.startingHp) && s.startingHp >= 100 && s.startingHp <= 10_000 &&
    (TIME_OPTIONS as readonly number[]).includes(s.questionSeconds) && typeof s.damageScaling === 'boolean';
}
export function settingsCopy(value: DuelSettings): DuelSettings {
  if (!validSettings(value)) throw new Error('Choose 100–10,000 HP, a supported timer, and a damage setting.');
  return { ...value };
}
