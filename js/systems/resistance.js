import { DIFFICULTIES } from '../config.js';

export const RESISTANCE_KEYS = Object.freeze([
  'fire',
  'ice',
  'lightning',
  'wind',
  'water',
  'light',
  'dark'
]);

export const DAMAGE_RESISTANCE_KEYS = Object.freeze(['physical', 'magic']);
export const RESISTANCE_HARD_CAP = 0.8;
export const NORMAL_RESISTANCE_CAP = 0.6;
export const PHYSICAL_MAGIC_SUM_CAP = 1.4;
export const RESISTANCE_GROWTH_PER_WAVE = 0.003;
export const TANK_MIN_RESISTANCE = 0.05;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function createResistances(
  type,
  waveNumber = 1,
  difficultyKey = 'normal',
  rng = Math.random,
  growthPerWave = RESISTANCE_GROWTH_PER_WAVE
) {
  const base = type.resistances || {};
  const diff = DIFFICULTIES[difficultyKey] || DIFFICULTIES.normal;
  const cap = type.resistanceCap ?? (type.elite ? RESISTANCE_HARD_CAP : NORMAL_RESISTANCE_CAP);
  const growth = Math.max(0, waveNumber - 1) * growthPerWave;
  const resistances = {};
  for (const key of DAMAGE_RESISTANCE_KEYS) {
    const minimum = type.id === 'tank' ? TANK_MIN_RESISTANCE : type.minResistances?.[key] || 0;
    resistances[key] = clamp((base[key] || 0) + growth, minimum, cap);
  }

  const mean = Math.max(0, diff.attrResistStart + (waveNumber - 1) * diff.attrResistGrowth);
  const variance = diff.attrResistVariance;
  const normal = () => {
    const u = Math.max(1e-9, Math.min(1 - 1e-9, rng()));
    const v = Math.max(0, Math.min(1, rng()));
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * v);
  };
  for (const key of RESISTANCE_KEYS) {
    resistances[key] = clamp(mean + normal() * variance, 0, cap);
  }

  const pairSum = resistances.physical + resistances.magic;
  if (pairSum > PHYSICAL_MAGIC_SUM_CAP) {
    const scale = PHYSICAL_MAGIC_SUM_CAP / pairSum;
    resistances.physical = clamp(resistances.physical * scale, TANK_MIN_RESISTANCE, cap);
    resistances.magic = clamp(resistances.magic * scale, TANK_MIN_RESISTANCE, cap);
  }

  if (cap > NORMAL_RESISTANCE_CAP && RESISTANCE_KEYS.every((key) => resistances[key] > NORMAL_RESISTANCE_CAP)) {
    let weakest = RESISTANCE_KEYS[0];
    for (const key of RESISTANCE_KEYS) {
      if (resistances[key] < resistances[weakest]) weakest = key;
    }
    resistances[weakest] = NORMAL_RESISTANCE_CAP;
  }

  return {
    physical: resistances.physical,
    magic: resistances.magic,
    ...Object.fromEntries(RESISTANCE_KEYS.map((key) => [key, resistances[key]]))
  };
}

export function getResistanceMultiplier(enemy, damageType, element, attributeDebuff = 0) {
  if (!enemy.resistances) return 1;
  const damageResistance = enemy.resistances[damageType] || 0;
  const attributeResistance =
    element && element !== 'none'
      ? (enemy.resistances[element] || 0) + attributeDebuff
      : 0;
  return Math.max(0, (1 - damageResistance) * (1 - attributeResistance));
}
