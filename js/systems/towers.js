export const PULSE_UPGRADE = Object.freeze({
  costs: [60, 105, 160, 225, 300, 390, 500, 630, 790, 980, 1210, 1490, 1830, 2250, 2760],
  maxLevel: 16,
  damagePerLevel: 1.06,
  rangePerLevel: 0.12,
  overclockRate: 1.08,
  overclock: {
    name: '超频',
    desc: '射击频率 +8%'
  },
  pierce: {
    name: '穿透',
    desc: '每次攻击额外穿透 1 个敌人'
  }
});

export const SUPPLY_UPGRADE = Object.freeze({
  costs: [90, 130, 180, 240, 310, 400, 510, 650],
  maxLevel: 9,
  auraRangePerStack: 0.25,
  rangeBuffPerStack: 0.25,
  attackBuffPerStack: 0.08,
  maxHpBuffPerStack: 0.12,
  healBase: 6,
  healPerVitality: 2,
  healInterval: 1,
  rangeBuffCap: 2,
  attackBuffCap: 1.5,
  maxHpBuffCap: 1.5,
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
  }
});

export function baseTowerStats(type) {
  return { ...type };
}

export function resolvePulseStats(type, level = 1, overclock = 0, pierce = 0) {
  const upgrades = Math.max(0, level - 1);
  const stats = {
    ...type,
    level,
    damage: type.damage * Math.pow(PULSE_UPGRADE.damagePerLevel, upgrades),
    range: type.range + PULSE_UPGRADE.rangePerLevel * upgrades,
    fireRate: type.fireRate * Math.pow(PULSE_UPGRADE.overclockRate, overclock),
    pierce,
    overclock,
    pulseLevel: level
  };
  return stats;
}

export function resolveSupplyStats(type, level = 1, rangeStacks = 0, attackStacks = 0, vitalityStacks = 0) {
  const auraRange = (type.auraRange || type.range) + rangeStacks * SUPPLY_UPGRADE.auraRangePerStack;
  return {
    ...type,
    level,
    range: auraRange,
    auraRange,
    heal: SUPPLY_UPGRADE.healBase + vitalityStacks * SUPPLY_UPGRADE.healPerVitality,
    rangeStacks,
    attackStacks,
    vitalityStacks
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

export function resolveTowerStats(type, level = 1) {
  return {
    ...type,
    level
  };
}
