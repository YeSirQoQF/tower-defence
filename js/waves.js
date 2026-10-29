import { DIFFICULTIES, ENEMY_TYPES, WAVE_CONFIG } from './config.js';
import { makeRng, weightedPick } from './rng.js';

export function createWave(seed, difficultyKey = 'normal', index = 1, giant = false) {
  const diff = DIFFICULTIES[difficultyKey] || DIFFICULTIES.normal;
  const rng = makeRng(`wave|${seed}|${diff.key}|${index}`);
  const w = Math.max(1, Math.floor(index));

  const growthWave = Math.min(w, WAVE_CONFIG.count);
  let budget =
    WAVE_CONFIG.baseBudget *
    Math.pow(WAVE_CONFIG.budgetGrowth, growthWave - 1) *
    Math.pow(WAVE_CONFIG.endlessGrowth, Math.max(0, w - WAVE_CONFIG.count)) *
    diff.budgetMul;

  let hpMul =
    (1 + WAVE_CONFIG.hpGrowth * (w - 1)) *
    diff.enemyHpMul *
    Math.pow(WAVE_CONFIG.endlessHpGrowth, Math.max(0, w - WAVE_CONFIG.count));
  const speedMul = Math.min(WAVE_CONFIG.maxSpeedMul, 1 + WAVE_CONFIG.speedGrowth * (w - 1));
  const rewardMul = 1 + WAVE_CONFIG.rewardGrowth * (w - 1);

  budget = Math.round(budget);

  const groups = [];
  const pool = ['grunt'];
  if (w >= 2) pool.push('runner');
  if (w >= 3) pool.push('tank');
  if (w >= 4) pool.push('bombardier');
  if (w >= 6) pool.push('flyer');

  const tankBoost = Math.min(2.4, 1 + Math.max(0, w - WAVE_CONFIG.count) * 0.045);
  const desiredGroups = Math.min(7, 2 + Math.floor((w - 1) / 2));
  let remaining = budget;
  let delay = 0;

  for (let g = 0; g < desiredGroups && remaining >= 0.6; g++) {
    const groupsLeft = desiredGroups - g;
    const share = Math.max(
      Math.min(remaining, 1.4),
      (remaining / groupsLeft) * (0.75 + rng() * 0.5)
    );
    const affordable = pool.filter((id) => ENEMY_TYPES[id].cost <= share + 0.8);
    if (!affordable.length) break;

    const weights = affordable.map((id) => {
      if (id === 'tank') return ENEMY_TYPES[id].weight * tankBoost;
      return ENEMY_TYPES[id].weight;
    });
    const id = weightedPick(rng, affordable, weights);
    const type = ENEMY_TYPES[id];
    const maxCount = Math.max(1, Math.floor((remaining + 0.8) / type.cost));
    const count = Math.min(maxCount, Math.max(1, Math.round(share / type.cost)));

    groups.push({
      type: id,
      count,
      interval: type.interval * (0.9 + rng() * 0.2),
      delay
    });

    remaining -= count * type.cost;
    delay += count * type.interval * 0.62 + 0.5 + rng() * 0.6;
  }

  if (w >= diff.eliteStartWave && (w - diff.eliteStartWave) % WAVE_CONFIG.eliteEvery === 0) {
    groups.push({
      type: 'elite',
      count: 1 + Math.floor((w - diff.eliteStartWave) / (WAVE_CONFIG.eliteEvery * 2)),
      interval: 2.4,
      delay
    });
  }

  if (giant) {
    groups.push({
      type: w >= 8 ? 'tank' : 'grunt',
      count: 1 + Math.floor((w - 1) / 6),
      interval: 1.3,
      delay: delay + 1.5,
      patrol: true
    });
  }

  const rawCount = groups.reduce((sum, group) => sum + group.count, 0);
  if (rawCount > WAVE_CONFIG.enemyCap) {
    const scale = WAVE_CONFIG.enemyCap / rawCount;
    for (const group of groups) {
      if (group.type === 'elite') continue;
      group.count = Math.max(1, Math.round(group.count * scale));
    }
    hpMul *= Math.min(2.6, Math.sqrt(rawCount / WAVE_CONFIG.enemyCap));
  }

  return {
    index: w,
    budget,
    groups,
    hpMul,
    speedMul,
    rewardMul
  };
}

export function generateWaves(seed, difficultyKey = 'normal', count = WAVE_CONFIG.count) {
  const waves = [];
  for (let index = 1; index <= count; index++) {
    waves.push(createWave(seed, difficultyKey, index));
  }
  return waves;
}

export function waveTotals(wave) {
  let count = 0;
  let hp = 0;
  for (const group of wave.groups) {
    const type = ENEMY_TYPES[group.type];
    count += group.count;
    hp += type.hp * wave.hpMul * group.count;
  }
  return { count, hp: Math.round(hp) };
}

export function waveSummary(wave) {
  const counts = new Map();
  for (const group of wave.groups) {
    counts.set(group.type, (counts.get(group.type) || 0) + group.count);
  }
  return [...counts.entries()].map(([type, count]) => ({
    type,
    name: ENEMY_TYPES[type].name,
    count
  }));
}
