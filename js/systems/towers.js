export const PULSE_UPGRADE = Object.freeze({
  costs: [
    20, 24, 28, 34, 40, 48, 57, 68, 80, 96,
    114, 136, 161, 192, 228, 272, 323, 385, 458, 545,
    649, 772, 918, 1093, 1301, 1548, 1842, 2192, 2608, 3104, 3694
  ],
  maxLevel: 32,
  damagePerLevel: 1.04,
  rangePerLevel: 0.2,
  overclockRate: 1.05,
  overclock: {
    name: '超频',
    desc: '射击频率 +5%'
  },
  pierce: {
    name: '穿透',
    desc: '每次攻击额外穿透 1 个敌人'
  }
});

export const SUPPLY_UPGRADE = Object.freeze({
  costs: [
    60, 69, 79, 91, 105, 121, 139, 160, 184, 211, 243, 279,
    321, 369, 425, 488, 561, 646, 743, 854, 982, 1129, 1299, 1493
  ],
  maxLevel: 25,
  auraRangePerStack: 0.25,
  rangeBuffPerStack: 0.25,
  attackBuffPerStack: 0.08,
  maxHpBuffPerStack: 0.12,
  hastePerStack: 0.05,
  critChanceTiers: [0, 0.1, 0.2, 0.3],
  critDamageTiers: [0, 0.15, 0.3, 0.45],
  healBase: 6,
  healPerVitality: 2,
  healInterval: 1,
  rangeBuffCap: 4,
  attackBuffCap: 3,
  maxHpBuffCap: 3,
  hasteBuffCap: 1,
  critChanceCap: 1,
  critDamageCap: 1.5,
  maxCritTier: 3,
  range: {
    name: '增幅',
    desc: '光环内塔攻击范围 +0.25，光环范围 +0.25'
  },
  attack: {
    name: '过载',
    desc: '光环内攻击塔伤害 +8%'
  },
  vitality: {
    name: '生命回路',
    desc: '每秒治疗 +2，光环内塔生命上限 +12%'
  },
  haste: {
    name: '迅捷',
    desc: '光环内攻击塔攻击频率 +5%'
  },
  crit: {
    name: '致命',
    desc: '光环内攻击塔暴击率 +10%，暴击伤害 +15%'
  }
});

export const CANNON_UPGRADE = Object.freeze({
  costs: [50, 75, 105, 140, 180, 225, 275, 330],
  maxLevel: 9,
  damagePerLevel: 1.08,
  rangePerLevel: 0.12,
  splashPerLevel: 0.12
});

export const MAGIC_UPGRADE = Object.freeze({
  costs: [90, 120, 155, 195, 240, 290, 345, 405, 470],
  maxLevel: 10,
  reactionAmpPerLevel: 0.05,
  maxReactionLevels: 20
});

export const COIN_UPGRADE = Object.freeze({
  costs: [20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 100, 110, 120, 130, 140],
  maxLevel: 20,
  intervalFactor: 0.95
});

export function baseTowerStats(type) {
  return { ...type };
}

export function resolvePulseStats(type, level = 1, overclock = 0, pierce = 0) {
  const upgrades = Math.max(0, level - 1);
  return {
    ...type,
    level,
    damage: type.damage * Math.pow(PULSE_UPGRADE.damagePerLevel, upgrades),
    range: type.range + PULSE_UPGRADE.rangePerLevel * upgrades,
    fireRate: type.fireRate * Math.pow(PULSE_UPGRADE.overclockRate, overclock),
    pierce,
    overclock,
    pulseLevel: level
  };
}

export function resolveSupplyStats(
  type,
  level = 1,
  rangeStacks = 0,
  attackStacks = 0,
  vitalityStacks = 0,
  hasteStacks = 0,
  critTier = 0
) {
  const auraRange = (type.auraRange || type.range) + rangeStacks * SUPPLY_UPGRADE.auraRangePerStack;
  return {
    ...type,
    level,
    range: auraRange,
    auraRange,
    heal: SUPPLY_UPGRADE.healBase + vitalityStacks * SUPPLY_UPGRADE.healPerVitality,
    rangeStacks,
    attackStacks,
    vitalityStacks,
    hasteStacks,
    critTier,
    critChance: SUPPLY_UPGRADE.critChanceTiers[critTier] || 0,
    critDamage: SUPPLY_UPGRADE.critDamageTiers[critTier] || 0
  };
}

export function resolveCannonStats(type, level = 1) {
  const upgrades = Math.max(0, level - 1);
  return {
    ...type,
    level,
    damage: type.damage * Math.pow(CANNON_UPGRADE.damagePerLevel, upgrades),
    range: type.range + CANNON_UPGRADE.rangePerLevel * upgrades,
    splash: type.splash + CANNON_UPGRADE.splashPerLevel * upgrades
  };
}

export function resolveMagicStats(type, level = 1) {
  return {
    ...type,
    level,
    reactionAmp: Math.min(MAGIC_UPGRADE.maxReactionLevels, level) * MAGIC_UPGRADE.reactionAmpPerLevel
  };
}

export function resolveCoinStats(type, level = 1) {
  return {
    ...type,
    level,
    incomeInterval: type.incomeInterval * Math.pow(COIN_UPGRADE.intervalFactor, Math.max(0, level - 1))
  };
}

export function pulseUpgradeCost(tower) {
  if (tower.level >= PULSE_UPGRADE.maxLevel) return null;
  return PULSE_UPGRADE.costs[tower.level - 1];
}

export function supplyUpgradeCost(tower) {
  if (tower.level >= SUPPLY_UPGRADE.maxLevel) return null;
  return SUPPLY_UPGRADE.costs[tower.level - 1];
}

export function cannonUpgradeCost(tower) {
  if (tower.level >= CANNON_UPGRADE.maxLevel) return null;
  return CANNON_UPGRADE.costs[tower.level - 1];
}

export function magicUpgradeCost(tower) {
  if (tower.level >= MAGIC_UPGRADE.maxLevel) return null;
  return MAGIC_UPGRADE.costs[tower.level - 1];
}

export function coinUpgradeCost(tower) {
  if (tower.level >= COIN_UPGRADE.maxLevel) return null;
  return COIN_UPGRADE.costs[tower.level - 1];
}

export function resolveTowerStats(type, level = 1) {
  return {
    ...type,
    level
  };
}
