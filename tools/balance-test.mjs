import { generateMap } from '../js/mapgen.js';
import { generateGiantMap } from '../js/giantmap.js';
import { createWave, generateWaves, waveTotals } from '../js/waves.js';
import { DIFFICULTIES, ENEMY_TYPES, TILE, TOWER_TYPES, WAVE_CONFIG } from '../js/config.js';
import {
  addAttachment,
  createStatus,
  decayStatus,
  getDarkReflectRatio,
  getLightDamageMultiplier,
  applySweepResistanceDebuff,
  applySpreadResistanceDebuff,
  getSpreadResistanceDebuff,
  getSweepResistanceDebuff,
  getStasisAttackFactor,
  getStasisMovementFactor,
  getAttachmentHalfLife,
  getLightResistanceDebuff,
  resolveReactions,
  tickScorch
} from '../js/systems/status.js';
import {
  RESISTANCE_KEYS,
  createResistances,
  getResistanceMultiplier
} from '../js/systems/resistance.js';
import {
  PULSE_UPGRADE,
  SUPPLY_UPGRADE,
  CANNON_UPGRADE,
  MAGIC_UPGRADE,
  COIN_UPGRADE
} from '../js/systems/towers.js';

const SAMPLES = Number(process.argv[2] || 300);
let failed = false;

const pad = (value, width = 7) => String(value).padStart(width);
const num = (value, digits = 2) => Number(value).toFixed(digits);

console.log(`\nMap generation balance test | ${SAMPLES} seeds per difficulty\n`);
console.log('difficulty  ok%  fallback  entr  attempts(avg/max)  pathLen(min/avg/max)  turns  cover(min/avg)  buildable  ms/map');

for (const key of Object.keys(DIFFICULTIES)) {
  const cfg = DIFFICULTIES[key];
  const started = performance.now();
  let ok = 0;
  let fallbacks = 0;
  let attemptsTotal = 0;
  let attemptsMax = 0;
  let lenMin = Infinity;
  let lenMax = -Infinity;
  let lenTotal = 0;
  let lenCount = 0;
  let turnsTotal = 0;
  let coverMin = Infinity;
  let coverTotal = 0;
  let buildableMin = Infinity;

  for (let i = 0; i < SAMPLES; i++) {
    const seed = `BALANCE-${key}-${i.toString(36)}`;
    const map = generateMap(seed, key);
    const m = map.metrics;
    const reasons = [];

    if (!m.ok) reasons.push('not-ok');
    if (m.fallback) reasons.push('fallback');
    if (m.relaxed) reasons.push('relaxed');
    if (map.paths.length !== cfg.entrances) reasons.push(`paths=${map.paths.length}`);
    if (map.spawns.length !== cfg.entrances) reasons.push(`spawns=${map.spawns.length}`);
    if (m.turnsTotal < cfg.minTurnsTotal || m.turnsTotal > cfg.maxTurnsTotal) {
      reasons.push(`turns=${m.turnsTotal}`);
    }
    if (m.minCover < cfg.minCover) reasons.push(`cover=${m.minCover}`);
    if (m.buildableRatio < cfg.minBuildableRatio) {
      reasons.push(`build=${m.buildableRatio.toFixed(2)}`);
    }
    if (m.maxPath5 > cfg.maxPath5) reasons.push(`density5=${m.maxPath5}`);
    if (m.pathBlocks2x2 > cfg.maxPathBlocks2x2) {
      reasons.push(`blocks=${m.pathBlocks2x2}`);
    }

    const unique = new Set();
    for (let y = 0; y < map.H; y++) {
      for (let x = 0; x < map.W; x++) {
        if (map.tiles[y * map.W + x] === TILE.PATH) unique.add(`${x},${y}`);
      }
    }

    for (const entry of map.paths) {
      if (entry.length < cfg.minPathLen || entry.length > cfg.maxPathLen) {
        reasons.push(`len=${entry.length}`);
      }
      const cells = entry.path;
      if (cells[0].y !== 0) reasons.push('start-y');
      const last = cells[cells.length - 1];
      if (last.x !== map.goal.x || last.y !== map.goal.y) reasons.push('goal');
      for (let j = 0; j < cells.length; j++) {
        const cell = cells[j];
        if (cell.x < 0 || cell.y < 0 || cell.x >= map.W || cell.y >= map.H) {
          reasons.push('bounds');
          break;
        }
        if (map.tiles[cell.y * map.W + cell.x] !== TILE.PATH) {
          reasons.push('tile');
          break;
        }
        if (j > 0) {
          const prev = cells[j - 1];
          if (Math.abs(cell.x - prev.x) + Math.abs(cell.y - prev.y) !== 1) {
            reasons.push('jump');
            break;
          }
          if (cell.y < prev.y) {
            reasons.push('backtrack');
            break;
          }
        }
      }
    }

    if (unique.size !== m.uniquePathCells) reasons.push('unique');
    if (!m.allPathsConnected) reasons.push('disconnected');
    if (m.pathCellsReachable !== m.uniquePathCells) reasons.push('reachable');

    const spawnSet = new Set();
    for (const spawn of map.spawns) {
      if (spawn.y !== 0 || spawn.x < 1 || spawn.x > map.W - 2) reasons.push('spawn-bounds');
      spawnSet.add(`${spawn.x},${spawn.y}`);
    }
    if (spawnSet.size !== cfg.entrances) reasons.push('spawn-distinct');

    if (m.ok) ok++;
    if (m.fallback) fallbacks++;
    attemptsTotal += m.attempts;
    attemptsMax = Math.max(attemptsMax, m.attempts);
    for (const entry of map.paths) {
      lenMin = Math.min(lenMin, entry.length);
      lenMax = Math.max(lenMax, entry.length);
      lenTotal += entry.length;
      lenCount++;
    }
    turnsTotal += m.turnsTotal;
    coverMin = Math.min(coverMin, m.minCover);
    coverTotal += m.avgCover;
    buildableMin = Math.min(buildableMin, m.buildableRatio);

    if (reasons.length) {
      failed = true;
      console.error(`  FAIL seed=${seed} ${[...new Set(reasons)].join(' ')}`);
    }
  }

  const elapsed = performance.now() - started;
  console.log(
    `${key.padEnd(11)} ${pad(((ok / SAMPLES) * 100).toFixed(1), 5)} ${pad(fallbacks, 9)} ${pad(cfg.entrances, 5)} ${pad(num(attemptsTotal / SAMPLES, 1), 8)}/${pad(attemptsMax, 5)} ${pad(`${lenMin}/${num(lenTotal / lenCount, 1)}/${lenMax}`, 20)} ${pad(num(turnsTotal / SAMPLES, 1), 6)} ${pad(`${coverMin}/${num(coverTotal / SAMPLES, 1)}`, 14)} ${pad(num(buildableMin, 2), 10)} ${pad(num(elapsed / SAMPLES, 2), 6)}`
  );
}

console.log('\nGiant map test (20 seeds)\n');
let giantOk = 0;
let giantMinCover = Infinity;
let giantMinBuildable = 1;
let giantCellsTotal = 0;
for (let i = 0; i < 20; i++) {
  const map = generateGiantMap(`GIANT-TEST-${i}`, 'normal');
  const reasons = [];
  if (!map.metrics.ok) reasons.push('not-ok');
  if (!map.metrics.allPathsConnected) reasons.push('disconnected');
  if (map.W !== 201 || map.H !== 201) reasons.push('size');
  if (map.strongholds.length !== 64) reasons.push('strongholds');
  const unlocks = map.strongholds.map((stronghold) => stronghold.unlockWave);
  if (unlocks[0] !== 1) reasons.push('first-unlock');
  for (let j = 1; j < unlocks.length; j++) {
    if (unlocks[j] !== unlocks[j - 1] + 1) reasons.push('unlock-gap');
  }
  if (unlocks[unlocks.length - 1] !== 64) reasons.push('last-unlock');
  if (map.spawns.length !== map.strongholds.length) reasons.push('spawns');
  if (map.metrics.uniquePathCells < 1000) reasons.push('cells');
  if (reasons.length) {
    failed = true;
    console.error(`  GIANT FAIL seed=${i} ${reasons.join(' ')}`);
  } else {
    giantOk++;
  }
  giantMinCover = Math.min(giantMinCover, map.metrics.minCover);
  giantMinBuildable = Math.min(giantMinBuildable, map.metrics.buildableRatio);
  giantCellsTotal += map.metrics.uniquePathCells;
}
console.log(
  `giant ${((giantOk / 20) * 100).toFixed(1)}% ok · path cells avg ${Math.round(giantCellsTotal / 20)} · minCover ${giantMinCover} · buildable min ${giantMinBuildable.toFixed(2)} · 64 strongholds · normal unlocks every wave`
);

console.log('\nStronghold unlock rates\n');
for (const key of Object.keys(DIFFICULTIES)) {
  const map = generateGiantMap(`GIANT-RATE-${key}`, key);
  const rate = DIFFICULTIES[key].giantStrongholdRate;
  let ok = map.strongholds.length === 64;
  for (let i = 0; i < map.strongholds.length; i++) {
    if (map.strongholds[i].unlockWave !== 1 + Math.floor(i / rate)) {
      ok = false;
      break;
    }
  }
  if (!ok) failed = true;
  console.log(
    `${key.padEnd(8)} rate ${rate} / wave · first ${map.strongholds[0].unlockWave} · last ${map.strongholds[map.strongholds.length - 1].unlockWave} · ${ok ? 'PASS' : 'FAIL'}`
  );
}

for (const w of [1, 7, 8, 13]) {
  const normal = waveTotals(createWave('GIANT-WAVE', 'normal', w));
  const giantWave = createWave('GIANT-WAVE', 'normal', w, true);
  const giant = waveTotals(giantWave);
  const expected = 1 + Math.floor((w - 1) / 6);
  const patrol = giantWave.groups.find((group) => group.patrol);
  if (!patrol || patrol.count !== expected || giant.count !== normal.count + expected) {
    failed = true;
    console.error(`Giant wave ${w} patrol mismatch`);
  }
}

console.log('\nEndless waves\n');
console.log('wave  enemies  totalHP  groups');
let previousHp = 0;
for (const index of [13, 20, 30, 40]) {
  const wave = createWave('ENDLESS-TEST', 'normal', index);
  const totals = waveTotals(wave);
  console.log(
    `${pad(index, 4)}  ${pad(totals.count, 7)}  ${pad(totals.hp, 7)}  ${pad(wave.groups.length, 6)}`
  );
  if (index === 13) {
    const wave11 = waveTotals(createWave('ENDLESS-TEST', 'normal', 11));
    previousHp = wave11.hp;
  }
  if (totals.hp <= previousHp) {
    failed = true;
    console.error(`Endless wave ${index} HP does not increase`);
  }
  previousHp = totals.hp;
  if (totals.count > WAVE_CONFIG.enemyCap + 10) {
    failed = true;
    console.error(`Endless wave ${index} exceeds enemy cap`);
  }
}

console.log(`\nWave curve (${WAVE_CONFIG.count} waves, averages over 200 seeds)\n`);
console.log('wave  enemies  totalHP  budget  groups  composition');
const waveSamples = 200;
const waveCount = WAVE_CONFIG.count;
const agg = Array.from({ length: waveCount }, () => ({ enemies: 0, hp: 0, groups: 0, budget: 0 }));
const comp = Array.from({ length: waveCount }, () => new Map());

for (let i = 0; i < waveSamples; i++) {
  const waves = generateWaves(`WAVE-${i}`);
  for (const wave of waves) {
    const totals = waveTotals(wave);
    const slot = agg[wave.index - 1];
    slot.enemies += totals.count;
    slot.hp += totals.hp;
    slot.groups += wave.groups.length;
    slot.budget += wave.budget;
    for (const group of wave.groups) {
      comp[wave.index - 1].set(group.type, (comp[wave.index - 1].get(group.type) || 0) + group.count);
    }
  }
}

for (let w = 1; w <= waveCount; w++) {
  const slot = agg[w - 1];
  const parts = [...comp[w - 1].entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${type}:${Math.round(count / waveSamples)}`)
    .join(' ');
  console.log(
    `${pad(w, 4)} ${pad(num(slot.enemies / waveSamples, 0), 7)} ${pad(num(slot.hp / waveSamples, 0), 7)} ${pad(num(slot.budget / waveSamples, 0), 6)} ${pad(num(slot.groups / waveSamples, 1), 6)}  ${parts}`
  );
}

for (let w = 1; w <= waveCount; w++) {
  if (agg[w - 1].hp <= 0 || agg[w - 1].enemies <= 0) {
    failed = true;
    console.error(`Wave ${w} is empty`);
  }
}

const milestone = [1, 4, 8, 12];
for (let i = 1; i < milestone.length; i++) {
  const prev = agg[milestone[i - 1] - 1].hp;
  const curr = agg[milestone[i] - 1].hp;
  if (curr <= prev * 1.15) {
    failed = true;
    console.error(`Difficulty does not ramp between waves ${milestone[i - 1]} and ${milestone[i]} (${Math.round(prev)} -> ${Math.round(curr)})`);
  }
}

for (const key of Object.keys(DIFFICULTIES)) {
  const start = DIFFICULTIES[key].eliteStartWave;
  const waves = generateWaves('ELITE-CHECK', key, start);
  for (let w = 1; w < start; w++) {
    if (waves[w - 1].groups.some((group) => group.type === 'elite')) {
      failed = true;
      console.error(`${key} wave ${w} has an early elite`);
    }
  }
  if (!waves[start - 1].groups.some((group) => group.type === 'elite')) {
    failed = true;
    console.error(`${key} wave ${start} is missing an elite`);
  }
}

console.log('\nAttribute reactions\n');
const makeReactionEnemy = () => ({
  status: createStatus(),
  hp: 1000,
  maxHp: 1000,
  dead: false
});
const resolveCase = (adds, prepare) => {
  const enemy = makeReactionEnemy();
  if (prepare) prepare(enemy);
  for (const [element, amount] of adds) addAttachment(enemy, element, amount);
  return { enemy, events: resolveReactions(enemy, () => {}) };
};
let reactionFailures = 0;
const checkReaction = (name, condition, detail) => {
  if (!condition) {
    failed = true;
    reactionFailures++;
    console.error(`  REACTION FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
};

const annihilation = resolveCase([['light', 1], ['dark', 1]]);
checkReaction(
  'annihilation',
  annihilation.events.some(
    (event) =>
      event.type === 'annihilation' &&
      event.damage === 64 &&
      event.radius === 3.6 &&
      event.highestTrueRatio === 0.2 &&
      event.otherTrueRatio === 0.05
  )
);
const scorch = resolveCase([['dark', 1], ['fire', 1]]);
checkReaction('scorch', scorch.enemy.status.scorch && scorch.events.some((event) => event.type === 'scorch'));
const drunken = resolveCase([['dark', 1], ['water', 1]]);
checkReaction('drunken', drunken.enemy.status.drunken && drunken.events.some((event) => event.type === 'drunken'));
const stasis = resolveCase([['dark', 1], ['ice', 1]]);
checkReaction('stasis', stasis.enemy.status.stasis && stasis.events.some((event) => event.type === 'stasis'));
const parallel = resolveCase([['dark', 1], ['lightning', 1]]);
checkReaction(
  'parallel',
  parallel.events.some((event) => event.type === 'parallel' && event.radius === 2.8)
);
const sweep = resolveCase([['dark', 1], ['wind', 1]], (enemy) => {
  enemy.status.scorch = { tickTimer: 0.7 };
  enemy.status.drunken = true;
  enemy.status.stasis = true;
});
checkReaction('sweep', sweep.events.some((event) => event.type === 'sweep' && event.debuffs.length === 3 && event.radius === 3));
const melt = resolveCase([['fire', 1], ['ice', 1]]);
checkReaction('melt', melt.events.some((event) => event.type === 'melt' && event.damage === 8));
const evaporate = resolveCase([['fire', 1], ['water', 1]]);
checkReaction('evaporate', evaporate.events.some((event) => event.type === 'evaporate' && event.damage === 12));

const lightProtected = makeReactionEnemy();
addAttachment(lightProtected, 'light', 1);
addAttachment(lightProtected, 'fire', 2);
decayStatus(lightProtected, 1);
checkReaction(
  'light-protect',
  lightProtected.status.attachments.fire === 2 && lightProtected.status.attachments.light < 1
);
const lightResistEnemy = makeReactionEnemy();
addAttachment(lightResistEnemy, 'light', 1);
addAttachment(lightResistEnemy, 'fire', 2);
checkReaction(
  'light-resist-debuff',
  Math.abs(getLightResistanceDebuff(lightResistEnemy, 'fire') + 0.2) < 1e-9
);
const spreadEnemy = makeReactionEnemy();
applySpreadResistanceDebuff(spreadEnemy, 'fire');
checkReaction(
  'spread-resist',
  getSpreadResistanceDebuff(spreadEnemy, 'fire') === -0.3 &&
    getSpreadResistanceDebuff(spreadEnemy, 'wind') === -0.2
);
applySpreadResistanceDebuff(spreadEnemy, 'ice');
checkReaction(
  'spread-refresh',
  getSpreadResistanceDebuff(spreadEnemy, 'fire') === 0 &&
    getSpreadResistanceDebuff(spreadEnemy, 'ice') === -0.3
);
const sweepEnemy = makeReactionEnemy();
checkReaction(
  'sweep-resist-once',
  applySweepResistanceDebuff(sweepEnemy) &&
    !applySweepResistanceDebuff(sweepEnemy) &&
    getSweepResistanceDebuff(sweepEnemy) === -0.2
);
const negativeResistance = { resistances: { physical: 0, fire: 0.1, magic: 0 } };
checkReaction(
  'negative-resistance',
  getResistanceMultiplier(negativeResistance, 'physical', 'fire', -0.6) > 1.4
);
const lightHalfLifeEnemy = makeReactionEnemy();
const darkHalfLifeEnemy = makeReactionEnemy();
const fireHalfLifeEnemy = makeReactionEnemy();
addAttachment(lightHalfLifeEnemy, 'light', 1);
addAttachment(darkHalfLifeEnemy, 'dark', 1);
addAttachment(fireHalfLifeEnemy, 'fire', 1);
decayStatus(lightHalfLifeEnemy, 1);
decayStatus(darkHalfLifeEnemy, 1);
decayStatus(fireHalfLifeEnemy, 1);
checkReaction(
  'light-dark-half-life',
  getAttachmentHalfLife('light') === 2.5 &&
    getAttachmentHalfLife('dark') === 2.5 &&
    getAttachmentHalfLife('fire') === 1 &&
    lightHalfLifeEnemy.status.attachments.light > fireHalfLifeEnemy.status.attachments.fire &&
    darkHalfLifeEnemy.status.attachments.dark > fireHalfLifeEnemy.status.attachments.fire
);
const light = { status: { attachments: { light: 4 } } };
checkReaction('light-amp', getLightDamageMultiplier(light) === 1.6);
const dark = { status: { attachments: { dark: 4 } } };
checkReaction('dark-reflect', getDarkReflectRatio(dark) === 0.8);
const stasisEnemy = { status: { stasis: true } };
checkReaction(
  'stasis-factors',
  getStasisMovementFactor(stasisEnemy) === 0.2 && getStasisAttackFactor(stasisEnemy) === 0.2
);
const scorchTickEnemy = makeReactionEnemy();
scorchTickEnemy.status.scorch = { tickTimer: 0.01 };
let scorchTickDamage = 0;
tickScorch(scorchTickEnemy, 0.02, (_, amount) => {
  scorchTickDamage += amount;
});
checkReaction('scorch-tick', scorchTickDamage === 7.2);

if (reactionFailures === 0) console.log('all attribute reactions and debuffs passed');
else console.error(`${reactionFailures} attribute reaction checks failed`);

console.log('\nEnemy resistances\n');
let resistanceFailures = 0;
const checkResistance = (name, condition) => {
  if (!condition) {
    failed = true;
    resistanceFailures++;
    console.error(`  RESISTANCE FAIL ${name}`);
  }
};
for (const [id, type] of Object.entries(ENEMY_TYPES)) {
  const cap = type.resistanceCap ?? 0.6;
  for (const wave of [1, 30, 100, 200]) {
    const resistances = createResistances(type, wave);
    checkResistance(`${id}@${wave} cap`, Object.values(resistances).every((value) => value <= cap + 1e-9));
    checkResistance(
      `${id}@${wave} pair`,
      resistances.physical + resistances.magic <= 1.4 + 1e-9
    );
    checkResistance(
      `${id}@${wave} attributes`,
      !RESISTANCE_KEYS.every((key) => resistances[key] > 0.6)
    );
    if (id === 'tank') {
      checkResistance(
        `${id}@${wave} minimum`,
        resistances.physical >= 0.05 && resistances.magic >= 0.05
      );
    }
  }
}
const resistanceSample = { resistances: { physical: 0.5, magic: 0.2, fire: 0.25 } };
checkResistance(
  'damage-multiplier',
  Math.abs(getResistanceMultiplier(resistanceSample, 'physical', 'fire') - 0.375) < 1e-9
);
if (resistanceFailures === 0) console.log('all enemy resistance constraints passed');

const upgradeChecks = [
  ['pulse', PULSE_UPGRADE.costs.length, PULSE_UPGRADE.maxLevel],
  ['supply', SUPPLY_UPGRADE.costs.length, SUPPLY_UPGRADE.maxLevel],
  ['cannon', CANNON_UPGRADE.costs.length, CANNON_UPGRADE.maxLevel],
  ['magic', MAGIC_UPGRADE.costs.length, MAGIC_UPGRADE.maxLevel],
  ['coin', COIN_UPGRADE.costs.length, COIN_UPGRADE.maxLevel]
];
for (const [name, costCount, maxLevel] of upgradeChecks) {
  if (costCount !== maxLevel - 1) {
    failed = true;
    console.error(`  UPGRADE FAIL ${name}: costs ${costCount}, maxLevel ${maxLevel}`);
  }
}
const sumCosts = (costs) => costs.reduce((sum, cost) => sum + cost, 0);
const pulseTotal = TOWER_TYPES.gun.cost + sumCosts(PULSE_UPGRADE.costs);
const supplyTotal = TOWER_TYPES.supply.cost + sumCosts(SUPPLY_UPGRADE.costs);
const magicTotal = TOWER_TYPES.magic.cost + sumCosts(MAGIC_UPGRADE.costs);
if (pulseTotal > 24000) {
  failed = true;
  console.error(`  BUDGET FAIL pulse ${pulseTotal}`);
}
if (supplyTotal > 12000) {
  failed = true;
  console.error(`  BUDGET FAIL supply ${supplyTotal}`);
}
if (magicTotal > 3000) {
  failed = true;
  console.error(`  BUDGET FAIL magic ${magicTotal}`);
}
if (
  COIN_UPGRADE.maxLevel !== 20 ||
  COIN_UPGRADE.costs[0] !== 1 ||
  COIN_UPGRADE.costs[COIN_UPGRADE.costs.length - 1] !== 20
) {
  failed = true;
  console.error('  UPGRADE FAIL coin level/cost');
}
if (SUPPLY_UPGRADE.critChanceCap !== 1 || SUPPLY_UPGRADE.maxCritTier !== 3) {
  failed = true;
  console.error('  UPGRADE FAIL crit cap/tier');
}
if (PULSE_UPGRADE.rangePerLevel < 0.2 || CANNON_UPGRADE.rangePerLevel < 0.12) {
  failed = true;
  console.error('  UPGRADE FAIL pulse/cannon range growth');
}
console.log(
  `budgets · pulse ${pulseTotal} · supply ${supplyTotal} · magic ${magicTotal} · coin Lv.${COIN_UPGRADE.maxLevel} (${COIN_UPGRADE.costs[0]}→${COIN_UPGRADE.costs[COIN_UPGRADE.costs.length - 1]})`
);

console.log(`\nResult: ${failed ? 'FAILED' : 'PASSED'}\n`);
process.exit(failed ? 1 : 0);

