import { ELEMENTS } from '../config.js';

export const MAX_ATTACHMENT = 4;
export const HALF_LIFE_SECONDS = 1;
export const LIGHT_DARK_HALF_LIFE_SECONDS = 2.5;
export const ICE_SLOW_PER_LAYER = 0.275;
export const BURN_TICK_SECONDS = 0.7;
export const BURN_DAMAGE_PER_LAYER = 1.6;
export const LIGHTNING_TICK_SECONDS = 0.7;
export const LIGHTNING_DAMAGE_PER_LAYER = 1.6;
export const WIND_TICK_SECONDS = 1.2;
export const WIND_DAMAGE_PER_LAYER = 1.2;
export const WIND_RADIUS_CELLS = 1.6;
export const SHOCK_TICK_SECONDS = 0.7;
export const SHOCK_DAMAGE_BASE = 1.8;
export const OVERLOAD_DAMAGE_PER_LAYER = 6;
export const SUPERCONDUCT_BASE_DAMAGE = 10;
export const SUPERCONDUCT_DOT_MULTIPLIER = 1.5;
export const LIGHT_DAMAGE_AMP_PER_LAYER = 0.15;
export const LIGHT_RESIST_REDUCTION_PER_LAYER = 0.1;
export const SPREAD_RESIST_REDUCTION = 0.3;
export const SPREAD_WIND_RESIST_REDUCTION = 0.2;
export const SPREAD_RESIST_DURATION = 6;
export const SWEEP_RESIST_REDUCTION = 0.2;
export const DARK_REFLECT_PER_LAYER = 0.2;
export const SCORCH_TICK_SECONDS = 0.7;
export const SCORCH_DAMAGE_PER_TICK = 7.2;
export const SCORCH_RADIUS_CELLS = 1.5;
export const STASIS_MOVE_FACTOR = 0.2;
export const STASIS_ATTACK_FACTOR = 0.2;
export const ANNIHILATION_BASE_DAMAGE = 40;
export const ANNIHILATION_DAMAGE_PER_LAYER = 12;
export const ANNIHILATION_RADIUS_CELLS = 3.6;
export const ANNIHILATION_HIGHEST_TRUE_RATIO = 0.2;
export const ANNIHILATION_OTHER_TRUE_RATIO = 0.05;
export const PARALLEL_RADIUS_CELLS = 2.8;
export const PARALLEL_DAMAGE_PER_TARGET = 8;
export const DARK_SPREAD_RADIUS_CELLS = 3;
export const SWEEP_VORTEX_TICKS = 3;
export const SWEEP_VORTEX_TICK_SECONDS = 0.45;
export const SWEEP_VORTEX_DAMAGE = 10;
export const EVAPORATE_DAMAGE = 12;
export const MELT_DAMAGE = 8;
export const REACTION_CHAIN_LIMIT = 10;
export const SPREAD_RADIUS_CELLS = 2;
export const REACTION_COOLDOWN = 0.15;

export function createStatus() {
  return {
    attachments: {
      fire: 0,
      ice: 0,
      lightning: 0,
      wind: 0,
      water: 0,
      light: 0,
      dark: 0
    },
    residuals: {
      fire: 0,
      ice: 0,
      lightning: 0,
      wind: 0,
      water: 0,
      light: 0,
      dark: 0
    },
    burnTimer: BURN_TICK_SECONDS,
    lightningTimer: LIGHTNING_TICK_SECONDS,
    windTimer: WIND_TICK_SECONDS,
    shock: null,
    scorch: null,
    drunken: false,
    stasis: false,
    spreadResistance: null,
    sweepResistanceApplied: false,
    reactionCooldown: 0,
    buffs: {}
  };
}

export function addBuff(entity, id, duration, stacks = 1, data = {}) {
  if (!entity.status) return null;
  const current = entity.status.buffs[id];
  entity.status.buffs[id] = {
    id,
    remaining: Math.max(duration, current ? current.remaining : 0),
    stacks: current ? Math.max(current.stacks, stacks) : stacks,
    data
  };
  return entity.status.buffs[id];
}

export function tickBuffs(entity, dt) {
  if (!entity.status) return;
  for (const id of Object.keys(entity.status.buffs)) {
    const buff = entity.status.buffs[id];
    buff.remaining -= dt;
    if (buff.remaining <= 0) delete entity.status.buffs[id];
  }
}

export function getBuff(entity, id) {
  return entity.status ? entity.status.buffs[id] || null : null;
}

export function addAttachment(enemy, element, amount = 1) {
  if (!enemy.status || !enemy.status.attachments) return 0;
  if (!(element in enemy.status.attachments) || amount <= 0) return 0;
  const current = enemy.status.attachments[element] || 0;
  const residual = enemy.status.residuals ? enemy.status.residuals[element] || 0 : 0;
  const raw = Math.min(MAX_ATTACHMENT, Math.max(0, current + residual + amount));
  const rounded = Math.round(raw * 10) / 10;
  enemy.status.attachments[element] = rounded;
  if (enemy.status.residuals) enemy.status.residuals[element] = raw - rounded;
  return rounded - current;
}

export function getAttachmentHalfLife(element) {
  return element === 'light' || element === 'dark' ? LIGHT_DARK_HALF_LIFE_SECONDS : HALF_LIFE_SECONDS;
}

export function decayStatus(enemy, dt) {
  if (!enemy.status) return;
  const lightLayers = enemy.status.attachments.light || 0;
  for (const element of Object.keys(enemy.status.attachments)) {
    if (lightLayers > 0 && element !== 'light') continue;
    const stored = enemy.status.attachments[element] || 0;
    const residual = enemy.status.residuals ? enemy.status.residuals[element] || 0 : 0;
    let raw = stored + residual;
    if (raw <= 0) {
      enemy.status.attachments[element] = 0;
      if (enemy.status.residuals) enemy.status.residuals[element] = 0;
      continue;
    }
    raw *= Math.pow(0.5, dt / getAttachmentHalfLife(element));
    if (raw < 0.05) raw = 0;
    const rounded = Math.min(MAX_ATTACHMENT, Math.round(raw * 10) / 10);
    enemy.status.attachments[element] = rounded;
    if (enemy.status.residuals) enemy.status.residuals[element] = raw - rounded;
  }
  if (enemy.status.spreadResistance) {
    enemy.status.spreadResistance.remaining -= dt;
    if (enemy.status.spreadResistance.remaining <= 0) enemy.status.spreadResistance = null;
  }
  if (enemy.status.reactionCooldown > 0) {
    enemy.status.reactionCooldown = Math.max(0, enemy.status.reactionCooldown - dt);
  }
}

export function roundAttachment(value) {
  return Math.round(value * 10) / 10;
}

export function getIceSlowFactor(enemy) {
  const layers = enemy.status ? enemy.status.attachments.ice : 0;
  if (layers <= 0) return 1;
  return Math.max(0.1, 1 - ICE_SLOW_PER_LAYER * layers);
}

export function getLightDamageMultiplier(enemy) {
  const layers = enemy.status ? enemy.status.attachments.light : 0;
  return 1 + LIGHT_DAMAGE_AMP_PER_LAYER * layers;
}

export function getLightResistanceDebuff(enemy, element) {
  if (!enemy.status || !element || element === 'none') return 0;
  if (!enemy.status.attachments.light || enemy.status.attachments.light <= 0) return 0;
  return -(enemy.status.attachments[element] || 0) * LIGHT_RESIST_REDUCTION_PER_LAYER;
}

export function applySpreadResistanceDebuff(enemy, element) {
  if (!enemy.status || !element || element === 'none') return;
  enemy.status.spreadResistance = {
    element,
    remaining: SPREAD_RESIST_DURATION
  };
}

export function getSpreadResistanceDebuff(enemy, element) {
  if (!enemy.status || !enemy.status.spreadResistance || !element || element === 'none') return 0;
  const debuff = enemy.status.spreadResistance;
  let value = 0;
  if (element === debuff.element) value -= SPREAD_RESIST_REDUCTION;
  if (element === 'wind') value -= SPREAD_WIND_RESIST_REDUCTION;
  return value;
}

export function applySweepResistanceDebuff(enemy) {
  if (!enemy.status || enemy.status.sweepResistanceApplied) return false;
  enemy.status.sweepResistanceApplied = true;
  return true;
}

export function getSweepResistanceDebuff(enemy) {
  return enemy.status && enemy.status.sweepResistanceApplied ? -SWEEP_RESIST_REDUCTION : 0;
}

export function getDarkReflectRatio(enemy) {
  const layers = enemy.status ? enemy.status.attachments.dark : 0;
  return DARK_REFLECT_PER_LAYER * layers;
}

export function getStasisMovementFactor(enemy) {
  return enemy.status && enemy.status.stasis ? STASIS_MOVE_FACTOR : 1;
}

export function getStasisAttackFactor(enemy) {
  return enemy.status && enemy.status.stasis ? STASIS_ATTACK_FACTOR : 1;
}

export function tickBurning(enemy, dt, damageCallback) {
  if (!enemy.status) return;
  const layers = enemy.status.attachments.fire;
  if (layers <= 0) {
    enemy.status.burnTimer = BURN_TICK_SECONDS;
    return;
  }
  enemy.status.burnTimer -= dt;
  let guard = 0;
  while (enemy.status.burnTimer <= 0 && guard++ < 4 && !enemy.dead) {
    enemy.status.burnTimer += BURN_TICK_SECONDS;
    damageCallback(enemy, BURN_DAMAGE_PER_LAYER * layers, {
      damageType: 'physical',
      element: 'fire',
      attach: 0,
      source: 'burning'
    });
  }
}

export function tickLightning(enemy, dt, damageCallback) {
  if (!enemy.status) return;
  const layers = enemy.status.attachments.lightning;
  if (layers <= 0) {
    enemy.status.lightningTimer = LIGHTNING_TICK_SECONDS;
    return;
  }
  enemy.status.lightningTimer -= dt;
  let guard = 0;
  while (enemy.status.lightningTimer <= 0 && guard++ < 4 && !enemy.dead) {
    enemy.status.lightningTimer += LIGHTNING_TICK_SECONDS;
    damageCallback(enemy, LIGHTNING_DAMAGE_PER_LAYER * layers, {
      damageType: 'physical',
      element: 'lightning',
      attach: 0,
      source: 'electrocution'
    });
  }
}

export function tickWind(enemy, dt, damageCallback) {
  if (!enemy.status) return;
  const layers = enemy.status.attachments.wind;
  if (layers <= 0) {
    enemy.status.windTimer = WIND_TICK_SECONDS;
    return;
  }
  enemy.status.windTimer -= dt;
  let guard = 0;
  while (enemy.status.windTimer <= 0 && guard++ < 3 && !enemy.dead) {
    enemy.status.windTimer += WIND_TICK_SECONDS;
    damageCallback(enemy, WIND_DAMAGE_PER_LAYER * layers, {
      damageType: 'physical',
      element: 'wind',
      attach: 0,
      source: 'weathering'
    }, WIND_RADIUS_CELLS);
  }
}

export function tickShock(enemy, dt, shockCallback) {
  if (!enemy.status || !enemy.status.shock) return;
  const shock = enemy.status.shock;
  shock.remaining -= dt;
  if (shock.remaining <= 0) {
    enemy.status.shock = null;
    return;
  }
  shock.tickTimer -= dt;
  let guard = 0;
  while (shock.tickTimer <= 0 && guard++ < 4 && !enemy.dead) {
    shock.tickTimer += SHOCK_TICK_SECONDS;
    shockCallback(enemy, shock);
  }
}

export function tickScorch(enemy, dt, damageCallback) {
  if (!enemy.status || !enemy.status.scorch) return;
  const scorch = enemy.status.scorch;
  scorch.tickTimer -= dt;
  let guard = 0;
  while (scorch.tickTimer <= 0 && guard++ < 4 && !enemy.dead) {
    scorch.tickTimer += SCORCH_TICK_SECONDS;
    damageCallback(enemy, SCORCH_DAMAGE_PER_TICK, {
      damageType: 'magic',
      element: 'fire',
      attach: 0,
      source: 'scorch',
      reaction: true
    }, SCORCH_RADIUS_CELLS);
  }
}

export function dominantElement(enemy) {
  if (!enemy.status) return null;
  let best = null;
  let bestValue = 0;
  for (const element of Object.keys(enemy.status.attachments)) {
    const value = enemy.status.attachments[element];
    if (value > bestValue) {
      bestValue = value;
      best = element;
    }
  }
  return best;
}

export function getVisibleAttachments(enemy) {
  if (!enemy.status) return [];
  const list = [];
  for (const element of Object.keys(enemy.status.attachments)) {
    const value = enemy.status.attachments[element];
    if (value > 0) list.push({ element, value: roundAttachment(value), color: ELEMENTS[element].color });
  }
  list.sort((a, b) => b.value - a.value);
  return list;
}

export function resolveReactions(enemy, spreadCallback) {
  if (!enemy.status || enemy.status.reactionCooldown > 0) return [];
  const attachments = enemy.status.attachments;
  const events = [];

  for (let i = 0; i < REACTION_CHAIN_LIMIT; i++) {
    if (attachments.light >= 1 && attachments.dark >= 1) {
      const light = attachments.light;
      const dark = attachments.dark;
      attachments.light = 0;
      attachments.dark = 0;
      events.push({
        type: 'annihilation',
        damage: Math.round(
          ANNIHILATION_BASE_DAMAGE + ANNIHILATION_DAMAGE_PER_LAYER * (light + dark)
        ),
        radius: ANNIHILATION_RADIUS_CELLS,
        highestTrueRatio: ANNIHILATION_HIGHEST_TRUE_RATIO,
        otherTrueRatio: ANNIHILATION_OTHER_TRUE_RATIO
      });
      continue;
    }

    if (attachments.dark >= 1 && attachments.fire >= 1 && !enemy.status.scorch) {
      attachments.dark -= 1;
      attachments.fire -= 1;
      enemy.status.scorch = { tickTimer: SCORCH_TICK_SECONDS };
      events.push({ type: 'scorch' });
      continue;
    }

    if (attachments.dark >= 1 && attachments.water >= 1 && !enemy.status.drunken) {
      attachments.dark -= 1;
      attachments.water -= 1;
      enemy.status.drunken = true;
      events.push({ type: 'drunken' });
      continue;
    }

    if (attachments.dark >= 1 && attachments.ice >= 1 && !enemy.status.stasis) {
      attachments.dark -= 1;
      attachments.ice -= 1;
      enemy.status.stasis = true;
      events.push({ type: 'stasis' });
      continue;
    }

    if (attachments.dark >= 1 && attachments.lightning >= 1) {
      attachments.dark -= 1;
      attachments.lightning -= 1;
      events.push({
        type: 'parallel',
        radius: PARALLEL_RADIUS_CELLS,
        perTarget: PARALLEL_DAMAGE_PER_TARGET
      });
      continue;
    }

    if (attachments.dark >= 1 && attachments.wind >= 1) {
      const debuffs = [];
      if (enemy.status.scorch) debuffs.push('scorch');
      if (enemy.status.drunken) debuffs.push('drunken');
      if (enemy.status.stasis) debuffs.push('stasis');
      if (debuffs.length > 0) {
        attachments.dark -= 1;
        attachments.wind -= 1;
        events.push({
          type: 'sweep',
          debuffs,
          radius: DARK_SPREAD_RADIUS_CELLS
        });
        continue;
      }
    }

    if (attachments.lightning >= 1 && attachments.ice >= 1) {
      const damage = estimatePhysicalDotBurst(enemy);
      attachments.lightning -= 1;
      attachments.ice -= 1;
      attachments.fire = 0;
      attachments.lightning = 0;
      attachments.wind = 0;
      enemy.status.shock = null;
      events.push({ type: 'superconduct', damage });
      continue;
    }

    if (attachments.fire >= 1 && attachments.ice >= 1) {
      attachments.fire -= 1;
      attachments.ice -= 1;
      addAttachment(enemy, 'water', 1);
      events.push({ type: 'melt', element: 'water', damage: MELT_DAMAGE });
      continue;
    }

    if (attachments.water >= 1 && attachments.ice >= 1) {
      attachments.water -= 1;
      attachments.ice -= 1;
      addAttachment(enemy, 'ice', 2);
      events.push({ type: 'condense', element: 'ice' });
      continue;
    }

    if (attachments.fire >= 1 && attachments.water >= 1) {
      attachments.fire -= 1;
      attachments.water -= 1;
      events.push({ type: 'evaporate', element: 'none', damage: EVAPORATE_DAMAGE });
      continue;
    }

    if (attachments.lightning >= 1 && attachments.water >= 1) {
      const lightning = attachments.lightning;
      const water = attachments.water;
      attachments.lightning = 0;
      attachments.water = 0;
      const stacks = Math.max(1, Math.round((lightning + water) / 2));
      const duration = 2 + stacks * 0.5;
      enemy.status.shock = {
        stacks,
        remaining: duration,
        tickTimer: SHOCK_TICK_SECONDS * 0.5
      };
      events.push({ type: 'shock', stacks, duration });
      continue;
    }

    if (attachments.lightning >= 1 && attachments.fire >= 1) {
      const lightning = attachments.lightning;
      const fire = attachments.fire;
      attachments.lightning = 0;
      attachments.fire = 0;
      events.push({
        type: 'overload',
        damage: Math.round(OVERLOAD_DAMAGE_PER_LAYER * (lightning + fire)),
        radius: 2.2
      });
      continue;
    }

    if (attachments.wind >= 1) {
      let target = null;
      let best = 0;
      for (const element of ['fire', 'ice', 'lightning', 'water', 'light', 'dark']) {
        if (attachments[element] >= 1 && attachments[element] > best) {
          best = attachments[element];
          target = element;
        }
      }
      if (target) {
        attachments.wind -= 1;
        attachments[target] -= 1;
        spreadCallback(enemy, target);
        events.push({ type: 'spread', element: target });
        continue;
      }
    }

    break;
  }

  if (events.length > 0) {
    enemy.status.reactionCooldown = REACTION_COOLDOWN;
  }
  return events;
}

function estimatePhysicalDotBurst(enemy) {
  const attachments = enemy.status.attachments;
  const shock = enemy.status.shock;
  const burn = (attachments.fire * BURN_DAMAGE_PER_LAYER / BURN_TICK_SECONDS) * 2.1;
  const electric = (attachments.lightning * LIGHTNING_DAMAGE_PER_LAYER / LIGHTNING_TICK_SECONDS) * 2.1;
  const wind = attachments.wind * WIND_DAMAGE_PER_LAYER * 2;
  const shockDamage = shock
    ? SHOCK_DAMAGE_BASE * (1 + shock.stacks) * Math.max(1, Math.floor(shock.remaining / SHOCK_TICK_SECONDS))
    : 0;
  return Math.round(
    SUPERCONDUCT_BASE_DAMAGE +
    (burn + electric + wind + shockDamage) * SUPERCONDUCT_DOT_MULTIPLIER
  );
}
