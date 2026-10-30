export const TILE = Object.freeze({
  EMPTY: 0,
  PATH: 1,
  ROCK: 2
});

export const MODES = Object.freeze({
  regular: {
    id: 'regular',
    label: '常规模式',
    waveLimit: 12,
    endless: false,
    giant: false,
    prepTime: 30,
    earlyBonusRate: 1.2
  },
  endless: {
    id: 'endless',
    label: '无尽模式',
    waveLimit: Infinity,
    endless: true,
    giant: false,
    prepTime: 30,
    earlyBonusRate: 1.2
  },
  giant: {
    id: 'giant',
    label: '巨型模式',
    waveLimit: Infinity,
    endless: true,
    giant: true,
    prepTime: 30,
    earlyBonusRate: 1.2
  }
});

export const DAMAGE_TYPES = Object.freeze({
  physical: { id: 'physical', label: '物理', color: 0x94a3b8 },
  magic: { id: 'magic', label: '魔法', color: 0x818cf8 }
});

export const ELEMENTS = Object.freeze({
  none: { id: 'none', label: '无', color: 0x94a3b8 },
  fire: { id: 'fire', label: '火', color: 0xfb923c },
  ice: { id: 'ice', label: '冰', color: 0x67e8f9 },
  lightning: { id: 'lightning', label: '雷', color: 0xfacc15 },
  wind: { id: 'wind', label: '风', color: 0x4ade80 },
  water: { id: 'water', label: '水', color: 0x60a5fa },
  light: { id: 'light', label: '光', color: 0xfef08a },
  dark: { id: 'dark', label: '暗', color: 0xa855f7 }
});

export const TILE_SIZE = 2;

export const DIFFICULTIES = Object.freeze({
  easy: {
    key: 'easy',
    label: '轻松',
    W: 27,
    H: 35,
    entrances: 3,
    mergeRows: 14,
    bandGap: 3,
    joinSpacing: 5,
    crossLinks: 1,
    maxRun: 4,
    straightChance: 0.48,
    momentum: 0.52,
    minPathLen: 52,
    maxPathLen: 85,
    minTurnsTotal: 5,
    maxTurnsTotal: 34,
    rockRatio: 0.025,
    coverRadius: 2.45,
    minCover: 2,
    minBuildableRatio: 0.55,
    maxPath5: 16,
    maxPathBlocks2x2: 3,
    startGold: 270,
    lives: 22,
    enemyHpMul: 0.85,
    budgetMul: 0.92,
    giantStrongholdRate: 0.5,
    eliteStartWave: 13,
    attrResistStart: 0.1,
    attrResistGrowth: 0.0025,
    attrResistVariance: 0.025
  },
  normal: {
    key: 'normal',
    label: '标准',
    W: 35,
    H: 45,
    entrances: 4,
    mergeRows: 20,
    bandGap: 3,
    joinSpacing: 5,
    crossLinks: 2,
    maxRun: 4,
    straightChance: 0.46,
    momentum: 0.52,
    minPathLen: 65,
    maxPathLen: 110,
    minTurnsTotal: 10,
    maxTurnsTotal: 50,
    rockRatio: 0.03,
    coverRadius: 2.45,
    minCover: 2,
    minBuildableRatio: 0.5,
    maxPath5: 16,
    maxPathBlocks2x2: 3,
    startGold: 300,
    lives: 20,
    enemyHpMul: 1,
    budgetMul: 1,
    giantStrongholdRate: 1,
    eliteStartWave: 10,
    attrResistStart: 0.12,
    attrResistGrowth: 0.004,
    attrResistVariance: 0.03
  },
  hard: {
    key: 'hard',
    label: '高压',
    W: 43,
    H: 57,
    entrances: 5,
    mergeRows: 26,
    bandGap: 3,
    joinSpacing: 5,
    crossLinks: 3,
    maxRun: 5,
    straightChance: 0.44,
    momentum: 0.5,
    minPathLen: 75,
    maxPathLen: 145,
    minTurnsTotal: 18,
    maxTurnsTotal: 70,
    rockRatio: 0.035,
    coverRadius: 2.45,
    minCover: 2,
    minBuildableRatio: 0.45,
    maxPath5: 16,
    maxPathBlocks2x2: 3,
    startGold: 340,
    lives: 16,
    enemyHpMul: 1.32,
    budgetMul: 1.28,
    giantStrongholdRate: 2,
    eliteStartWave: 7,
    attrResistStart: 0.16,
    attrResistGrowth: 0.0055,
    attrResistVariance: 0.035
  }
});

export const TOWER_TYPES = Object.freeze({
  gun: {
    id: 'gun',
    name: '脉冲枪塔',
    key: '1',
    cost: 45,
    hp: 120,
    range: 3.1,
    fireRate: 2.6,
    damage: 9,
    damageType: 'physical',
    element: 'none',
    color: 0x38bdf8,
    accent: 0x0ea5e9,
    desc: '单体高频 · 性价比高'
  },
  cannon: {
    id: 'cannon',
    name: '震荡炮塔',
    key: '2',
    cost: 50,
    hp: 160,
    range: 3.3,
    fireRate: 0.85,
    damage: 30,
    splash: 1.25,
    damageType: 'physical',
    element: 'none',
    color: 0xf59e0b,
    accent: 0xef4444,
    desc: '范围伤害 · 克制集群'
  },
  coin: {
    id: 'coin',
    name: '铸币塔',
    key: '',
    cost: 50,
    hp: 130,
    range: 0,
    fireRate: 0,
    damage: 0,
    damageType: 'physical',
    element: 'none',
    coinTower: true,
    income: 3,
    incomeInterval: 4,
    color: 0xfacc15,
    accent: 0xb45309,
    desc: '周期性生产金币 · 可升级'
  },
  supply: {
    id: 'supply',
    name: '供能塔',
    key: '3',
    cost: 80,
    hp: 160,
    range: 3.6,
    auraRange: 3.6,
    fireRate: 0,
    damage: 0,
    damageType: 'physical',
    element: 'none',
    support: true,
    color: 0x34d399,
    accent: 0x10b981,
    desc: '光环强化 · 治疗 · 生命上限'
  },
  magic: {
    id: 'magic',
    name: '魔法塔',
    key: '4',
    cost: 300,
    hp: 150,
    range: 4.2,
    fireRate: 0.9,
    damage: 10,
    splash: 1.3,
    damageType: 'magic',
    element: 'none',
    magicTower: true,
    recognizeRange: 2,
    pickCount: 3,
    castInterval: 0.08,
    color: 0xc084fc,
    accent: 0x7c3aed,
    desc: '抽取范围内属性；无属性时三连无属性魔法'
  },
  cursed: {
    id: 'cursed',
    name: '诅咒塔',
    key: '=',
    cost: 1000,
    hp: 180,
    range: 6,
    fireRate: 0.6,
    damage: 16,
    damageType: 'magic',
    element: 'none',
    curseTower: true,
    recognizeRange: 2,
    pickCount: 4,
    castInterval: 0.1,
    hpConsumeRatio: 0.04,
    damagePerHp: 1.6,
    untypedBonusRatio: 0.3,
    reactionLevels: 6,
    color: 0x7c3aed,
    accent: 0x4c1d95,
    desc: '抽取属性四连发 · 末段附加无属性伤害'
  },
  frost: {
    id: 'frost',
    name: '霜冻塔',
    key: '5',
    cost: 75,
    hp: 110,
    range: 2.7,
    fireRate: 1.3,
    damage: 4,
    damageType: 'physical',
    element: 'ice',
    color: 0x22d3ee,
    accent: 0x818cf8,
    desc: '冰属性物理 · 逐层减速'
  },
  burn: {
    id: 'burn',
    name: '灼烧塔',
    key: '6',
    cost: 95,
    hp: 130,
    range: 3,
    fireRate: 1.15,
    damage: 10,
    damageType: 'physical',
    element: 'fire',
    color: 0xf97316,
    accent: 0xdc2626,
    desc: '火属性物理 · 附加燃烧'
  },
  water: {
    id: 'water',
    name: '沧浪塔',
    key: '7',
    cost: 125,
    hp: 125,
    range: 3,
    fireRate: 1.15,
    damage: 11,
    damageType: 'physical',
    element: 'water',
    color: 0x60a5fa,
    accent: 0x2563eb,
    desc: '水属性物理 · 混沌治愈'
  },
  surge: {
    id: 'surge',
    name: '电涌塔',
    key: '8',
    cost: 150,
    hp: 130,
    range: 3,
    fireRate: 1.05,
    damage: 16,
    damageType: 'physical',
    element: 'lightning',
    color: 0xfacc15,
    accent: 0xeab308,
    desc: '雷属性物理 · 附着触电'
  },
  wind: {
    id: 'wind',
    name: '风爆塔',
    key: '9',
    cost: 255,
    hp: 170,
    range: 3.3,
    fireRate: 0.7,
    damage: 26,
    splash: 1.6,
    damageType: 'physical',
    element: 'wind',
    color: 0x4ade80,
    accent: 0x16a34a,
    desc: '风属性范围 · 附着风化'
  },
  light: {
    id: 'light',
    name: '曜辉塔',
    key: '0',
    cost: 800,
    hp: 115,
    range: 3.2,
    fireRate: 0.8,
    damage: 20,
    damageType: 'magic',
    element: 'light',
    color: 0xfef08a,
    accent: 0xf59e0b,
    desc: '光属性魔法 · 圣裁易伤'
  },
  dark: {
    id: 'dark',
    name: '玄蚀塔',
    key: '-',
    cost: 800,
    hp: 120,
    range: 3.2,
    fireRate: 0.85,
    damage: 22,
    damageType: 'magic',
    element: 'dark',
    color: 0xa855f7,
    accent: 0x6b21a8,
    desc: '暗属性魔法 · 幽冥反伤'
  }
});

export const ENEMY_TYPES = Object.freeze({
  grunt: {
    id: 'grunt',
    name: '步兵',
    hp: 22,
    speed: 1.85,
    cost: 1,
    weight: 5,
    reward: 3,
    interval: 0.8,
    leak: 1,
    score: 1,
    towerDamage: 2,
    detourChance: 0.28,
    size: 0.62,
    height: 0.72,
    color: 0xc4b5fd,
    accent: 0x7c3aed,
    resistances: {
      physical: 0.08,
      magic: 0.08,
    }
  },
  runner: {
    id: 'runner',
    name: '疾行者',
    hp: 14,
    speed: 3.1,
    cost: 0.7,
    weight: 3.2,
    reward: 2,
    interval: 0.55,
    leak: 1,
    score: 1,
    towerDamage: 1,
    detourChance: 0.38,
    size: 0.48,
    height: 0.58,
    color: 0xfdba74,
    accent: 0xea580c,
    resistances: {
      physical: 0.05,
      magic: 0.2,
    }
  },
  tank: {
    id: 'tank',
    name: '重甲',
    hp: 90,
    speed: 1,
    cost: 3.4,
    weight: 2.4,
    reward: 8,
    interval: 1.4,
    leak: 2,
    score: 3,
    towerDamage: 5,
    detourChance: 0.16,
    size: 0.92,
    height: 0.95,
    color: 0xfca5a5,
    accent: 0xb91c1c,
    resistances: {
      physical: 0.45,
      magic: 0.25,
    }
  },
  shaman: {
    id: 'shaman',
    name: '萨满',
    hp: 90,
    speed: 1.15,
    cost: 5,
    weight: 0.9,
    reward: 10,
    interval: 1.5,
    leak: 1,
    score: 3,
    towerDamage: 0,
    noAttack: true,
    healer: true,
    healInterval: 3.2,
    healRadius: 2.2,
    healRatio: 0.07,
    detourChance: 0.2,
    size: 0.8,
    height: 0.9,
    color: 0x5eead4,
    accent: 0x0f766e,
    attributeResistScale: 0.55,
    resistances: {
      physical: 0.12,
      magic: 0.18,








    }
  },
  elite: {
    id: 'elite',
    name: '精英·步兵',
    hp: 420,
    speed: 0.78,
    cost: 25,
    weight: 1,
    reward: 40,
    interval: 2.4,
    leak: 5,
    score: 20,
    towerDamage: 12,
    attackRange: 2.2,
    detourChance: 0.08,
    size: 1.55,
    height: 1.55,
    color: 0xf0abfc,
    accent: 0xa21caf,
    elite: true,
    resistanceCap: 0.9,
    resistances: {
      physical: 0.65,
      magic: 0.55,
    }
  },
  eliteFlyer: {
    id: 'eliteFlyer',
    name: '精英·飞行',
    hp: 520,
    speed: 1.7,
    cost: 28,
    weight: 0.8,
    reward: 45,
    interval: 2.8,
    leak: 0,
    score: 20,
    towerDamage: 0,
    noAttack: true,
    noLeak: true,
    flying: true,
    orbitalFlyer: true,
    baseAttackDamage: 1,
    altitude: 2.35,
    detourChance: 0,
    size: 1.35,
    height: 1.2,
    color: 0xbfdbfe,
    accent: 0x1d4ed8,
    elite: true,
    resistanceCap: 0.9,
    resistances: {
      physical: 0.6,
      magic: 0.55,








    }
  },
  eliteTank: {
    id: 'eliteTank',
    name: '精英·重甲',
    hp: 760,
    speed: 0.62,
    cost: 30,
    weight: 0.7,
    reward: 55,
    interval: 2.6,
    leak: 5,
    score: 25,
    towerDamage: 16,
    immuneChance: 0.3,
    minWave: 30,
    detourChance: 0.06,
    size: 1.75,
    height: 1.55,
    color: 0xfca5a5,
    accent: 0xb91c1c,
    elite: true,
    resistanceCap: 0.9,
    attributeResistScale: 1.1,
    resistances: {
      physical: 0.78,
      magic: 0.5,








    }
  },
  eliteShaman: {
    id: 'eliteShaman',
    name: '精英·萨满',
    hp: 950,
    speed: 0.7,
    cost: 32,
    weight: 0.65,
    reward: 60,
    interval: 3,
    leak: 5,
    score: 25,
    towerDamage: 4,
    healer: true,
    healInterval: 5.5,
    healRadius: 4.2,
    healRatio: 0.1,
    minWave: 25,
    detourChance: 0.1,
    size: 1.45,
    height: 1.45,
    color: 0x99f6e4,
    accent: 0x0f766e,
    elite: true,
    resistanceCap: 0.9,
    attributeResistScale: 0.75,
    resistances: {
      physical: 0.45,
      magic: 0.35,








    }
  },
  boss: {
    id: 'boss',
    name: '首领',
    hp: 5000,
    speed: 0.45,
    cost: 120,
    weight: 0,
    reward: 500,
    interval: 6,
    leak: 0,
    score: 100,
    towerDamage: 35,
    boss: true,
    noLeak: true,
    noBaseAttack: true,
    attackRange: 5,
    stopDistance: 4,
    immuneChance: 0.3,
    summonInterval: 14,
    stoppedSummonInterval: 8,
    summonCount: 2,
    summonMinDistanceFromBase: 9,
    detourChance: 0,
    size: 2.8,
    height: 2.6,
    color: 0xfdf4ff,
    accent: 0xa21caf,
    elite: true,
    resistanceCap: 0.9,
    attributeResistScale: 1.1,
    resistances: {
      physical: 0.72,
      magic: 0.62,








    }
  },
  bombardier: {
    id: 'bombardier',
    name: '投弹兵',
    hp: 78,
    speed: 1.25,
    cost: 4.2,
    weight: 1.1,
    reward: 9,
    interval: 1.8,
    leak: 2,
    score: 3,
    towerDamage: 0,
    bombard: true,
    bombInterval: 3.2,
    bombDamage: 10,
    bombRadius: 1.55,
    bombTravel: 0.7,
    bombRange: 6,
    detourChance: 0.12,
    size: 0.86,
    height: 0.82,
    color: 0xfbbf24,
    accent: 0xb45309,
    resistances: {
      physical: 0.5,
      magic: 0.15,
    }
  },
  flyer: {
    id: 'flyer',
    name: '飞行者',
    hp: 60,
    speed: 1.7,
    cost: 3.5,
    weight: 1.2,
    reward: 8,
    interval: 1.2,
    leak: 0,
    score: 2,
    towerDamage: 3,
    flying: true,
    noLeak: true,
    altitude: 1.9,
    detourChance: 0,
    size: 0.56,
    height: 0.52,
    color: 0x93c5fd,
    accent: 0x1d4ed8,
    resistances: {
      physical: 0.1,
      magic: 0.55,
    }
  }
});

export const WAVE_CONFIG = Object.freeze({
  count: 12,
  baseBudget: 10,
  budgetGrowth: 1.22,
  hpGrowth: 0.045,
  speedGrowth: 0.012,
  maxSpeedMul: 1.28,
  rewardGrowth: 0.03,
  eliteEvery: 4,
  endlessGrowth: 1.1,
  endlessHpGrowth: 1.065,
  lateCountGrowth: 0.06,
  budgetToHpExponent: 0.45,
  elitePromotionBase: 0.002,
  elitePromotionGrowth: 0.0008,
  bossStartWave: 50,
  bossEvery: 5,
  bossCountGrowthWaves: 50
});

export const ECONOMY = Object.freeze({
  sellRefund: 0.7,
  waveBonusBase: 30,
  waveBonusPerWave: 7
});


