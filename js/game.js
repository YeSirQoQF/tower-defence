import * as THREE from 'three';
import {
  TILE,
  TILE_SIZE,
  TOWER_TYPES,
  ENEMY_TYPES,
  ECONOMY,
  DIFFICULTIES,
  MODES,
  ELEMENTS
} from './config.js';
import { generateMap } from './mapgen.js';
import { generateGiantMap } from './giantmap.js';
import { createWave, generateWaves, waveTotals, waveSummary } from './waves.js';
import { makeRng, randomSeed } from './rng.js';
import { renderMarkdown } from './markdown.js';
import { buildPathGraph, findRoute } from './systems/pathfinding.js';
import { createResistances, getResistanceMultiplier } from './systems/resistance.js';
import {
  baseTowerStats,
  resolvePulseStats,
  resolveSupplyStats,
  resolveCannonStats,
  resolveMagicStats,
  resolveCoinStats,
  CANNON_UPGRADE,
  MAGIC_UPGRADE,
  COIN_UPGRADE,
  PULSE_UPGRADE,
  SUPPLY_UPGRADE,
  pulseUpgradeCost,
  supplyUpgradeCost,
  cannonUpgradeCost,
  magicUpgradeCost,
  coinUpgradeCost
} from './systems/towers.js';
import {
  addAttachment,
  createStatus,
  decayStatus,
  dominantElement,
  applySpreadResistanceDebuff,
  applySweepResistanceDebuff,
  getDarkReflectRatio,
  getIceSlowFactor,
  getLightDamageMultiplier,
  getLightResistanceDebuff,
  getSweepResistanceDebuff,
  getSpreadResistanceDebuff,
  ICE_SLOW_PER_LAYER,
  getStasisAttackFactor,
  getStasisMovementFactor,
  getVisibleAttachments,
  resolveReactions,
  SCORCH_TICK_SECONDS,
  SHOCK_DAMAGE_BASE,
  SPREAD_RADIUS_CELLS,
  SWEEP_VORTEX_DAMAGE,
  SWEEP_VORTEX_TICKS,
  SWEEP_VORTEX_TICK_SECONDS,
  tickBuffs,
  tickBurning,
  tickLightning,
  tickScorch,
  tickShock,
  tickWind
} from './systems/status.js';

const STEP = 1 / 60;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const barGeometry = new THREE.PlaneGeometry(1, 1);
const barBackgroundMaterial = new THREE.MeshBasicMaterial({
  color: 0x05080f,
  transparent: true,
  opacity: 0.8,
  depthWrite: false
});
const enemyGeometryCache = new Map();

function dampAngle(current, target, amount) {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * Math.min(1, amount);
}

function colorHex(value) {
  return `#${value.toString(16).padStart(6, '0')}`;
}

function makeNoiseTexture(size, base, spots, count, rng) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  context.fillStyle = base;
  context.fillRect(0, 0, size, size);

  for (let i = 0; i < count; i++) {
    context.fillStyle = spots[Math.floor(rng() * spots.length)];
    const width = 1 + Math.floor(rng() * 3);
    const height = 1 + Math.floor(rng() * 3);
    context.fillRect(Math.floor(rng() * size), Math.floor(rng() * size), width, height);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function makeTowerModel(type) {
  const group = new THREE.Group();
  const baseMaterial = new THREE.MeshStandardMaterial({
    color: 0x172038,
    roughness: 0.65,
    metalness: 0.45,
    flatShading: true
  });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.72, 0.3, 8), baseMaterial);
  base.position.y = 0.15;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.58, 0.045, 6, 24),
    new THREE.MeshBasicMaterial({ color: type.color, transparent: true, opacity: 0.85 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.32;
  group.add(ring);

  const head = new THREE.Group();
  head.position.y = 0.45;
  group.add(head);

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: type.color,
    emissive: type.accent,
    emissiveIntensity: 0.25,
    roughness: 0.4,
    metalness: 0.4,
    flatShading: true
  });
  const darkMaterial = new THREE.MeshStandardMaterial({
    color: 0x27324d,
    roughness: 0.55,
    metalness: 0.55,
    flatShading: true
  });

  if (type.id === 'gun') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.34, 0.58), bodyMaterial);
    body.position.y = 0.18;
    body.castShadow = true;
    head.add(body);
    for (const side of [-1, 1]) {
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.9), darkMaterial);
      barrel.position.set(side * 0.15, 0.24, 0.55);
      barrel.castShadow = true;
      head.add(barrel);
    }
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.16), bodyMaterial);
    sight.position.set(0, 0.4, 0.05);
    head.add(sight);
  } else if (type.id === 'cannon') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.42, 0.66), bodyMaterial);
    body.position.y = 0.2;
    body.castShadow = true;
    head.add(body);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.05, 10), darkMaterial);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.3, 0.62);
    barrel.castShadow = true;
    head.add(barrel);
    const muzzle = new THREE.Mesh(
      new THREE.TorusGeometry(0.18, 0.04, 6, 16),
      new THREE.MeshBasicMaterial({ color: type.color })
    );
    muzzle.position.set(0, 0.3, 1.16);
    head.add(muzzle);
  } else if (type.id === 'frost') {
    const crystalMaterial = new THREE.MeshStandardMaterial({
      color: 0x67e8f9,
      emissive: type.color,
      emissiveIntensity: 1.2,
      roughness: 0.15,
      metalness: 0.1,
      transparent: true,
      opacity: 0.92,
      flatShading: true
    });
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.36, 0), crystalMaterial);
    crystal.position.y = 0.45;
    crystal.scale.y = 1.4;
    crystal.castShadow = true;
    head.add(crystal);
    for (let i = 0; i < 3; i++) {
      const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), crystalMaterial);
      const angle = (i / 3) * Math.PI * 2;
      shard.position.set(Math.cos(angle) * 0.38, 0.25, Math.sin(angle) * 0.38);
      head.add(shard);
    }
    const collar = new THREE.Mesh(
      new THREE.TorusGeometry(0.4, 0.05, 6, 20),
      new THREE.MeshBasicMaterial({ color: type.color, transparent: true, opacity: 0.6 })
    );
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.12;
    head.add(collar);
  } else if (type.id === 'burn') {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.44, 0.5, 8), darkMaterial);
    body.position.y = 0.25;
    body.castShadow = true;
    head.add(body);

    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.2, 0.22, 8), bodyMaterial);
    bowl.position.y = 0.52;
    bowl.castShadow = true;
    head.add(bowl);

    const flameMaterial = new THREE.MeshStandardMaterial({
      color: 0xffb45e,
      emissive: 0xff4d00,
      emissiveIntensity: 2,
      roughness: 0.25,
      metalness: 0,
      flatShading: true
    });
    const flame = new THREE.Mesh(new THREE.IcosahedronGeometry(0.25, 0), flameMaterial);
    flame.position.y = 0.74;
    flame.scale.y = 1.45;
    flame.castShadow = true;
    head.add(flame);

    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), new THREE.MeshBasicMaterial({ color: 0xfff1b8 }));
    core.position.y = 0.72;
    head.add(core);

    const emberRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.34, 0.04, 6, 18),
      new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.8 })
    );
    emberRing.rotation.x = Math.PI / 2;
    emberRing.position.y = 0.44;
    head.add(emberRing);
  } else if (type.id === 'supply') {
    const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.28, 1.0, 6), darkMaterial);
    pylon.position.y = 0.5;
    pylon.castShadow = true;
    head.add(pylon);

    const crystalMaterial = new THREE.MeshStandardMaterial({
      color: 0x6ee7b7,
      emissive: type.color,
      emissiveIntensity: 1.5,
      roughness: 0.2,
      metalness: 0.1,
      transparent: true,
      opacity: 0.92,
      flatShading: true
    });
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), crystalMaterial);
    crystal.position.y = 1.18;
    crystal.scale.y = 1.4;
    crystal.castShadow = true;
    head.add(crystal);

    for (let i = 0; i < 3; i++) {
      const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), crystalMaterial);
      const angle = (i / 3) * Math.PI * 2;
      shard.position.set(Math.cos(angle) * 0.4, 0.72, Math.sin(angle) * 0.4);
      head.add(shard);
    }

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.04, 6, 20),
      new THREE.MeshBasicMaterial({ color: type.color, transparent: true, opacity: 0.7 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.38;
    head.add(ring);
  } else if (type.id === 'surge') {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 0.46, 8), darkMaterial);
    body.position.y = 0.23;
    body.castShadow = true;
    head.add(body);

    const coil = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.8, 8), bodyMaterial);
    coil.position.y = 0.78;
    coil.castShadow = true;
    head.add(coil);

    const orbMaterial = new THREE.MeshStandardMaterial({
      color: 0xfef08a,
      emissive: type.color,
      emissiveIntensity: 2,
      roughness: 0.2,
      metalness: 0,
      flatShading: true
    });
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), orbMaterial);
    orb.position.y = 1.24;
    orb.castShadow = true;
    head.add(orb);

    for (const y of [0.62, 0.86]) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.26, 0.035, 6, 18),
        new THREE.MeshBasicMaterial({ color: type.color, transparent: true, opacity: 0.8 })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      head.add(ring);
    }
  } else if (type.id === 'water') {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.5, 0.44, 8), darkMaterial);
    body.position.y = 0.22;
    body.castShadow = true;
    head.add(body);
    const orbMaterial = new THREE.MeshStandardMaterial({
      color: 0x93c5fd,
      emissive: type.color,
      emissiveIntensity: 1.4,
      roughness: 0.15,
      metalness: 0.1,
      transparent: true,
      opacity: 0.9,
      flatShading: true
    });
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 1), orbMaterial);
    orb.position.y = 0.68;
    orb.castShadow = true;
    head.add(orb);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.4, 0.045, 6, 22),
      new THREE.MeshBasicMaterial({ color: type.color, transparent: true, opacity: 0.7 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.45;
    head.add(ring);
  } else if (type.id === 'light') {
    const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.24, 0.9, 6), darkMaterial);
    pylon.position.y = 0.45;
    pylon.castShadow = true;
    head.add(pylon);
    const crystalMaterial = new THREE.MeshStandardMaterial({
      color: 0xfff7cc,
      emissive: type.color,
      emissiveIntensity: 2,
      roughness: 0.12,
      metalness: 0.15,
      transparent: true,
      opacity: 0.95,
      flatShading: true
    });
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), crystalMaterial);
    crystal.position.y = 1.12;
    crystal.scale.y = 1.35;
    crystal.castShadow = true;
    head.add(crystal);
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.46, 0.035, 6, 24),
      new THREE.MeshBasicMaterial({ color: type.color, transparent: true, opacity: 0.85 })
    );
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 0.94;
    head.add(halo);
  } else if (type.id === 'dark') {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 0.5, 6), darkMaterial);
    body.position.y = 0.25;
    body.castShadow = true;
    head.add(body);
    const orbMaterial = new THREE.MeshStandardMaterial({
      color: 0x581c87,
      emissive: type.color,
      emissiveIntensity: 1.8,
      roughness: 0.2,
      metalness: 0.25,
      transparent: true,
      opacity: 0.95,
      flatShading: true
    });
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), orbMaterial);
    orb.position.y = 0.82;
    orb.castShadow = true;
    head.add(orb);
    for (let i = 0; i < 3; i++) {
      const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), orbMaterial);
      const angle = (i / 3) * Math.PI * 2;
      shard.position.set(Math.cos(angle) * 0.42, 0.62, Math.sin(angle) * 0.42);
      head.add(shard);
    }
  } else if (type.id === 'magic') {
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.5, 0.36, 8), darkMaterial);
    pedestal.position.y = 0.18;
    pedestal.castShadow = true;
    head.add(pedestal);
    const orbColors = [0x67e8f9, 0xfef08a, 0xa855f7];
    for (let i = 0; i < 3; i++) {
      const orb = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.16, 0),
        new THREE.MeshStandardMaterial({
          color: orbColors[i],
          emissive: orbColors[i],
          emissiveIntensity: 1.6,
          roughness: 0.2,
          metalness: 0.1,
          flatShading: true
        })
      );
      const angle = (i / 3) * Math.PI * 2;
      orb.position.set(Math.cos(angle) * 0.36, 0.72 + Math.sin(angle) * 0.1, Math.sin(angle) * 0.36);
      orb.castShadow = true;
      head.add(orb);
    }
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.46, 0.035, 6, 24),
      new THREE.MeshBasicMaterial({ color: type.color, transparent: true, opacity: 0.8 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.28;
    head.add(ring);
  } else if (type.id === 'coin') {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.4, 0.36, 8), darkMaterial);
    body.position.y = 0.18;
    body.castShadow = true;
    head.add(body);
    const coinMaterial = new THREE.MeshStandardMaterial({
      color: 0xfef08a,
      emissive: type.color,
      emissiveIntensity: 1.8,
      roughness: 0.2,
      metalness: 0.85,
      flatShading: true
    });
    const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.09, 24), coinMaterial);
    coin.rotation.z = Math.PI / 2;
    coin.position.y = 0.92;
    coin.castShadow = true;
    head.add(coin);
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.35, 0.035, 6, 24),
      new THREE.MeshBasicMaterial({ color: type.color, transparent: true, opacity: 0.85 })
    );
    rim.rotation.y = Math.PI / 2;
    rim.position.y = 0.92;
    head.add(rim);
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.025, 6, 24),
      new THREE.MeshBasicMaterial({ color: type.color, transparent: true, opacity: 0.45 })
    );
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 0.42;
    head.add(halo);
  } else if (type.id === 'cursed') {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.48, 0.5, 6), darkMaterial);
    body.position.y = 0.25;
    body.castShadow = true;
    head.add(body);
    const coreMaterial = new THREE.MeshStandardMaterial({
      color: 0x4c1d95,
      emissive: type.color,
      emissiveIntensity: 1.7,
      roughness: 0.2,
      metalness: 0.3,
      flatShading: true
    });
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), coreMaterial);
    core.position.y = 0.82;
    core.castShadow = true;
    head.add(core);
    for (let i = 0; i < 4; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.42, 4), coreMaterial);
      const angle = (i / 4) * Math.PI * 2;
      spike.position.set(Math.cos(angle) * 0.38, 0.74, Math.sin(angle) * 0.38);
      spike.rotation.z = Math.PI / 2;
      spike.rotation.y = angle;
      head.add(spike);
    }
  } else {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.44, 0.5, 8), darkMaterial);
    body.position.y = 0.25;
    body.castShadow = true;
    head.add(body);

    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.5, 8), bodyMaterial);
    hub.rotation.x = Math.PI / 2;
    hub.position.set(0, 0.7, 0.2);
    hub.castShadow = true;
    head.add(hub);

    const bladeMaterial = new THREE.MeshStandardMaterial({
      color: 0xbbf7d0,
      emissive: type.color,
      emissiveIntensity: 0.7,
      roughness: 0.6,
      flatShading: true
    });
    for (let i = 0; i < 3; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.62, 0.06), bladeMaterial);
      blade.position.set(
        Math.cos((i / 3) * Math.PI * 2) * 0.32,
        0.7 + Math.sin((i / 3) * Math.PI * 2) * 0.32,
        0.4
      );
      blade.rotation.z = (i / 3) * Math.PI * 2;
      blade.castShadow = true;
      head.add(blade);
    }

    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.16, 0),
      new THREE.MeshBasicMaterial({ color: 0xd9f99d })
    );
    core.position.set(0, 0.7, 0.26);
    head.add(core);
  }

  group.userData.head = head;
  return group;
}

function enemyBodyGeometry(type) {
  if (enemyGeometryCache.has(type.id)) return enemyGeometryCache.get(type.id);
  let geometry;
  if (type.id === 'grunt') {
    geometry = new THREE.CapsuleGeometry(type.size * 0.34, type.size * 0.42, 4, 8);
  } else if (type.id === 'runner') {
    geometry = new THREE.OctahedronGeometry(type.size * 0.56, 0);
  } else if (type.id === 'tank') {
    geometry = new THREE.BoxGeometry(type.size, type.height * 0.82, type.size);
  } else if (type.id === 'bombardier') {
    geometry = new THREE.CapsuleGeometry(type.size * 0.36, type.size * 0.5, 4, 8);
  } else if (type.id === 'flyer') {
    geometry = new THREE.ConeGeometry(type.size * 0.48, type.height, 6);
  } else {
    geometry = new THREE.IcosahedronGeometry(type.size * 0.56, 0);
  }
  enemyGeometryCache.set(type.id, geometry);
  return geometry;
}

function makeEnemyModel(type) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: type.color,
    emissive: type.accent,
    emissiveIntensity: 0.35,
    roughness: 0.5,
    metalness: 0.15,
    flatShading: true
  });
  const body = new THREE.Mesh(enemyBodyGeometry(type), material);
  body.position.y = type.height * 0.5;
  body.castShadow = true;
  group.add(body);

  if (type.id === 'tank') {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(type.size * 0.7, type.height * 0.3, type.size * 0.7), material);
    plate.position.y = type.height * 0.75;
    plate.castShadow = true;
    group.add(plate);
  }

  if (type.id === 'elite') {
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(type.size * 0.22, 0),
      new THREE.MeshBasicMaterial({ color: 0xfdf4ff })
    );
    core.position.y = type.height * 0.55;
    group.add(core);
  }

  if (type.id === 'bombardier') {
    const pack = new THREE.Mesh(
      new THREE.BoxGeometry(type.size * 0.65, type.height * 0.42, type.size * 0.4),
      new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.7, metalness: 0.35 })
    );
    pack.position.set(0, type.height * 0.75, -0.16);
    pack.castShadow = true;
    group.add(pack);
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(type.size * 0.12, type.size * 0.17, type.size * 0.75, 8),
      material
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, type.height * 0.65, type.size * 0.5);
    group.add(barrel);
  }

  if (type.id === 'flyer') {
    const wingMaterial = new THREE.MeshBasicMaterial({
      color: 0xbfdbfe,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide
    });
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(type.size * 1.4, 0.04, type.size * 0.55), wingMaterial);
      wing.position.set(side * type.size * 0.62, type.height * 0.55, 0);
      wing.rotation.z = side * 0.22;
      group.add(wing);
    }
  }

  group.userData.body = body;
  return { group, material, body };
}

export class Game {
  constructor({ seed, difficulty, mode = 'regular' }) {
    this.seed = seed;
    this.difficulty = DIFFICULTIES[difficulty] ? difficulty : 'normal';
    this.diff = DIFFICULTIES[this.difficulty];
    this.mode = MODES[mode] ? mode : 'regular';
    this.modeConfig = MODES[this.mode];
    this.map = this.modeConfig.giant
      ? generateGiantMap(seed, this.difficulty)
      : generateMap(seed, this.difficulty);
    this.waves = this.modeConfig.endless ? [] : generateWaves(seed, this.difficulty);
    if (this.modeConfig.endless) {
      this.ensureWave(0);
      this.ensureWave(1);
    }
    this.rng = makeRng(`enemies|${seed}|${this.difficulty}`);

    this.waveIndex = 0;
    this.phase = 'build';
    this.gold = this.diff.startGold;
    this.maxLives = this.diff.lives;
    this.lives = this.diff.lives;
    this.repairCount = 0;
    this.repairCooldown = 0;
    this.repairHpMultiplier = 1;
    this.score = 0;
    this.kills = 0;
    this.built = 0;
    this.speed = 1;
    this.paused = false;
    this.selectedTowerType = 'gun';
    this.selectedTower = null;
    this.towerPanelTower = null;
    this.towerPanelHtml = '';
    this.magicCasts = [];
    this.enemyBombs = [];
    this.sweepVortices = [];
    this.helpOpen = false;
    this.helpReadmeLoaded = false;
    this.helpReadmeLoading = false;
    this.prepRemaining = Infinity;
    this.prepTotal = Infinity;
    this.announcedStrongholds = new Set();
    if (this.map.strongholds) {
      for (const stronghold of this.map.strongholds) {
        if (stronghold.unlockWave <= 1) this.announcedStrongholds.add(stronghold);
      }
    }
    this.bestKey = `td-best-${this.mode}-${this.difficulty}`;
    this.bestScore = 0;
    try {
      this.bestScore = Number(localStorage.getItem(this.bestKey) || 0);
    } catch {
      this.bestScore = 0;
    }

    this.towers = [];
    this.towerGrid = new Map();
    this.enemies = [];
    this.deadEnemies = [];
    this.spawnQueue = [];
    this.waveClock = 0;
    this.waveStates = new Map();
    this.hudTimer = 0;

    this.accumulator = 0;
    this.lastTime = performance.now();
    this.visualClock = 0;
    this.pointer = new THREE.Vector2(-2, -2);
    this.hoverCell = null;
    this.tracers = [];
    this.effects = [];
    this.reactionQueue = new Set();
    this.keys = new Set();

    this.orbit = {
      theta: 0,
      elevation: THREE.MathUtils.degToRad(56),
      zoom: 1,
      targetX: 0,
      targetZ: this.modeConfig.giant ? 0 : 2.4,
      panning: false,
      lastX: 0,
      lastY: 0
    };

    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.tmpPoint = new THREE.Vector3();
    this.tmpPos = new THREE.Vector3();
    this.tmpDir = new THREE.Vector3();
    this.tmpA = new THREE.Vector3();
    this.tmpB = new THREE.Vector3();

    this.initScene();
    this.initMap();
    this.pathGraph = buildPathGraph(this.map.tiles, this.map.W, this.map.H, this.map.goal);
    this.initPools();
    this.initGhost();
    this.initHud();
    this.updateHud();
    this.updateCamera();

    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  initScene() {
    this.container = document.getElementById('app');
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.28;
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07160e);
    this.scene.fog = new THREE.Fog(0x07160e, 80, 220);

    this.camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.5, 600);

    const hemi = new THREE.HemisphereLight(0xb6d4ff, 0x2c4a33, 1.75);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffe6c2, 3.1);
    const span = Math.max(this.map.W, this.map.H) * TILE_SIZE;
    sun.position.set(-span * 0.55, span * 1.15, span * 0.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -span * 0.72;
    sun.shadow.camera.right = span * 0.72;
    sun.shadow.camera.top = span * 0.72;
    sun.shadow.camera.bottom = -span * 0.72;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = span * 3.2;
    sun.shadow.bias = -0.0006;
    this.scene.add(sun);

    const fill = new THREE.DirectionalLight(0x4c7fbf, 0.4);
    fill.position.set(span * 0.7, span * 0.5, -span * 0.6);
    this.scene.add(fill);

    window.addEventListener('resize', () => this.onResize());
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointermove', (event) => this.onPointerMove(event));
    canvas.addEventListener('pointerleave', () => this.hideGhost());
    canvas.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    canvas.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });
    document.addEventListener('contextmenu', (event) => event.preventDefault(), { capture: true });
    canvas.addEventListener('auxclick', (event) => {
      if (event.button === 1) event.preventDefault();
    });
    window.addEventListener('keydown', (event) => this.onKeyDown(event));
    window.addEventListener('keyup', (event) => this.keys.delete(event.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  cellToWorld(x, y, target = new THREE.Vector3()) {
    const { W, H } = this.map;
    target.set((x - (W - 1) / 2) * TILE_SIZE, 0, ((H - 1) / 2 - y) * TILE_SIZE);
    return target;
  }

  cellFromWorld(point) {
    const { W, H } = this.map;
    const x = Math.round(point.x / TILE_SIZE + (W - 1) / 2);
    const y = Math.round((H - 1) / 2 - point.z / TILE_SIZE);
    if (x < 0 || y < 0 || x >= W || y >= H) return null;
    return { x, y };
  }

  tileAt(x, y) {
    return this.map.tiles[y * this.map.W + x];
  }

  isBuildable(x, y) {
    if (x < 0 || y < 0 || x >= this.map.W || y >= this.map.H) return false;
    return this.tileAt(x, y) === TILE.EMPTY && !this.towerGrid.has(`${x},${y}`);
  }

  towerAt(x, y) {
    return this.towerGrid.get(`${x},${y}`) || null;
  }

  initMap() {
    const { W, H, tiles, goal } = this.map;
    const grassTiles = [];
    const pathTiles = [];

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const tile = tiles[y * W + x];
        if (tile === TILE.PATH) pathTiles.push({ x, y });
        else grassTiles.push({ x, y });
      }
    }

    const vrng = makeRng(`decor|${this.seed}|${this.difficulty}`);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    const grassTexture = makeNoiseTexture(
      128,
      '#ffffff',
      ['#e2e2e2', '#f5f5f5', '#cfcfcf', '#eaeaea'],
      2600,
      vrng
    );
    const grassGeometry = new THREE.BoxGeometry(TILE_SIZE * 0.97, 0.22, TILE_SIZE * 0.97);
    const grassMaterial = new THREE.MeshStandardMaterial({
      map: grassTexture,
      color: 0xffffff,
      roughness: 1,
      metalness: 0
    });
    const grassMesh = new THREE.InstancedMesh(grassGeometry, grassMaterial, grassTiles.length);
    grassMesh.receiveShadow = true;
    const grassColors = [0x3a744a, 0x397248, 0x3d784d, 0x377045, 0x3f7a50];
    grassTiles.forEach((cell, i) => {
      const pos = this.cellToWorld(cell.x, cell.y);
      dummy.position.set(pos.x, -0.07, pos.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      grassMesh.setMatrixAt(i, dummy.matrix);
      grassMesh.setColorAt(i, color.setHex(grassColors[Math.floor(vrng() * grassColors.length)]));
    });
    if (grassMesh.instanceColor) grassMesh.instanceColor.needsUpdate = true;
    this.scene.add(grassMesh);

    const pathTexture = makeNoiseTexture(
      128,
      '#ffffff',
      ['#c7c7c7', '#dedede', '#b0b0b0', '#d4d4d4'],
      2200,
      vrng
    );
    const pathGeometry = new THREE.BoxGeometry(TILE_SIZE * 0.9, 0.16, TILE_SIZE * 0.9);
    const pathMaterial = new THREE.MeshStandardMaterial({
      map: pathTexture,
      color: 0xffffff,
      roughness: 0.95,
      metalness: 0.05
    });
    const pathMesh = new THREE.InstancedMesh(pathGeometry, pathMaterial, pathTiles.length);
    pathMesh.receiveShadow = true;
    const pathColors = [0x767f8c, 0x737c89, 0x79838f, 0x747e8b];
    pathTiles.forEach((cell, i) => {
      const pos = this.cellToWorld(cell.x, cell.y);
      dummy.position.set(pos.x, 0.01, pos.z);
      dummy.updateMatrix();
      pathMesh.setMatrixAt(i, dummy.matrix);
      pathMesh.setColorAt(i, color.setHex(pathColors[Math.floor(vrng() * pathColors.length)]));
    });
    if (pathMesh.instanceColor) pathMesh.instanceColor.needsUpdate = true;
    this.scene.add(pathMesh);

    const curbGeometry = new THREE.BoxGeometry(TILE_SIZE * 0.99, 0.12, TILE_SIZE * 0.99);
    const curbMaterial = new THREE.MeshStandardMaterial({ color: 0x3a414a, roughness: 1 });
    const curbMesh = new THREE.InstancedMesh(curbGeometry, curbMaterial, pathTiles.length);
    curbMesh.receiveShadow = true;
    pathTiles.forEach((cell, i) => {
      const pos = this.cellToWorld(cell.x, cell.y);
      dummy.position.set(pos.x, -0.005, pos.z);
      dummy.updateMatrix();
      curbMesh.setMatrixAt(i, dummy.matrix);
    });
    this.scene.add(curbMesh);

    const baseTop = -0.18;
    const groundTexture = makeNoiseTexture(
      256,
      '#ffffff',
      ['#e5e5e5', '#cfcfcf', '#f2f2f2', '#dddddd'],
      5200,
      vrng
    );
    groundTexture.repeat.set(100, 100);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2000, 2000),
      new THREE.MeshStandardMaterial({
        map: groundTexture,
        color: 0x1f4228,
        roughness: 1
      })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = baseTop;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const rockCells = [];
    const treeCells = [];
    for (const rock of this.map.rocks) {
      if (vrng() < 0.6) treeCells.push({ cell: rock, baseY: 0.04 });
      else rockCells.push({ cell: rock, baseY: 0.04 });
    }

    const treePositions = treeCells.map((entry) => {
      const pos = this.cellToWorld(entry.cell.x, entry.cell.y);
      return { x: pos.x, z: pos.z, baseY: entry.baseY };
    });
    const rockPositions = rockCells.map((entry) => {
      const pos = this.cellToWorld(entry.cell.x, entry.cell.y);
      return { x: pos.x, z: pos.z, baseY: entry.baseY };
    });

    const halfW = (W * TILE_SIZE) / 2 + 2;
    const halfD = (H * TILE_SIZE) / 2 + 2;
    for (let i = 0; i < 24; i++) {
      const side = Math.floor(vrng() * 4);
      const alongX = (vrng() - 0.5) * (W * TILE_SIZE + 24);
      const alongZ = (vrng() - 0.5) * (H * TILE_SIZE + 24);
      const offset = 2.5 + vrng() * 7;
      let x;
      let z;
      if (side === 0) {
        x = alongX;
        z = -halfD - offset;
      } else if (side === 1) {
        x = alongX;
        z = halfD + offset;
      } else if (side === 2) {
        x = -halfW - offset;
        z = alongZ;
      } else {
        x = halfW + offset;
        z = alongZ;
      }
      if (vrng() < 0.38) rockPositions.push({ x, z, baseY: baseTop });
      else treePositions.push({ x, z, baseY: baseTop });
    }

    const trunkGeometry = new THREE.CylinderGeometry(0.13, 0.22, 1, 5);
    const trunkMaterial = new THREE.MeshStandardMaterial({
      color: 0x6a462c,
      roughness: 1,
      flatShading: true
    });
    const trunkMesh = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, treePositions.length);
    trunkMesh.castShadow = true;
    trunkMesh.receiveShadow = true;

    const crownGeometry = new THREE.ConeGeometry(0.92, 1.8, 7);
    const crownMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.95,
      flatShading: true
    });
    const crownMesh = new THREE.InstancedMesh(crownGeometry, crownMaterial, treePositions.length);
    crownMesh.castShadow = true;
    crownMesh.receiveShadow = true;
    const crownColors = [0x3a8f4d, 0x469e5b, 0x338248, 0x4aa361];
    treePositions.forEach((tree, i) => {
      const scale = 0.9 + vrng() * 0.75;
      dummy.position.set(tree.x, tree.baseY + scale * 0.5, tree.z);
      dummy.rotation.set(0, vrng() * Math.PI * 2, 0);
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      trunkMesh.setMatrixAt(i, dummy.matrix);

      dummy.position.set(tree.x, tree.baseY + scale * 1.9, tree.z);
      dummy.rotation.set(0, vrng() * Math.PI * 2, 0);
      dummy.scale.set(scale * 0.88, scale, scale * 0.88);
      dummy.updateMatrix();
      crownMesh.setMatrixAt(i, dummy.matrix);
      crownMesh.setColorAt(i, color.setHex(crownColors[Math.floor(vrng() * crownColors.length)]));
    });
    if (crownMesh.instanceColor) crownMesh.instanceColor.needsUpdate = true;
    this.scene.add(trunkMesh);
    this.scene.add(crownMesh);

    const rockGeometry = new THREE.DodecahedronGeometry(0.5, 0);
    const rockMaterial = new THREE.MeshStandardMaterial({
      color: 0x55606c,
      roughness: 0.95,
      metalness: 0.08,
      flatShading: true
    });
    const rockMesh = new THREE.InstancedMesh(rockGeometry, rockMaterial, rockPositions.length);
    rockMesh.castShadow = true;
    rockMesh.receiveShadow = true;
    rockPositions.forEach((rock, i) => {
      dummy.position.set(rock.x, rock.baseY + 0.3, rock.z);
      dummy.rotation.set(vrng() * Math.PI, vrng() * Math.PI, vrng() * Math.PI);
      dummy.scale.set(0.7 + vrng() * 0.8, 0.5 + vrng() * 0.6, 0.7 + vrng() * 0.8);
      dummy.updateMatrix();
      rockMesh.setMatrixAt(i, dummy.matrix);
    });
    this.scene.add(rockMesh);

    const emptyGrass = grassTiles.filter((cell) => tiles[cell.y * W + cell.x] === TILE.EMPTY);
    const flowerGeometry = new THREE.IcosahedronGeometry(1, 0);
    const flowerMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const flowerCount = 120;
    const flowerMesh = new THREE.InstancedMesh(flowerGeometry, flowerMaterial, flowerCount);
    const flowerColors = [0xfef3c7, 0xfde047, 0xf9a8d4, 0xfca5a5, 0xffffff];
    const anchors = treePositions.concat(rockPositions);
    for (let i = 0; i < flowerCount; i++) {
      let x;
      let y;
      let z;
      if (vrng() < 0.55 || !anchors.length) {
        const anchor = anchors[Math.floor(vrng() * anchors.length)] || { x: 0, z: 0, baseY: baseTop };
        x = anchor.x + (vrng() - 0.5) * 1.8;
        z = anchor.z + (vrng() - 0.5) * 1.8;
        y = anchor.baseY + 0.04 + vrng() * 0.04;
      } else {
        const cell = emptyGrass[Math.floor(vrng() * emptyGrass.length)];
        const pos = this.cellToWorld(cell.x, cell.y);
        x = pos.x + (vrng() - 0.5) * 1.3;
        z = pos.z + (vrng() - 0.5) * 1.3;
        y = 0.05 + vrng() * 0.03;
      }
      const scale = 0.045 + vrng() * 0.05;
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, vrng() * Math.PI * 2, 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      flowerMesh.setMatrixAt(i, dummy.matrix);
      flowerMesh.setColorAt(i, color.setHex(flowerColors[Math.floor(vrng() * flowerColors.length)]));
    }
    if (flowerMesh.instanceColor) flowerMesh.instanceColor.needsUpdate = true;
    this.scene.add(flowerMesh);

    const tuftGeometry = new THREE.ConeGeometry(0.1, 0.42, 4, 1, true);
    const tuftMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a8a4f,
      roughness: 1,
      flatShading: true,
      side: THREE.DoubleSide
    });
    const tuftCount = 520;
    const tuftMesh = new THREE.InstancedMesh(tuftGeometry, tuftMaterial, tuftCount);
    tuftMesh.receiveShadow = true;
    for (let i = 0; i < tuftCount; i++) {
      let x;
      let y;
      let z;
      let scale;
      if (i < 260) {
        const side = Math.floor(vrng() * 4);
        const alongX = (vrng() - 0.5) * (W * TILE_SIZE + 16);
        const alongZ = (vrng() - 0.5) * (H * TILE_SIZE + 16);
        const offset = 0.5 + vrng() * 8;
        if (side === 0) {
          x = alongX;
          z = -halfD - offset * 0.5;
        } else if (side === 1) {
          x = alongX;
          z = halfD + offset * 0.5;
        } else if (side === 2) {
          x = -halfW - offset * 0.5;
          z = alongZ;
        } else {
          x = halfW + offset * 0.5;
          z = alongZ;
        }
        y = baseTop;
        scale = 0.6 + vrng() * 1.1;
      } else {
        const cell = emptyGrass[Math.floor(vrng() * emptyGrass.length)];
        const pos = this.cellToWorld(cell.x, cell.y);
        x = pos.x + (vrng() - 0.5) * 1.25;
        z = pos.z + (vrng() - 0.5) * 1.25;
        y = 0.04;
        scale = 0.35 + vrng() * 0.45;
      }
      dummy.position.set(x, y + scale * 0.21, z);
      dummy.rotation.set(0, vrng() * Math.PI * 2, 0);
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      tuftMesh.setMatrixAt(i, dummy.matrix);
    }
    this.scene.add(tuftMesh);

    const lampCells = [];
    const lampKeys = new Set();
    for (const entry of this.map.paths) {
      for (let i = 4; i < entry.path.length - 1; i += 7) {
        const cell = entry.path[i];
        const key = `${cell.x},${cell.y}`;
        if (lampKeys.has(key)) continue;
        lampKeys.add(key);
        const prev = entry.path[Math.max(0, i - 1)];
        const next = entry.path[Math.min(entry.path.length - 1, i + 1)];
        const dx = next.x - prev.x;
        const dz = next.y - prev.y;
        const length = Math.hypot(dx, dz) || 1;
        const side = lampCells.length % 2 === 0 ? 1 : -1;
        const offsetX = (-dz / length) * 0.72 * side;
        const offsetZ = (dx / length) * 0.72 * side;
        const pos = this.cellToWorld(cell.x, cell.y);
        lampCells.push({ x: pos.x + offsetX, z: pos.z + offsetZ });
      }
    }

    if (lampCells.length === 0 && pathTiles.length > 0) {
      for (let i = 8; i < pathTiles.length; i += 17) {
        const cell = pathTiles[i];
        const pos = this.cellToWorld(cell.x, cell.y);
        lampCells.push({ x: pos.x + 0.72, z: pos.z });
      }
    }

    const postGeometry = new THREE.CylinderGeometry(0.045, 0.06, 0.82, 5);
    const postMaterial = new THREE.MeshStandardMaterial({
      color: 0x2a2f36,
      roughness: 0.8,
      metalness: 0.35
    });
    const postMesh = new THREE.InstancedMesh(postGeometry, postMaterial, lampCells.length);
    postMesh.castShadow = true;
    const bulbGeometry = new THREE.SphereGeometry(0.12, 6, 6);
    const bulbMaterial = new THREE.MeshBasicMaterial({ color: 0xffce7a });
    const bulbMesh = new THREE.InstancedMesh(bulbGeometry, bulbMaterial, lampCells.length);
    lampCells.forEach((lamp, i) => {
      dummy.position.set(lamp.x, 0.45, lamp.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      postMesh.setMatrixAt(i, dummy.matrix);
      dummy.position.set(lamp.x, 0.9, lamp.z);
      dummy.updateMatrix();
      bulbMesh.setMatrixAt(i, dummy.matrix);
    });
    this.scene.add(postMesh);
    this.scene.add(bulbMesh);

    const haloGeometry = new THREE.SphereGeometry(0.32, 8, 8);
    const haloMaterial = new THREE.MeshBasicMaterial({
      color: 0xffb74d,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const haloMesh = new THREE.InstancedMesh(haloGeometry, haloMaterial, lampCells.length);
    lampCells.forEach((lamp, i) => {
      dummy.position.set(lamp.x, 0.9, lamp.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      haloMesh.setMatrixAt(i, dummy.matrix);
    });
    this.scene.add(haloMesh);

    this.spawnMarkers = this.map.spawns.map((spawn) => {
      const marker = this.makeMarker(this.cellToWorld(spawn.x, spawn.y), 0x22c55e);
      marker.scale.setScalar(0.9);
      this.scene.add(marker);
      return marker;
    });
    this.goalMarker = this.makeMarker(this.cellToWorld(goal.x, goal.y), 0xf43f5e);
    this.goalMarker.scale.setScalar(1.15);
    this.scene.add(this.goalMarker);
    this.updateStrongholdMarkers();

    if (this.modeConfig.giant) {
      const hub = new THREE.Group();
      const hubPos = this.cellToWorld(goal.x, goal.y);
      hub.position.copy(hubPos);
      const platform = new THREE.Mesh(
        new THREE.CylinderGeometry(2.5, 2.8, 0.45, 12),
        new THREE.MeshStandardMaterial({ color: 0x3c4b5d, roughness: 0.7, metalness: 0.25 })
      );
      platform.position.y = 0.22;
      platform.castShadow = true;
      platform.receiveShadow = true;
      hub.add(platform);
      const step = new THREE.Mesh(
        new THREE.CylinderGeometry(3.2, 3.45, 0.18, 12),
        new THREE.MeshStandardMaterial({ color: 0x2b3543, roughness: 0.9 })
      );
      step.position.y = 0.09;
      step.receiveShadow = true;
      hub.add(step);
      const coreMaterial = new THREE.MeshStandardMaterial({
        color: 0xfecdd3,
        emissive: 0xf43f5e,
        emissiveIntensity: 2.2,
        roughness: 0.15,
        metalness: 0.1,
        flatShading: true
      });
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.62, 0), coreMaterial);
      core.position.y = 1.45;
      core.castShadow = true;
      hub.add(core);
      const halo = new THREE.Mesh(
        new THREE.TorusGeometry(0.95, 0.06, 6, 24),
        new THREE.MeshBasicMaterial({ color: 0xfb7185, transparent: true, opacity: 0.8 })
      );
      halo.rotation.x = Math.PI / 2;
      halo.position.y = 1.45;
      hub.add(halo);
      this.scene.add(hub);
      this.goalMarker.position.y = 0.55;
    }

    const starCount = 220;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      positions[i * 3] = (vrng() - 0.5) * W * TILE_SIZE * 2.2;
      positions[i * 3 + 1] = 4 + vrng() * 18;
      positions[i * 3 + 2] = (vrng() - 0.5) * H * TILE_SIZE * 2.2;
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.stars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({
        color: 0x9bd5ff,
        size: 0.1,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    this.scene.add(this.stars);
  }

  makeMarker(position, color) {
    const group = new THREE.Group();
    group.position.copy(position);
    group.position.y = 0.16;

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.58, 0.82, 40),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    ring.rotation.x = -Math.PI / 2;
    group.add(ring);

    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 32),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -0.01;
    group.add(disc);

    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.62, 2.6, 20, 1, true),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.13,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    beam.position.y = 1.3;
    group.add(beam);

    group.userData.ring = ring;
    group.userData.beam = beam;
    return group;
  }

  initPools() {
    const tracerGeometry = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < 64; i++) {
      const material = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(tracerGeometry, material);
      mesh.visible = false;
      this.scene.add(mesh);
      this.tracers.push({ mesh, life: 0, maxLife: 1 });
    }

    const effectGeometry = new THREE.RingGeometry(0.55, 0.68, 32);
    for (let i = 0; i < 32; i++) {
      const material = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(effectGeometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      this.scene.add(mesh);
      this.effects.push({ mesh, life: 0, maxLife: 0.5, maxScale: 2 });
    }

    this.rangeRing = this.makeRangeRing(0x22c55e);
    this.scene.add(this.rangeRing);
    this.rangeRing.visible = false;
    this.selectedRing = this.makeRangeRing(0x38bdf8);
    this.selectedRing.visible = false;
    this.scene.add(this.selectedRing);

    const pipGeometry = new THREE.SphereGeometry(0.055, 6, 6);
    const pipMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.pipMesh = new THREE.InstancedMesh(pipGeometry, pipMaterial, 900);
    this.pipMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pipMesh.frustumCulled = false;
    this.scene.add(this.pipMesh);
    this.pipDummy = new THREE.Object3D();
    this.pipColor = new THREE.Color();
    this.pipCount = 0;
    for (let i = 0; i < this.pipMesh.count; i++) {
      this.pipDummy.position.set(0, -100, 0);
      this.pipDummy.scale.setScalar(0);
      this.pipDummy.updateMatrix();
      this.pipMesh.setMatrixAt(i, this.pipDummy.matrix);
    }
  }

  makeRangeRing(color) {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.94, 1, 72),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
  }

  initGhost() {
    this.ghostHolder = new THREE.Group();
    this.scene.add(this.ghostHolder);
    this.ghostModel = null;
    this.highlight = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: 0x22c55e,
        transparent: true,
        opacity: 0.2,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    );
    this.highlight.rotation.x = -Math.PI / 2;
    this.highlight.scale.setScalar(TILE_SIZE * 0.92);
    this.highlight.position.y = 0.17;
    this.highlight.visible = false;
    this.scene.add(this.highlight);
    this.setGhostType('gun');
  }

  setGhostType(typeId) {
    if (!typeId) {
      this.ghostHolder.visible = false;
      this.rangeRing.visible = false;
      this.highlight.visible = false;
      return;
    }
    if (this.ghostModel) {
      this.ghostHolder.remove(this.ghostModel);
      this.disposeObject(this.ghostModel);
    }
    this.ghostModel = makeTowerModel(TOWER_TYPES[typeId]);
    this.ghostModel.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = false;
      child.receiveShadow = false;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        material.transparent = true;
        material.opacity = 0.42;
        material.depthWrite = false;
      }
    });
    this.ghostHolder.add(this.ghostModel);
    this.ghostHolder.visible = false;
  }

  initHud() {
    this.dom = {
      gold: document.getElementById('stat-gold'),
      lives: document.getElementById('stat-lives'),
      wave: document.getElementById('stat-wave'),
      enemies: document.getElementById('stat-enemies'),
      score: document.getElementById('stat-score'),
      seed: document.getElementById('seed-label'),
      difficulty: document.getElementById('difficulty'),
      mode: document.getElementById('mode'),
      helpModal: document.getElementById('help-modal'),
      helpButton: document.getElementById('help-button'),
      helpClose: document.getElementById('help-close'),
      helpReadme: document.getElementById('help-readme'),
      minimap: document.getElementById('minimap'),
      towerPanel: document.getElementById('tower-panel'),
      waveTitle: document.getElementById('wave-title'),
      wavePreview: document.getElementById('wave-preview'),
      waveButton: document.getElementById('btn-wave'),
      waveTip: document.getElementById('wave-tip'),
      towerBar: document.getElementById('tower-bar'),
      overlay: document.getElementById('overlay'),
      overlayEyebrow: document.getElementById('overlay-eyebrow'),
      overlayTitle: document.getElementById('overlay-title'),
      overlayDesc: document.getElementById('overlay-desc'),
      overlayStats: document.getElementById('overlay-stats'),
      overlaySeed: document.getElementById('overlay-seed'),
      toast: document.getElementById('toast'),
      pause: document.getElementById('btn-pause'),
      copy: document.getElementById('btn-copy'),
      newMap: document.getElementById('btn-new'),
      retry: document.getElementById('btn-retry'),
      again: document.getElementById('btn-again')
    };

    this.dom.seed.textContent = this.seed;
    this.dom.overlaySeed.textContent = this.seed;

    for (const key of Object.keys(DIFFICULTIES)) {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = DIFFICULTIES[key].label;
      if (key === this.difficulty) option.selected = true;
      this.dom.difficulty.appendChild(option);
    }

    for (const key of Object.keys(MODES)) {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = MODES[key].label;
      if (key === this.mode) option.selected = true;
      this.dom.mode.appendChild(option);
    }

    this.dom.towerBar.innerHTML = Object.values(TOWER_TYPES)
      .map((type) => {
        const element = ELEMENTS[type.element || 'none'];
        const damageType = type.damageType === 'magic' ? '魔法' : '物理';
        const elementAttach =
          type.element && type.element !== 'none'
            ? `每次命中附着 1 点${element.label}属性`
            : '无属性附着';
        const support = !!type.support;
        const magic = !!type.magicTower;
        const cursed = !!type.curseTower;
        const coin = !!type.coinTower;
        let rows;
        if (support) {
          rows = `
              <span><i>光环范围</i><b>${type.auraRange} 格</b></span>
              <span><i>基础治疗</i><b>${SUPPLY_UPGRADE.healBase} HP/s</b></span>
              <span><i>生命</i><b>${type.hp}</b></span>
              <span><i>升级</i><b>5 条分支</b></span>`;
        } else if (coin) {
          rows = `
              <span><i>金币产量</i><b>${type.income} / ${type.incomeInterval}s</b></span>
              <span><i>生命</i><b>${type.hp}</b></span>
              <span><i>升级</i><b>提高生产频率</b></span>`;
        } else if (cursed) {
          rows = `
              <span><i>每段伤害</i><b>${type.damage}</b></span>
              <span><i>射速</i><b>${type.fireRate.toFixed(2)}/s</b></span>
              <span><i>射程</i><b>${type.range.toFixed(1)} 格</b></span>
              <span><i>识别范围</i><b>${type.recognizeRange} 格</b></span>
              <span><i>连发</i><b>${type.pickCount} 段</b></span>
              <span><i>反应易伤</i><b>30% / 6层</b></span>
              <span><i>末段耗血</i><b>${Math.round(type.hpConsumeRatio * 100)}%</b></span>
              <span><i>耗血增伤</i><b>×${type.damagePerHp}</b></span>
              <span><i>伤害类型</i><b>${damageType}</b></span>
              <span><i>升级</i><b>暂未开放</b></span>`;
        } else if (magic) {
          rows = `
              <span><i>每次伤害</i><b>${type.damage}</b></span>
              <span><i>射速</i><b>${type.fireRate.toFixed(2)}/s</b></span>
              <span><i>射程</i><b>${type.range.toFixed(1)} 格</b></span>
              <span><i>连发次数</i><b>${type.pickCount} 次</b></span>
              <span><i>属性识别</i><b>${type.recognizeRange} 格</b></span>
              <span><i>属性范围</i><b>${type.splash} 格</b></span>
              <span><i>生命</i><b>${type.hp}</b></span>
              <span><i>伤害类型</i><b>${damageType}</b></span>
              <span><i>反应易伤</i><b>每级 +5%</b></span>
              <span><i>升级</i><b>Lv.10</b></span>`;
        } else {
          rows = `
              <span><i>伤害</i><b>${type.damage}</b></span>
              <span><i>射速</i><b>${type.fireRate.toFixed(2)}/s</b></span>
              <span><i>射程</i><b>${type.range.toFixed(1)} 格</b></span>
              <span><i>DPS</i><b>${(type.damage * type.fireRate).toFixed(1)}</b></span>
              <span><i>生命</i><b>${type.hp}</b></span>
              <span><i>伤害类型</i><b>${damageType}</b></span>
              <span><i>属性</i><b>${element.label}</b></span>
              ${type.splash ? `<span><i>爆炸半径</i><b>${type.splash} 格</b></span>` : ''}
              ${type.element === 'ice' ? `<span><i>冰减速</i><b>每层 −${(ICE_SLOW_PER_LAYER * 100).toFixed(1)}%</b></span>` : ''}`;
        }
        const tags = support
          ? '可升级：范围 / 攻击 / 生命 / 攻速 / 暴击'
          : magic
            ? '可升级：反应易伤每级 +5% · 与诅咒塔共享20层 · 3 连发'
            : cursed
              ? '识别2格内属性塔 · 7段魔法范围伤害 · 反应易伤30%（6层，与魔法塔共享20层）'
              : coin
                ? '周期性生产金币 · 可升级'
                : elementAttach;
        return `
        <button class="tower-card" data-type="${type.id}">
          <span class="tower-key">${type.key}</span>
          <span class="tower-dot" style="--c:${colorHex(type.color)}"></span>
          <span class="tower-name">${type.name}</span>
          <span class="tower-cost">${type.cost}</span>
          <span class="tower-tooltip">
            <span class="tt-title">${type.name} <b style="color:var(--gold)">${type.cost} 金</b></span>
            <span class="tt-desc">${type.desc}</span>
            <span class="tt-grid">${rows}</span>
            <span class="tt-tags">${tags}${type.splash ? ' · 范围伤害' : ''}</span>
          </span>
        </button>`;
      })
      .join('');

    this.dom.towerBar.querySelectorAll('.tower-card').forEach((card) => {
      card.addEventListener('click', () => this.selectTowerType(card.dataset.type));
    });

    this.dom.waveButton.addEventListener('click', () => this.startWave());
    this.dom.copy.addEventListener('click', () => this.copyLink());
    this.dom.newMap.addEventListener('click', () => {
      location.href = this.urlFor(randomSeed(), this.difficulty, this.mode);
    });
    this.dom.retry.addEventListener('click', () => {
      location.href = this.urlFor(this.seed, this.difficulty, this.mode);
    });
    this.dom.again.addEventListener('click', () => {
      location.href = this.urlFor(randomSeed(), this.difficulty, this.mode);
    });
    this.dom.difficulty.addEventListener('change', () => {
      location.href = this.urlFor(this.seed, this.dom.difficulty.value, this.mode);
    });
    this.dom.mode.addEventListener('change', () => {
      location.href = this.urlFor(this.seed, this.difficulty, this.dom.mode.value);
    });

    document.querySelectorAll('[data-speed]').forEach((button) => {
      button.addEventListener('click', () => {
        this.speed = Number(button.dataset.speed);
        this.updateHud();
      });
    });

    this.dom.pause.addEventListener('click', () => {
      this.togglePause();
      this.dom.pause.blur();
    });

    this.dom.helpButton.addEventListener('click', () => this.openHelp());
    this.dom.helpClose.addEventListener('click', () => this.closeHelp());
    this.dom.helpModal.addEventListener('click', (event) => {
      if (event.target === this.dom.helpModal) this.closeHelp();
    });

    this.dom.towerPanel.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const action = button.dataset.action;
      if (action === 'close') {
        this.selectedTower = null;
        this.selectedRing.visible = false;
        this.hideTowerPanel();
        return;
      }
      if (!this.selectedTower) return;
      if (action === 'sell') {
        this.sellTower(this.selectedTower);
        return;
      }
      this.upgradeTower(this.selectedTower, action);
    });

    if (this.modeConfig.giant) {
      this.dom.minimap.classList.remove('hidden');
      this.initMinimap();
    }
  }

  initMinimap() {
    if (!this.modeConfig.giant) return;
    const canvas = this.dom.minimap;
    const ctx = canvas.getContext('2d');
    const { W, H, tiles } = this.map;
    const base = document.createElement('canvas');
    base.width = W;
    base.height = H;
    const baseCtx = base.getContext('2d');
    const image = baseCtx.createImageData(W, H);

    for (let i = 0; i < W * H; i++) {
      const tile = tiles[i];
      let color;
      if (tile === TILE.PATH) color = [148, 160, 176];
      else if (tile === TILE.ROCK) color = [74, 86, 101];
      else color = [36, 70, 47];
      image.data[i * 4] = color[0];
      image.data[i * 4 + 1] = color[1];
      image.data[i * 4 + 2] = color[2];
      image.data[i * 4 + 3] = 255;
    }
    baseCtx.putImageData(image, 0, 0);

    this.minimapBase = base;
    this.minimapCtx = ctx;
    this.minimapTimer = 0;
    this.minimapDragging = false;

    const panToEvent = (event) => {
      const rect = canvas.getBoundingClientRect();
      const px = clamp((event.clientX - rect.left) / rect.width, 0, 0.999);
      const py = clamp((event.clientY - rect.top) / rect.height, 0, 0.999);
      const cellX = Math.floor(px * this.map.W);
      const cellY = Math.floor((1 - py) * this.map.H);
      const pos = this.cellToWorld(cellX, cellY);
      this.orbit.targetX = pos.x;
      this.orbit.targetZ = pos.z;
      this.updateCamera();
    };

    canvas.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.minimapDragging = true;
      canvas.setPointerCapture(event.pointerId);
      panToEvent(event);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (this.minimapDragging) panToEvent(event);
    });
    canvas.addEventListener('pointerup', (event) => {
      this.minimapDragging = false;
      canvas.releasePointerCapture(event.pointerId);
    });
    this.drawMinimap();
  }

  drawMinimap() {
    if (!this.modeConfig.giant || !this.minimapCtx) return;
    const ctx = this.minimapCtx;
    const canvas = this.dom.minimap;
    const size = canvas.width;
    const { W, H, strongholds } = this.map;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(this.minimapBase, 0, 0, size, size);

    const toX = (x) => ((x + 0.5) / W) * size;
    const toY = (y) => size - ((y + 0.5) / H) * size;

    for (const tower of this.towers) {
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(toX(tower.x) - 1.5, toY(tower.y) - 1.5, 3, 3);
    }

    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const x = enemy.mesh.position.x / TILE_SIZE + (W - 1) / 2;
      const y = (H - 1) / 2 - enemy.mesh.position.z / TILE_SIZE;
      ctx.fillStyle = '#fb923c';
      ctx.fillRect(toX(x) - 1, toY(y) - 1, 2, 2);
    }

    const wave = this.waveIndex + 1;
    const next = this.getNextStronghold();
    for (const stronghold of strongholds) {
      const active = stronghold.unlockWave <= wave;
      ctx.beginPath();
      ctx.fillStyle = active ? '#22c55e' : stronghold === next ? '#facc15' : '#64748b';
      ctx.arc(toX(stronghold.x), toY(stronghold.y), active ? 3.2 : 2.4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = '#f43f5e';
    ctx.beginPath();
    ctx.arc(toX(this.map.goal.x), toY(this.map.goal.y), 4, 0, Math.PI * 2);
    ctx.fill();

    const targetCellX = this.orbit.targetX / TILE_SIZE + (W - 1) / 2;
    const targetCellY = (H - 1) / 2 - this.orbit.targetZ / TILE_SIZE;
    const viewCells = 52 * this.orbit.zoom;
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.85)';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      toX(targetCellX - viewCells / 2),
      toY(targetCellY + viewCells / 2),
      (viewCells / W) * size,
      (viewCells / H) * size
    );
  }

  openHelp() {
    this.helpOpen = true;
    this.dom.helpModal.classList.remove('hidden');
    this.loadHelpMarkdown();
  }

  async loadHelpMarkdown() {
    if (!this.dom.helpReadme) return;
    if (this.helpReadmeLoaded) {
      this.dom.helpReadme.hidden = false;
      return;
    }
    if (this.helpReadmeLoading) return;
    this.helpReadmeLoading = true;
    this.dom.helpReadme.hidden = false;
    this.dom.helpReadme.innerHTML = '<p>正在加载 README.md ...</p>';
    try {
      const response = await fetch('./README.md', { cache: 'no-cache' });
      if (!response.ok) throw new Error(`README ${response.status}`);
      const markdown = await response.text();
      this.dom.helpReadme.innerHTML = renderMarkdown(markdown);
      this.helpReadmeLoaded = true;
    } catch {
      this.dom.helpReadme.innerHTML = '<p>无法加载 README.md。请确认它和 index.html 位于同一目录，并通过本地服务器打开游戏。</p>';
    } finally {
      this.helpReadmeLoading = false;
    }
  }

  closeHelp() {
    this.helpOpen = false;
    this.dom.helpModal.classList.add('hidden');
  }

  selectTowerType(typeId) {
    if (!TOWER_TYPES[typeId]) return;
    this.selectedTowerType = typeId;
    this.selectedTower = null;
    this.selectedRing.visible = false;
    this.hideTowerPanel();
    this.setGhostType(typeId);
    this.updateHud();
    if (this.hoverCell) this.updateGhost(this.hoverCell);
  }

  togglePause() {
    if (this.helpOpen || (this.phase !== 'build' && this.phase !== 'combat')) return;
    this.paused = !this.paused;
    this.updateHud();
  }

  getRepairCost() {
    const inCombat = this.enemies.length > 0 || this.spawnQueue.length > 0;
    return Math.round(
      (80 + this.waveIndex * 15 + this.repairCount * this.repairCount * 50) *
      (inCombat ? 1.5 : 1)
    );
  }

  tryRepairBase() {
    if (this.phase !== 'build' && this.phase !== 'combat') return;
    if (this.lives >= this.maxLives) {
      this.toast('基地生命已满');
      return;
    }
    if (this.repairCooldown > 0) {
      this.toast(`基地维修冷却 ${Math.ceil(this.repairCooldown)} 秒`);
      return;
    }
    const cost = this.getRepairCost();
    if (this.gold < cost) {
      this.toast(`金币不足 · 维修需要 ${cost} 金`);
      return;
    }

    this.gold -= cost;
    this.lives = Math.min(this.maxLives, this.lives + 1);
    this.repairCount++;
    this.repairCooldown = 30;
    this.repairHpMultiplier *= 1.01;
    const basePos = this.cellToWorld(this.map.goal.x, this.map.goal.y);
    this.castEffect(basePos, 0x4ade80, 3.2, 0.6);
    this.toast(`基地维修 +1 · ${cost} 金 · 后续敌人生命 +1%`);
    this.updateHud();
  }

  copyLink() {
    const url = new URL(location.href);
    url.searchParams.set('seed', this.seed);
    url.searchParams.set('diff', this.difficulty);
    url.searchParams.set('mode', this.mode);
    const link = url.toString();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(link)
        .then(() => this.toast('种子链接已复制'))
        .catch(() => window.prompt('复制链接', link));
    } else {
      window.prompt('复制链接', link);
    }
  }

  urlFor(seed, difficulty, mode = this.mode) {
    const url = new URL(location.href);
    url.searchParams.set('seed', seed);
    url.searchParams.set('diff', difficulty);
    url.searchParams.set('mode', mode);
    return `${url.pathname}${url.search}${url.hash}`;
  }

  toast(message) {
    const el = this.dom.toast;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), 1500);
  }

  rotateCamera(direction) {
    this.orbit.theta += direction * (Math.PI / 2);
    this.updateCamera();
  }

  centerCamera() {
    this.orbit.targetX = 0;
    this.orbit.targetZ = this.modeConfig.giant ? 0 : 2.4;
    this.orbit.zoom = 1;
    this.updateCamera();
  }

  updateCameraFit() {
    const { W, H } = this.map;
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const aspect = this.camera.aspect;
    const cos = Math.abs(Math.cos(this.orbit.theta));
    const sin = Math.abs(Math.sin(this.orbit.theta));
    const viewCells = this.modeConfig.giant ? 52 : null;
    const worldW = (viewCells || W) * TILE_SIZE;
    const worldD = (viewCells || H) * TILE_SIZE;
    const rotatedWidth = worldW * cos + worldD * sin + 8;
    const rotatedDepth = worldD * cos + worldW * sin + 8;
    const depth = rotatedDepth * Math.sin(this.orbit.elevation) + 8;
    const usableHeight = Math.max(0.56, (window.innerHeight - 206) / window.innerHeight);
    const fitHeight = depth / (2 * Math.tan(vFov / 2) * usableHeight);
    const fitWidth = rotatedWidth / (2 * Math.tan(vFov / 2) * aspect);
    this.baseRadius = Math.max(fitHeight, fitWidth, 36);
  }

  clampTarget() {
    const halfW = (this.map.W * TILE_SIZE) / 2 + 2;
    const halfD = (this.map.H * TILE_SIZE) / 2 + 2;
    this.orbit.targetX = clamp(this.orbit.targetX, -halfW, halfW);
    this.orbit.targetZ = clamp(this.orbit.targetZ, -halfD, halfD);
  }

  updateCamera() {
    this.updateCameraFit();
    this.clampTarget();
    const radius = this.baseRadius * this.orbit.zoom;
    const horizontal = Math.cos(this.orbit.elevation) * radius;
    const height = Math.sin(this.orbit.elevation) * radius;
    this.camera.position.set(
      this.orbit.targetX + Math.sin(this.orbit.theta) * horizontal,
      height,
      this.orbit.targetZ + Math.cos(this.orbit.theta) * horizontal
    );
    this.camera.lookAt(this.orbit.targetX, 0, this.orbit.targetZ);
    this.scene.fog.near = radius * 1.35;
    this.scene.fog.far = radius * 3.4;
    if (this.ghostHolder && this.selectedTowerType && this.pointer.x > -1.5) {
      this.updateHover();
    }
  }

  updatePanFromKeys(dt) {
    let moveX = 0;
    let moveZ = 0;
    const sin = Math.sin(this.orbit.theta);
    const cos = Math.cos(this.orbit.theta);
    if (this.keys.has('w')) {
      moveX -= sin;
      moveZ -= cos;
    }
    if (this.keys.has('s')) {
      moveX += sin;
      moveZ += cos;
    }
    if (this.keys.has('d')) {
      moveX += cos;
      moveZ -= sin;
    }
    if (this.keys.has('a')) {
      moveX -= cos;
      moveZ += sin;
    }
    if (moveX === 0 && moveZ === 0) return;
    const speed = this.baseRadius * 0.24 * dt;
    this.orbit.targetX += moveX * speed;
    this.orbit.targetZ += moveZ * speed;
    this.updateCamera();
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.updateCamera();
  }

  onWheel(event) {
    event.preventDefault();
    const factor = Math.exp(event.deltaY * 0.0012);
    this.orbit.zoom = clamp(this.orbit.zoom * factor, 0.3, 1.6);
    this.updateCamera();
  }

  onPointerMove(event) {
    const canvas = this.renderer.domElement;
    if (this.orbit.panning) {
      const dx = event.clientX - this.orbit.lastX;
      const dy = event.clientY - this.orbit.lastY;
      this.orbit.lastX = event.clientX;
      this.orbit.lastY = event.clientY;
      const sin = Math.sin(this.orbit.theta);
      const cos = Math.cos(this.orbit.theta);
      const scale = this.baseRadius * this.orbit.zoom * 0.0013;
      this.orbit.targetX += (-cos * dx - sin * dy) * scale;
      this.orbit.targetZ += (sin * dx - cos * dy) * scale;
      this.updateCamera();
      return;
    }

    const rect = canvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.updateHover();
  }

  updateHover() {
    if (!this.selectedTowerType) return;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, this.tmpPoint)) {
      this.hideGhost();
      return;
    }
    const cell = this.cellFromWorld(this.tmpPoint);
    if (!cell) {
      this.hideGhost();
      return;
    }
    this.hoverCell = cell;
    this.updateGhost(cell);
  }

  updateGhost(cell) {
    if (!this.selectedTowerType) return;
    const type = TOWER_TYPES[this.selectedTowerType];
    const buildable = this.isBuildable(cell.x, cell.y);
    const affordable = this.gold >= type.cost;
    const valid = buildable && affordable && (this.phase === 'build' || this.phase === 'combat');
    const pos = this.cellToWorld(cell.x, cell.y);

    this.ghostHolder.position.set(pos.x, 0.04, pos.z);
    this.ghostHolder.visible = true;

    this.highlight.position.set(pos.x, 0.18, pos.z);
    this.highlight.material.color.setHex(valid ? 0x22c55e : 0xef4444);
    this.highlight.visible = true;

    this.rangeRing.position.set(pos.x, 0.19, pos.z);
    this.rangeRing.scale.setScalar(type.range * TILE_SIZE);
    this.rangeRing.material.color.setHex(valid ? type.color : 0xef4444);
    this.rangeRing.visible = true;
  }

  hideGhost() {
    this.hoverCell = null;
    if (this.ghostHolder) this.ghostHolder.visible = false;
    if (this.rangeRing) this.rangeRing.visible = false;
    if (this.highlight) this.highlight.visible = false;
  }

  onPointerDown(event) {
    if (event.button === 0) {
      event.preventDefault();
      this.orbit.panning = true;
      this.orbit.lastX = event.clientX;
      this.orbit.lastY = event.clientY;
      this.renderer.domElement.setPointerCapture(event.pointerId);
      const stop = (upEvent) => {
        this.orbit.panning = false;
        this.renderer.domElement.releasePointerCapture(upEvent.pointerId);
        this.renderer.domElement.removeEventListener('pointerup', stop);
      };
      this.renderer.domElement.addEventListener('pointerup', stop);
      return;
    }

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, this.tmpPoint)) return;
    const cell = this.cellFromWorld(this.tmpPoint);
    if (!cell) return;

    const basePos = this.cellToWorld(this.map.goal.x, this.map.goal.y);
    if (
      event.button === 2 &&
      Math.hypot(this.tmpPoint.x - basePos.x, this.tmpPoint.z - basePos.z) <= TILE_SIZE * 1.7
    ) {
      this.tryRepairBase();
      return;
    }

    if (event.button === 1) {
      event.preventDefault();
      const tower = this.towerAt(cell.x, cell.y);
      if (tower) this.sellTower(tower);
      return;
    }

    if (event.button !== 2) return;
    const tower = this.towerAt(cell.x, cell.y);
    if (tower) {
      this.selectedTower = tower;
      this.selectedRing.position.set(tower.mesh.position.x, 0.2, tower.mesh.position.z);
      this.selectedRing.scale.setScalar(tower.stats.range * TILE_SIZE);
      this.selectedRing.material.color.setHex(tower.type.color);
      this.selectedRing.visible = true;
      this.showTowerPanel(tower);
      return;
    }

    this.selectedTower = null;
    this.selectedRing.visible = false;
    this.hideTowerPanel();
    this.placeTower(cell.x, cell.y);
  }

  onKeyDown(event) {
    if (event.target && event.target.tagName === 'SELECT') return;
    const key = event.key;
    const lower = key.toLowerCase();
    if (lower === 'w' || lower === 'a' || lower === 's' || lower === 'd') {
      this.keys.add(lower);
      event.preventDefault();
      return;
    }
    if (['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', '['].includes(key)) {
      const type = Object.values(TOWER_TYPES).find((tower) => tower.key === key);
      if (type) this.selectTowerType(type.id);
    } else if (key === 'Escape') {
      if (this.helpOpen) {
        this.closeHelp();
        return;
      }
      this.selectedTowerType = null;
      this.selectedTower = null;
      this.selectedRing.visible = false;
      this.setGhostType(null);
      this.hideGhost();
      this.hideTowerPanel();
      this.updateHud();
    } else if (key === ' ') {
      event.preventDefault();
      if (this.phase === 'build') this.startWave();
    } else if (lower === 'p') {
      if (!event.repeat) this.togglePause();
    } else if (lower === 'h') {
      if (this.helpOpen) this.closeHelp();
      else this.openHelp();
    } else if (lower === 'c') {
      this.centerCamera();
    } else if (lower === 'q') {
      this.rotateCamera(-1);
    } else if (lower === 'e') {
      this.rotateCamera(1);
    }
  }

  placeTower(x, y) {
    if (!this.selectedTowerType) return;
    if (this.phase !== 'build' && this.phase !== 'combat') return;
    const type = TOWER_TYPES[this.selectedTowerType];
    if (!this.isBuildable(x, y)) {
      this.toast('这里不能建造');
      return;
    }
    if (this.gold < type.cost) {
      this.toast('金币不足');
      return;
    }

    this.gold -= type.cost;
    const model = makeTowerModel(type);
    const pos = this.cellToWorld(x, y);
    model.position.set(pos.x, 0.02, pos.z);
    this.scene.add(model);

    const tower = {
      type,
      stats: baseTowerStats(type),
      level: 1,
      overclock: 0,
      pierce: 0,
      rangeStacks: 0,
      attackStacks: 0,
      vitalityStacks: 0,
      hasteStacks: 0,
      critTier: 0,
      hp: type.hp || 100,
      maxHp: type.hp || 100,
      healTimer: 0,
      cooldown: 0.25,
      x,
      y,
      mesh: model,
      head: model.userData.head,
      investment: type.cost
    };
    if (type.coinTower) tower.cooldown = tower.stats.incomeInterval;
    this.createTowerHpBar(tower);
    this.towers.push(tower);
    this.towerGrid.set(`${x},${y}`, tower);
    this.built++;
    this.recomputeTowerAuras();

    this.updateHud();
    if (this.hoverCell) this.updateGhost(this.hoverCell);
  }

  createTowerHpBar(tower) {
    const bar = new THREE.Group();
    const background = new THREE.Mesh(barGeometry, barBackgroundMaterial);
    background.scale.set(0.9, 0.08, 1);
    background.renderOrder = 20;
    bar.add(background);
    const fillMaterial = new THREE.MeshBasicMaterial({
      color: 0x4ade80,
      transparent: true,
      depthWrite: false
    });
    const fill = new THREE.Mesh(barGeometry, fillMaterial);
    fill.scale.set(0.84, 0.045, 1);
    fill.position.z = 0.005;
    fill.renderOrder = 21;
    bar.add(fill);
    bar.visible = false;
    this.scene.add(bar);
    tower.bar = bar;
    tower.barFill = fill;
    tower.barWidth = 0.84;
  }

  sellTower(tower) {
    const refund = Math.round(tower.investment * ECONOMY.sellRefund);
    this.gold += refund;
    this.scene.remove(tower.mesh);
    this.disposeObject(tower.mesh);
    this.scene.remove(tower.bar);
    tower.barFill.material.dispose();
    this.towers = this.towers.filter((item) => item !== tower);
    this.towerGrid.delete(`${tower.x},${tower.y}`);
    if (this.selectedTower === tower) {
      this.selectedTower = null;
      this.selectedRing.visible = false;
      this.hideTowerPanel();
    }
    this.recomputeTowerAuras();
    this.toast(`已出售 +${refund}`);
    this.updateHud();
    if (this.hoverCell) this.updateGhost(this.hoverCell);
  }

  baseStatsForTower(tower) {
    if (tower.type.id === 'gun') {
      return resolvePulseStats(tower.type, tower.level, tower.overclock, tower.pierce);
    }
    if (tower.type.support) {
      return resolveSupplyStats(
        tower.type,
        tower.level,
        tower.rangeStacks,
        tower.attackStacks,
        tower.vitalityStacks,
        tower.hasteStacks,
        tower.critTier
      );
    }
    if (tower.type.id === 'cannon') return resolveCannonStats(tower.type, tower.level);
    if (tower.type.id === 'magic') return resolveMagicStats(tower.type, tower.level);
    if (tower.type.id === 'coin') return resolveCoinStats(tower.type, tower.level);
    return baseTowerStats({ ...tower.type, level: tower.level });
  }

  recomputeTowerAuras() {
    const supplies = this.towers.filter((tower) => tower.type.support);
    for (const supply of supplies) {
      supply.stats = resolveSupplyStats(
        supply.type,
        supply.level,
        supply.rangeStacks,
        supply.attackStacks,
        supply.vitalityStacks,
        supply.hasteStacks,
        supply.critTier
      );
    }

    for (const tower of this.towers) {
      let rangeBonus = 0;
      let attackBonus = 0;
      let hpBonus = 0;
      let hasteBonus = 0;
      let critChance = 0;
      let critDamage = 0;

      for (const supply of supplies) {
        const aura = supply.stats.auraRange * TILE_SIZE;
        const dx = supply.mesh.position.x - tower.mesh.position.x;
        const dz = supply.mesh.position.z - tower.mesh.position.z;
        if (dx * dx + dz * dz > aura * aura) continue;
        rangeBonus += supply.rangeStacks * SUPPLY_UPGRADE.rangeBuffPerStack;
        attackBonus += supply.attackStacks * SUPPLY_UPGRADE.attackBuffPerStack;
        hpBonus += supply.vitalityStacks * SUPPLY_UPGRADE.maxHpBuffPerStack;
        hasteBonus += supply.hasteStacks * SUPPLY_UPGRADE.hastePerStack;
        critChance += SUPPLY_UPGRADE.critChanceTiers[supply.critTier] || 0;
        critDamage += SUPPLY_UPGRADE.critDamageTiers[supply.critTier] || 0;
      }

      const oldMax = tower.maxHp;
      const stats = this.baseStatsForTower(tower);
      if (!tower.type.support) {
        stats.range += Math.min(rangeBonus, SUPPLY_UPGRADE.rangeBuffCap);
        stats.damage *= 1 + Math.min(attackBonus, SUPPLY_UPGRADE.attackBuffCap);
        stats.fireRate *= 1 + Math.min(hasteBonus, SUPPLY_UPGRADE.hasteBuffCap);
        stats.critChance = Math.min(critChance, SUPPLY_UPGRADE.critChanceCap);
        stats.critDamage = Math.min(critDamage, SUPPLY_UPGRADE.critDamageCap);
      }
      tower.stats = stats;
      tower.maxHp = Math.max(
        1,
        Math.round(tower.type.hp * (1 + Math.min(hpBonus, SUPPLY_UPGRADE.maxHpBuffCap)))
      );
      if (tower.maxHp > oldMax) tower.hp += tower.maxHp - oldMax;
      tower.hp = Math.min(tower.hp, tower.maxHp);
    }
  }

  damageTower(tower, amount, source = null) {
    if (!tower || tower.hp <= 0) return;
    if (source?.status?.attachments?.water > 0) {
      this.healTower(tower, amount);
      return;
    }
    tower.hp = Math.max(0, tower.hp - amount);
    this.castEffect(tower.mesh.position, 0xef4444, 0.9, 0.3);
    this.applyDarkReflect(source, amount);
    if (this.selectedTower === tower) this.updateTowerPanel();
    if (tower.hp <= 0) this.destroyTower(tower);
  }

  healTower(tower, amount) {
    if (!tower || tower.hp <= 0) return;
    tower.hp = Math.min(tower.maxHp, tower.hp + amount);
    this.castEffect(tower.mesh.position, 0x34d399, 0.9, 0.3);
    if (this.selectedTower === tower) this.updateTowerPanel();
  }

  applyDarkReflect(source, damageDealt) {
    if (!source || source.dead || !source.status || damageDealt <= 0) return;
    const ratio = getDarkReflectRatio(source);
    if (ratio <= 0) return;
    this.damageEnemy(source, damageDealt * ratio, {
      damageType: 'magic',
      element: 'dark',
      attach: 0,
      source: 'retribution'
    });
    this.castEffect(source.mesh.position, 0xa855f7, 0.9, 0.28);
  }

  destroyTower(tower) {
    this.scene.remove(tower.mesh);
    this.disposeObject(tower.mesh);
    this.scene.remove(tower.bar);
    tower.barFill.material.dispose();
    this.towers = this.towers.filter((item) => item !== tower);
    this.towerGrid.delete(`${tower.x},${tower.y}`);
    if (this.selectedTower === tower) {
      this.selectedTower = null;
      this.selectedRing.visible = false;
      this.hideTowerPanel();
    }
    this.castEffect(tower.mesh.position, 0xef4444, 2.2, 0.5);
    this.recomputeTowerAuras();
    this.toast(`${tower.type.name} 被摧毁`);
    this.updateHud();
  }

  showTowerPanel(tower) {
    this.selectedTower = tower;
    this.dom.towerPanel.classList.remove('hidden');
    this.updateTowerPanel();
  }

  hideTowerPanel() {
    this.dom.towerPanel.classList.add('hidden');
    this.towerPanelTower = null;
    this.towerPanelHtml = '';
  }

  updateTowerPanel() {
    const tower = this.selectedTower;
    if (!tower || !this.towers.includes(tower)) {
      if (tower) this.selectedTower = null;
      this.hideTowerPanel();
      return;
    }
    if (this.towerPanelTower !== tower) this.towerPanelHtml = '';

    const stats = tower.stats;
    const ratio = clamp(tower.hp / tower.maxHp, 0, 1);
    const support = tower.type.support;
    const gun = tower.type.id === 'gun';
    const rows = [];

    if (support) {
      rows.push(`<span><i>光环范围</i><b>${stats.auraRange.toFixed(1)} 格</b></span>`);
      rows.push(`<span><i>治疗量</i><b>${stats.heal} HP / 秒</b></span>`);
      rows.push(`<span><i>增幅层数</i><b>${tower.rangeStacks}</b></span>`);
      rows.push(`<span><i>过载层数</i><b>${tower.attackStacks}</b></span>`);
      rows.push(`<span><i>生命回路</i><b>${tower.vitalityStacks}</b></span>`);
      rows.push(`<span><i>迅捷层数</i><b>${tower.hasteStacks}</b></span>`);
      rows.push(`<span><i>致命等级</i><b>${tower.critTier}</b></span>`);
    } else if (tower.type.coinTower) {
      rows.push(`<span><i>金币产量</i><b>${stats.income} / ${stats.incomeInterval.toFixed(2)}s</b></span>`);
      rows.push(`<span><i>等价收益</i><b>${(stats.income / stats.incomeInterval).toFixed(2)}/s</b></span>`);
    } else if (tower.type.curseTower) {
      rows.push(`<span><i>每段伤害</i><b>${stats.damage.toFixed(1)}</b></span>`);
      rows.push(`<span><i>射速</i><b>${stats.fireRate.toFixed(2)}/s</b></span>`);
      rows.push(`<span><i>射程</i><b>${stats.range.toFixed(1)} 格</b></span>`);
      rows.push(`<span><i>识别范围</i><b>${tower.type.recognizeRange} 格</b></span>`);
      rows.push(`<span><i>连发</i><b>${tower.type.pickCount} 段</b></span>`);
      rows.push(`<span><i>反应易伤</i><b>30% / 6层</b></span>`);
      rows.push(`<span><i>末段耗血</i><b>${Math.round(tower.type.hpConsumeRatio * 100)}%</b></span>`);
      rows.push(`<span><i>耗血增伤</i><b>×${tower.type.damagePerHp}</b></span>`);
      rows.push(`<span><i>伤害类型</i><b>魔法</b></span>`);
    } else if (tower.type.magicTower) {
      rows.push(`<span><i>每段伤害</i><b>${stats.damage.toFixed(1)}</b></span>`);
      rows.push(`<span><i>射速</i><b>${stats.fireRate.toFixed(2)}/s</b></span>`);
      rows.push(`<span><i>射程</i><b>${stats.range.toFixed(1)} 格</b></span>`);
      rows.push(`<span><i>属性识别</i><b>${tower.type.recognizeRange} 格</b></span>`);
      rows.push(`<span><i>连发次数</i><b>${tower.type.pickCount} 次</b></span>`);
      rows.push(`<span><i>反应增伤</i><b>${Math.round((stats.reactionAmp || 0) * 100)}%</b></span>`);
    } else {
      rows.push(`<span><i>伤害</i><b>${stats.damage.toFixed(1)}</b></span>`);
      rows.push(`<span><i>射速</i><b>${stats.fireRate.toFixed(2)}/s</b></span>`);
      rows.push(`<span><i>射程</i><b>${stats.range.toFixed(1)} 格</b></span>`);
      rows.push(`<span><i>DPS</i><b>${(stats.damage * stats.fireRate).toFixed(1)}</b></span>`);
      if (gun) {
        rows.push(`<span><i>超频层数</i><b>${tower.overclock}</b></span>`);
        rows.push(`<span><i>穿透数</i><b>${tower.pierce}</b></span>`);
      }
      if (stats.splash) {
        rows.push(`<span><i>爆炸半径</i><b>${stats.splash.toFixed(2)} 格</b></span>`);
      }
    }
    if (!support && !tower.type.coinTower && stats.critChance > 0) {
      rows.push(`<span><i>暴击</i><b>${Math.round(stats.critChance * 100)}% / ${Math.round(stats.critDamage * 100)}%</b></span>`);
    }

    let upgradeBlock = '<div class="tp-note">该塔暂未开放升级</div>';
    if (gun) {
      const cost = pulseUpgradeCost(tower);
      const disabled = cost === null || this.gold < cost;
      upgradeBlock = `
        <div class="tp-section-title">选择升级方向</div>
        <div class="tp-upgrades">
          <button class="tp-upgrade" data-action="overclock" ${disabled ? 'disabled' : ''}>
            <strong>超频 · ${tower.overclock}</strong>
            <small>射击频率 +5%</small>
            <span class="tp-cost">${cost === null ? '已满级' : `${cost} 金`}</span>
          </button>
          <button class="tp-upgrade" data-action="pierce" ${disabled ? 'disabled' : ''}>
            <strong>穿透 · ${tower.pierce}</strong>
            <small>额外穿透 1 个敌人</small>
            <span class="tp-cost">${cost === null ? '已满级' : `${cost} 金`}</span>
          </button>
        </div>`;
    } else if (support) {
      const cost = supplyUpgradeCost(tower);
      const disabled = cost === null || this.gold < cost;
      const critDisabled = disabled || tower.critTier >= SUPPLY_UPGRADE.maxCritTier;
      const critNowChance = SUPPLY_UPGRADE.critChanceTiers[tower.critTier] || 0;
      const critNowDamage = SUPPLY_UPGRADE.critDamageTiers[tower.critTier] || 0;
      const nextCritTier = Math.min(SUPPLY_UPGRADE.maxCritTier, tower.critTier + 1);
      const critNextChance = SUPPLY_UPGRADE.critChanceTiers[nextCritTier] || 0;
      const critNextDamage = SUPPLY_UPGRADE.critDamageTiers[nextCritTier] || 0;
      const critText =
        tower.critTier >= SUPPLY_UPGRADE.maxCritTier
          ? `当前 ${Math.round(critNowChance * 100)}%/${Math.round(critNowDamage * 100)}%（已满）`
          : `当前 ${Math.round(critNowChance * 100)}%/${Math.round(critNowDamage * 100)}% → 下一级 ${Math.round(critNextChance * 100)}%/${Math.round(critNextDamage * 100)}%`;
      upgradeBlock = `
        <div class="tp-section-title">选择强化方向</div>
        <div class="tp-upgrades">
          <button class="tp-upgrade" data-action="range" ${disabled ? 'disabled' : ''}>
            <strong>增幅 · ${tower.rangeStacks}</strong>
            <small>塔攻击范围/光环范围 +0.25</small>
            <span class="tp-cost">${cost === null ? '已满级' : `${cost} 金`}</span>
          </button>
          <button class="tp-upgrade" data-action="attack" ${disabled ? 'disabled' : ''}>
            <strong>过载 · ${tower.attackStacks}</strong>
            <small>光环内攻击塔伤害 +8%</small>
            <span class="tp-cost">${cost === null ? '已满级' : `${cost} 金`}</span>
          </button>
          <button class="tp-upgrade" data-action="vitality" ${disabled ? 'disabled' : ''}>
            <strong>生命回路 · ${tower.vitalityStacks}</strong>
            <small>治疗 +2，生命上限 +12%</small>
            <span class="tp-cost">${cost === null ? '已满级' : `${cost} 金`}</span>
          </button>
          <button class="tp-upgrade" data-action="haste" ${disabled ? 'disabled' : ''}>
            <strong>迅捷 · ${tower.hasteStacks}</strong>
            <small>光环内攻击塔攻频 +5%</small>
            <span class="tp-cost">${cost === null ? '已满级' : `${cost} 金`}</span>
          </button>
          <button class="tp-upgrade" data-action="crit" ${critDisabled ? 'disabled' : ''}>
            <strong>致命 · ${tower.critTier}</strong>
            <small>${critText}</small>
            <span class="tp-cost">${tower.critTier >= SUPPLY_UPGRADE.maxCritTier ? '已满级' : `${cost} 金`}</span>
          </button>
        </div>`;
    } else if (tower.type.id === 'cannon') {
      const cost = cannonUpgradeCost(tower);
      const disabled = cost === null || this.gold < cost;
      upgradeBlock = `
        <div class="tp-section-title">升级</div>
        <div class="tp-upgrades">
          <button class="tp-upgrade" data-action="upgrade" ${disabled ? 'disabled' : ''}>
            <strong>强化 · Lv.${tower.level}</strong>
            <small>伤害提高，射程/爆炸半径增加</small>
            <span class="tp-cost">${cost === null ? '已满级' : `${cost} 金`}</span>
          </button>
        </div>`;
    } else if (tower.type.magicTower) {
      const cost = magicUpgradeCost(tower);
      const disabled = cost === null || this.gold < cost;
      upgradeBlock = `
        <div class="tp-section-title">升级</div>
        <div class="tp-upgrades">
          <button class="tp-upgrade" data-action="upgrade" ${disabled ? 'disabled' : ''}>
            <strong>增幅 · Lv.${tower.level}</strong>
            <small>射程内敌人受到的属性反应伤害 +5%</small>
            <span class="tp-cost">${cost === null ? '已满级' : `${cost} 金`}</span>
          </button>
        </div>`;
    } else if (tower.type.coinTower) {
      const cost = coinUpgradeCost(tower);
      const disabled = cost === null || this.gold < cost;
      upgradeBlock = `
        <div class="tp-section-title">升级</div>
        <div class="tp-upgrades">
          <button class="tp-upgrade" data-action="upgrade" ${disabled ? 'disabled' : ''}>
            <strong>增产 · Lv.${tower.level}</strong>
            <small>金币生产频率提高</small>
            <span class="tp-cost">${cost === null ? '已满级' : `${cost} 金`}</span>
          </button>
        </div>`;
    }

    const refund = Math.round(tower.investment * ECONOMY.sellRefund);
    const html = `
      <div class="tp-head">
        <span class="tp-title">${tower.type.name}</span>
        <span class="tp-level">Lv.${tower.level}</span>
        <button class="tp-close ghost" data-action="close">关闭</button>
      </div>
      <div class="tp-hp-track"><div class="tp-hp-fill" style="width:${ratio * 100}%; background:${ratio > 0.5 ? '' : ratio > 0.25 ? 'linear-gradient(90deg,#f59e0b,#fbbf24)' : 'linear-gradient(90deg,#ef4444,#f87171)'}"></div></div>
      <div class="tp-hp-label"><span>生命</span><span>${Math.ceil(tower.hp)} / ${tower.maxHp}</span></div>
      <div class="tp-stats">${rows.join('')}</div>
      ${upgradeBlock}
      <div class="tp-actions">
        <span class="tp-note">出售返还 ${refund} 金</span>
        <button class="tp-sell ghost" data-action="sell">出售</button>
      </div>`;
    if (this.towerPanelTower === tower && this.towerPanelHtml === html) return;
    this.towerPanelTower = tower;
    this.towerPanelHtml = html;
    this.dom.towerPanel.innerHTML = html;
  }

  upgradeTower(tower, action) {
    if (!tower || !this.towers.includes(tower)) return;
    let cost = null;
    let valid = false;

    if (tower.type.id === 'gun') {
      cost = pulseUpgradeCost(tower);
      valid = action === 'overclock' || action === 'pierce';
    } else if (tower.type.support) {
      cost = supplyUpgradeCost(tower);
      valid = ['range', 'attack', 'vitality', 'haste', 'crit'].includes(action);
      if (action === 'crit' && tower.critTier >= SUPPLY_UPGRADE.maxCritTier) return;
    } else if (tower.type.id === 'cannon') {
      cost = cannonUpgradeCost(tower);
      valid = action === 'upgrade';
    } else if (tower.type.magicTower) {
      cost = magicUpgradeCost(tower);
      valid = action === 'upgrade';
    } else if (tower.type.coinTower) {
      cost = coinUpgradeCost(tower);
      valid = action === 'upgrade';
    }
    if (!valid) return;
    if (cost === null) {
      this.toast('该塔已满级');
      return;
    }
    if (this.gold < cost) {
      this.toast('金币不足');
      return;
    }

    this.gold -= cost;
    tower.investment += cost;
    tower.level++;
    if (action === 'overclock') tower.overclock++;
    else if (action === 'pierce') tower.pierce++;
    else if (action === 'range') tower.rangeStacks++;
    else if (action === 'attack') tower.attackStacks++;
    else if (action === 'vitality') tower.vitalityStacks++;
    else if (action === 'haste') tower.hasteStacks++;
    else if (action === 'crit') tower.critTier++;

    this.recomputeTowerAuras();
    if (this.selectedTower === tower) {
      this.selectedRing.scale.setScalar(tower.stats.range * TILE_SIZE);
      this.updateTowerPanel();
    }
    this.updateHud();
    this.toast(`${tower.type.name} 升级到 Lv.${tower.level}`);
  }

  findTowerInContact(enemy) {
    const rangeSq = (1.4 * TILE_SIZE) ** 2;
    let best = null;
    let bestDist = Infinity;
    for (const tower of this.towers) {
      const dx = tower.mesh.position.x - enemy.mesh.position.x;
      const dz = tower.mesh.position.z - enemy.mesh.position.z;
      const dist = dx * dx + dz * dz;
      if (dist > rangeSq || dist >= bestDist) continue;
      bestDist = dist;
      best = tower;
    }
    return best;
  }

  findTowerInRange(enemy, rangeCells) {
    const rangeSq = (rangeCells * TILE_SIZE) ** 2;
    let best = null;
    let bestDist = Infinity;
    for (const tower of this.towers) {
      const dx = tower.mesh.position.x - enemy.mesh.position.x;
      const dz = tower.mesh.position.z - enemy.mesh.position.z;
      const dist = dx * dx + dz * dz;
      if (dist > rangeSq || dist >= bestDist) continue;
      bestDist = dist;
      best = tower;
    }
    return best;
  }

  getEnemyAttackDamage(enemy) {
    return enemy.type.towerDamage || 0;
  }

  getEnemyAttackDelay(enemy) {
    return 1.2 / getStasisAttackFactor(enemy);
  }

  findDrunkenTarget(enemy) {
    const rangeSq = (2.4 * TILE_SIZE) ** 2;
    const targets = [];
    for (const other of this.enemies) {
      if (other === enemy || other.dead) continue;
      const dx = other.mesh.position.x - enemy.mesh.position.x;
      const dz = other.mesh.position.z - enemy.mesh.position.z;
      if (dx * dx + dz * dz <= rangeSq) targets.push(other);
    }
    if (targets.length === 0) return null;
    return targets[Math.floor(this.rng() * targets.length)];
  }

  castEffect(position, color, maxScale, maxLife = 0.45) {
    let effect = this.effects.find((item) => item.life <= 0);
    if (!effect) effect = this.effects[0];
    effect.life = maxLife;
    effect.maxLife = maxLife;
    effect.maxScale = maxScale;
    effect.mesh.position.copy(position);
    effect.mesh.position.y = 0.28;
    effect.mesh.scale.setScalar(0.45);
    effect.mesh.material.color.setHex(color);
    effect.mesh.material.opacity = 0.9;
    effect.mesh.visible = true;
  }

  spawnTracer(from, to, color, thickness) {
    let tracer = this.tracers.find((item) => item.life <= 0);
    if (!tracer) tracer = this.tracers[0];
    tracer.life = 0.09;
    tracer.maxLife = 0.09;
    const mesh = tracer.mesh;
    const length = from.distanceTo(to);
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.lookAt(to);
    mesh.scale.set(thickness, thickness, length);
    mesh.material.color.setHex(color);
    mesh.material.opacity = 1;
    mesh.visible = true;
  }

  updateHud() {
    const ended = this.phase === 'won' || this.phase === 'lost';
    const hasNext = !ended && this.canStartNextWave();
    if (hasNext) {
      this.ensureWave(this.waveIndex);
      this.ensureWave(this.waveIndex + 1);
    }
    const endless = this.modeConfig.endless;
    const startedDisplay = endless
      ? Math.max(1, this.waveIndex)
      : Math.max(1, Math.min(this.waveIndex, this.waves.length));
    const previewIndex = hasNext
      ? this.waveIndex
      : Math.max(0, this.waves.length - 1);
    const wave = this.waves[Math.min(previewIndex, this.waves.length - 1)];
    this.dom.gold.textContent = this.gold;
    this.dom.lives.textContent = this.lives;
    this.dom.wave.textContent = endless
      ? `${startedDisplay} / ∞`
      : `${this.phase === 'won' ? this.waves.length : startedDisplay} / ${this.waves.length}`;
    this.dom.enemies.textContent = this.enemies.length;
    this.dom.score.textContent = this.score;

    document.querySelectorAll('[data-speed]').forEach((button) => {
      button.classList.toggle('active', Number(button.dataset.speed) === this.speed);
    });

    if (this.dom.pause) {
      this.dom.pause.textContent = this.paused ? '播放' : '暂停';
      this.dom.pause.classList.toggle('active', this.paused);
      this.dom.pause.setAttribute('aria-pressed', String(this.paused));
    }

    this.dom.towerBar.querySelectorAll('.tower-card').forEach((card) => {
      const type = TOWER_TYPES[card.dataset.type];
      card.classList.toggle('selected', this.selectedTowerType === type.id);
      card.classList.toggle('unaffordable', this.gold < type.cost);
    });

    if (ended) {
      this.dom.waveTitle.textContent = this.phase === 'won' ? '全部波次完成' : '防线失守';
      this.dom.waveButton.textContent = '本局结束';
      this.dom.waveButton.disabled = true;
      this.dom.waveTip.textContent = '点击重开可以换一种随机地图';
    } else if (hasNext) {
      const nextNumber = this.waveIndex + 1;
      const firstWave = this.waveIndex === 0;
      const seconds = Number.isFinite(this.prepRemaining)
        ? Math.max(0, Math.ceil(this.prepRemaining))
        : Infinity;
      const bonus = this.earlyBonus();
      if (firstWave) {
        this.dom.waveTitle.textContent = `${this.modeConfig.label} · 第 1 波 · 无限准备`;
        this.dom.waveButton.textContent = '开始第 1 波';
      } else {
        this.dom.waveTitle.textContent = `${this.modeConfig.label} · 第 ${nextNumber} 波倒计时`;
        this.dom.waveButton.textContent = `提前开始第 ${nextNumber} 波 · ${seconds}s`;
      }
      this.dom.waveButton.disabled = false;
      if (firstWave) {
        this.dom.waveTip.textContent = `首波前无限准备 · 无提前奖励 · ${this.entranceSummary()}`;
      } else if (this.modeConfig.giant) {
        const next = this.getNextStronghold();
        const nextText = next ? `下一据点第 ${next.unlockWave} 波解锁` : '全部据点已激活';
        this.dom.waveTip.textContent = `提前开波 +${bonus} 金 · ${this.entranceSummary()} · ${nextText}`;
      } else {
        this.dom.waveTip.textContent = `提前开波 +${bonus} 金 · ${this.entranceSummary()} · 倒计时结束自动开波`;
      }
    } else {
      this.dom.waveTitle.textContent = `${this.modeConfig.label} · 最终波 · 清场中`;
      this.dom.waveButton.textContent = '最终波进行中';
      this.dom.waveButton.disabled = true;
      this.dom.waveTip.textContent = `剩余 ${this.enemies.length + this.spawnQueue.length} 个敌人待清除`;
    }

    const summary = waveSummary(wave);
    const totals = waveTotals(wave);
    totals.hp = Math.round(totals.hp * this.repairHpMultiplier);
    this.dom.wavePreview.innerHTML =
      summary
        .map(
          (item) =>
            `<span class="chip"><i style="background:${colorHex(ENEMY_TYPES[item.type].color)}"></i>${item.name} ×${item.count}</span>`
        )
        .join('') +
      `<span class="chip total">${hasNext ? '下一波' : '最终波'} · ${this.entranceSummary()} · 共 ${totals.count} 只 · ${totals.hp} HP</span>`;

    if (this.selectedTower) this.updateTowerPanel();
  }

  getActiveSpawnIndices() {
    if (!this.modeConfig.giant || !this.map.strongholds) {
      return this.map.spawns.map((_, index) => index);
    }
    const wave = this.waveIndex + 1;
    const active = [];
    this.map.strongholds.forEach((stronghold, index) => {
      if (stronghold.unlockWave <= wave) active.push(index);
    });
    return active.length > 0 ? active : [0];
  }

  getNextStronghold() {
    if (!this.modeConfig.giant || !this.map.strongholds) return null;
    const wave = this.waveIndex + 1;
    let next = null;
    for (const stronghold of this.map.strongholds) {
      if (stronghold.unlockWave > wave && (!next || stronghold.unlockWave < next.unlockWave)) {
        next = stronghold;
      }
    }
    return next;
  }

  setMarkerColor(marker, color, scale = 1, beamOpacity = 0.13) {
    if (!marker) return;
    marker.scale.setScalar(scale);
    marker.traverse((child) => {
      if (child.isMesh && child.material && child.material.color) {
        child.material.color.setHex(color);
      }
    });
    if (marker.userData.beam) marker.userData.beam.material.opacity = beamOpacity;
  }

  updateStrongholdMarkers() {
    if (!this.modeConfig.giant || !this.map.strongholds || !this.spawnMarkers) return;
    const wave = this.waveIndex + 1;
    const next = this.getNextStronghold();
    this.map.strongholds.forEach((stronghold, index) => {
      const marker = this.spawnMarkers[index];
      if (!marker) return;
      if (stronghold.unlockWave <= wave) {
        this.setMarkerColor(marker, 0x34d399, 1.3, 0.28);
      } else if (stronghold === next) {
        this.setMarkerColor(marker, 0xfacc15, 1.35, 0.26);
      } else {
        this.setMarkerColor(marker, 0x94a3b8, 0.8, 0.08);
      }
    });
  }

  announceStrongholds() {
    if (!this.modeConfig.giant || !this.map.strongholds) return;
    const wave = this.waveIndex + 1;
    const unlocked = this.map.strongholds.filter(
      (stronghold) => stronghold.unlockWave === wave && !this.announcedStrongholds.has(stronghold)
    );
    for (const stronghold of unlocked) {
      this.announcedStrongholds.add(stronghold);
      this.toast(`第 ${wave} 波：新敌方据点已解锁`);
    }
    this.updateStrongholdMarkers();
  }

  entranceSummary() {
    if (this.modeConfig.giant && this.map.strongholds) {
      const active = this.getActiveSpawnIndices().length;
      return `${active} / ${this.map.strongholds.length} 据点`;
    }
    return `${this.map.paths.length} 个入口`;
  }

  ensureWave(index) {
    if (!this.modeConfig.endless) return;
    while (this.waves.length <= index) {
      this.waves.push(
        createWave(this.seed, this.difficulty, this.waves.length + 1, this.modeConfig.giant)
      );
    }
  }

  resetCountdown() {
    this.prepRemaining = this.modeConfig.prepTime;
    this.prepTotal = this.prepRemaining;
  }

  canStartNextWave() {
    return this.modeConfig.endless || this.waveIndex < this.waves.length;
  }

  earlyBonus() {
    if (this.waveIndex === 0) return 0;
    if (!Number.isFinite(this.prepRemaining)) return 0;
    return Math.max(0, Math.round(this.prepRemaining * this.modeConfig.earlyBonusRate));
  }

  startWave(auto = false) {
    if (this.phase === 'won' || this.phase === 'lost') return;
    if (!this.canStartNextWave()) return;
    this.ensureWave(this.waveIndex);
    const wave = this.waves[this.waveIndex];
    if (!wave) return;

    if (!auto && this.prepRemaining > 0) {
      const bonus = this.earlyBonus();
      if (bonus > 0) {
        this.gold += bonus;
        this.toast(`提前开波 +${bonus} 金币`);
      }
    }

    const spawnIndices = this.getActiveSpawnIndices();
    if (spawnIndices.length === 0) spawnIndices.push(0);
    this.announceStrongholds();

    const totalCount = wave.groups.reduce((sum, group) => sum + group.count, 0);
    this.waveStates.set(this.waveIndex, {
      index: this.waveIndex,
      wave,
      pending: totalCount,
      alive: 0,
      complete: false,
      repairHpMultiplier: this.repairHpMultiplier
    });

    let sequence = 0;
    for (const group of wave.groups) {
      for (let i = 0; i < group.count; i++) {
        this.spawnQueue.push({
          time: this.waveClock + group.delay + i * group.interval,
          type: group.type,
          spawnIndex: spawnIndices[sequence++ % spawnIndices.length],
          waveIndex: this.waveIndex
        });
      }
    }
    this.spawnQueue.sort((a, b) => a.time - b.time);

    const totals = waveTotals(wave);
    const waveNumber = this.waveIndex + 1;
    this.waveIndex++;
    this.phase = 'combat';
    if (this.canStartNextWave()) this.resetCountdown();
    else this.prepRemaining = 0;
    this.updateStrongholdMarkers();

    this.toast(`第 ${waveNumber} 波来袭 · ${totals.count} 只`);
    this.updateHud();
  }

  failSpawn(waveIndex) {
    const state = this.waveStates.get(waveIndex);
    if (!state) return;
    if (state.pending > 0) state.pending--;
    this.completeWaveStateIfDone(state);
  }

  spawnEnemy(typeId, spawnIndex = 0, waveIndex = null) {
    const effectiveWaveIndex =
      Number.isInteger(waveIndex) && this.waves[waveIndex]
        ? waveIndex
        : Math.max(0, this.waveIndex - 1);
    const wave = this.waves[effectiveWaveIndex] || this.waves[0];
    const type = ENEMY_TYPES[typeId];
    const model = makeEnemyModel(type);
    const state = this.waveStates.get(effectiveWaveIndex);
    const hp = type.hp * wave.hpMul * (state?.repairHpMultiplier ?? this.repairHpMultiplier);
    const spawn = this.map.spawns[spawnIndex % this.map.spawns.length];
    if (!spawn) {
      this.failSpawn(effectiveWaveIndex);
      return;
    }
    let routePoints;
    let routeTotal;
    if (type.flying) {
      const start = this.cellToWorld(spawn.x, spawn.y);
      const center = this.cellToWorld((this.map.W - 1) / 2, (this.map.H - 1) / 2);
      const end = {
        x: clamp(center.x * 2 - start.x + (this.rng() * 2 - 1) * TILE_SIZE * 3, TILE_SIZE * 2, (this.map.W - 2) * TILE_SIZE),
        z: clamp(center.z * 2 - start.z + (this.rng() * 2 - 1) * TILE_SIZE * 3, TILE_SIZE * 2, (this.map.H - 2) * TILE_SIZE)
      };
      const distance = Math.hypot(end.x - start.x, end.z - start.z);
      const steps = Math.max(2, Math.ceil(distance / TILE_SIZE));
      routePoints = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        routePoints.push(new THREE.Vector3(
          start.x + (end.x - start.x) * t,
          0,
          start.z + (end.z - start.z) * t
        ));
      }
      routeTotal = (routePoints.length - 1) * TILE_SIZE;
    } else {
      const startIndex = this.pathGraph.indexAt[spawn.y * this.map.W + spawn.x];
      if (startIndex < 0) {
        this.failSpawn(effectiveWaveIndex);
        return;
      }

      const detour = this.rng() < (type.detourChance || 0);
      let route = findRoute(this.pathGraph, startIndex, this.rng, {
        detour,
        detourWeight: 2.2
      });
      if (!route) {
        route = findRoute(this.pathGraph, startIndex, this.rng, { detour: false });
      }
      if (!route || route.length < 2) {
        this.failSpawn(effectiveWaveIndex);
        return;
      }

      routePoints = route.map((index) => {
        const cell = this.pathGraph.cells[index];
        return this.cellToWorld(cell.x, cell.y);
      });
      routeTotal = (routePoints.length - 1) * TILE_SIZE;
    }
    if (state) {
      if (state.pending > 0) state.pending--;
      state.alive++;
    }

    const bar = new THREE.Group();
    const background = new THREE.Mesh(barGeometry, barBackgroundMaterial);
    background.scale.set(0.92, 0.1, 1);
    background.renderOrder = 20;
    bar.add(background);
    const fillMaterial = new THREE.MeshBasicMaterial({
      color: 0x4ade80,
      transparent: true,
      depthWrite: false
    });
    const fill = new THREE.Mesh(barGeometry, fillMaterial);
    fill.scale.set(0.86, 0.055, 1);
    fill.position.z = 0.005;
    fill.renderOrder = 21;
    bar.add(fill);
    bar.visible = false;
    this.scene.add(bar);

    const enemy = {
      type,
      mesh: model.group,
      material: model.material,
      body: model.body,
      bar,
      barFill: fill,
      barWidth: 0.86,
      hp,
      maxHp: hp,
      baseSpeed: type.speed * wave.speedMul * TILE_SIZE,
      routePoints,
      routeTotal,
      routeDist: 0,
      remaining: routeTotal,
      spawnIndex,
      waveIndex: effectiveWaveIndex,
      offset: (this.rng() * 2 - 1) * 0.34,
      towerAttackTimer: 0.8 + this.rng() * 0.8,
      reward: Math.round(type.reward * wave.rewardMul),
      status: createStatus(),
      resistances: createResistances(
        type,
        wave.index || effectiveWaveIndex + 1,
        this.difficulty,
        this.rng
      ),
      altitude: type.altitude || 0.14,
      noLeak: !!type.noLeak,
      flash: 0,
      age: 0,
      dead: false,
      leaked: false,
      retired: false
    };

    const dir = this.tmpDir.subVectors(routePoints[1], routePoints[0]).normalize();
    const px = routePoints[0].x - dir.z * enemy.offset;
    const pz = routePoints[0].z + dir.x * enemy.offset;
    enemy.mesh.position.set(px, enemy.altitude, pz);
    enemy.mesh.rotation.y = Math.atan2(dir.x, dir.z);
    enemy.mesh.scale.setScalar(0.25);
    this.scene.add(enemy.mesh);
    this.enemies.push(enemy);
  }

  sampleRoute(enemy, outPos, outDir) {
    const points = enemy.routePoints;
    const count = points.length;
    const f = clamp(enemy.routeDist / TILE_SIZE, 0, count - 1);
    const i = Math.min(Math.floor(f), count - 2);
    const t = f - i;
    outPos.lerpVectors(points[i], points[i + 1], t);
    outDir.subVectors(points[i + 1], points[i]).normalize();
  }

  findTarget(tower) {
    const rangeSq = (tower.stats.range * TILE_SIZE) ** 2;
    let best = null;
    let bestRemaining = Infinity;
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const dx = enemy.mesh.position.x - tower.mesh.position.x;
      const dz = enemy.mesh.position.z - tower.mesh.position.z;
      if (dx * dx + dz * dz > rangeSq) continue;
      if (enemy.remaining < bestRemaining) {
        bestRemaining = enemy.remaining;
        best = enemy;
      }
    }
    return best;
  }

  damageEnemy(enemy, amount, packet = {}) {
    if (enemy.dead) return;
    const damageType = packet.damageType || 'physical';
    let finalAmount = amount;
    if (!packet.trueDamage) {
      let crit = false;
      if (packet.critChance && this.rng() < packet.critChance) {
        finalAmount *= 1 + (packet.critDamage || 0);
        crit = true;
      }
      const attributeDebuff =
        packet.element && packet.element !== 'none'
          ? getLightResistanceDebuff(enemy, packet.element) +
            getSpreadResistanceDebuff(enemy, packet.element) +
            getSweepResistanceDebuff(enemy)
          : 0;
      finalAmount *= getResistanceMultiplier(enemy, damageType, packet.element, attributeDebuff);
      finalAmount *= getLightDamageMultiplier(enemy);
      if (packet.reaction) finalAmount *= this.getReactionVulnerabilityMultiplier(enemy);
      if (crit) this.castEffect(enemy.mesh.position, 0xfef08a, 0.7, 0.22);
    }
    enemy.hp -= finalAmount;
    enemy.flash = 0.1;
    if (packet.element && packet.element !== 'none' && packet.attach !== 0) {
      addAttachment(enemy, packet.element, 1);
      this.reactionQueue.add(enemy);
    }
    if (enemy.hp <= 0) {
      enemy.dead = true;
      this.deadEnemies.push(enemy);
    }
  }

  getReactionVulnerabilityMultiplier(enemy) {
    let levels = 0;
    for (const tower of this.towers) {
      const range = tower.stats.range * TILE_SIZE;
      const dx = tower.mesh.position.x - enemy.mesh.position.x;
      const dz = tower.mesh.position.z - enemy.mesh.position.z;
      if (dx * dx + dz * dz > range * range) continue;
      if (tower.type.id === 'magic') levels += tower.level;
      else if (tower.type.id === 'cursed') levels += tower.type.reactionLevels || 6;
    }
    return 1 + Math.min(20, levels) * 0.05;
  }

  spreadElement(source, element) {
    const radiusSq = (SPREAD_RADIUS_CELLS * TILE_SIZE) ** 2;
    for (const enemy of this.enemies) {
      if (enemy.dead || enemy === source) continue;
      const dx = enemy.mesh.position.x - source.mesh.position.x;
      const dz = enemy.mesh.position.z - source.mesh.position.z;
      if (dx * dx + dz * dz > radiusSq) continue;
      addAttachment(enemy, element, 1);
      applySpreadResistanceDebuff(enemy, element);
      this.reactionQueue.add(enemy);
    }
    const color = ELEMENTS[element] ? ELEMENTS[element].color : 0x94a3b8;
    this.castEffect(source.mesh.position, color, 2.4, 0.5);
  }

  applyWindTick(source, amount, packet, radiusCells) {
    const radius = radiusCells * TILE_SIZE;
    const radiusSq = radius * radius;
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const dx = enemy.mesh.position.x - source.mesh.position.x;
      const dz = enemy.mesh.position.z - source.mesh.position.z;
      if (dx * dx + dz * dz > radiusSq) continue;
      this.damageEnemy(enemy, amount, packet);
    }
    this.castEffect(source.mesh.position, 0x4ade80, radiusCells * 1.2, 0.35);
  }

  applyScorchTick(source, amount, packet, radiusCells) {
    const radius = radiusCells * TILE_SIZE;
    const radiusSq = radius * radius;
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const dx = enemy.mesh.position.x - source.mesh.position.x;
      const dz = enemy.mesh.position.z - source.mesh.position.z;
      if (dx * dx + dz * dz > radiusSq) continue;
      this.damageEnemy(enemy, amount, packet);
    }
    this.castEffect(source.mesh.position, 0xf97316, radiusCells * 1.2, 0.3);
  }

  updateSweepVortices(dt) {
    if (this.sweepVortices.length === 0) return;
    for (let i = this.sweepVortices.length - 1; i >= 0; i--) {
      const vortex = this.sweepVortices[i];
      vortex.timer -= dt;
      while (vortex.timer <= 0 && vortex.ticksLeft > 0) {
        vortex.timer += SWEEP_VORTEX_TICK_SECONDS;
        vortex.ticksLeft--;
        const radiusSq = vortex.radius * vortex.radius;
        for (const enemy of this.enemies) {
          if (enemy.dead) continue;
          const dx = enemy.mesh.position.x - vortex.position.x;
          const dz = enemy.mesh.position.z - vortex.position.z;
          if (dx * dx + dz * dz > radiusSq) continue;
          this.damageEnemy(enemy, vortex.damage, {
            damageType: 'magic',
            element: 'wind',
            attach: 0,
            source: 'sweep',
            reaction: true
          });
        }
        this.castEffect(vortex.position, 0x4ade80, vortex.radius * 0.6, 0.45);
      }
      if (vortex.ticksLeft <= 0) this.sweepVortices.splice(i, 1);
    }
  }

  applyShockTick(source, shock) {
    const radius = 2.5 * TILE_SIZE;
    const radiusSq = radius * radius;
    let count = 0;
    for (const enemy of this.enemies) {
      if (enemy.dead || enemy === source) continue;
      const dx = enemy.mesh.position.x - source.mesh.position.x;
      const dz = enemy.mesh.position.z - source.mesh.position.z;
      if (dx * dx + dz * dz > radiusSq) continue;
      if (enemy.status.attachments.lightning >= 1) count++;
    }
    this.damageEnemy(source, SHOCK_DAMAGE_BASE * (1 + count), {
      damageType: 'physical',
      element: 'lightning',
      attach: 0,
      source: 'shock',
      reaction: true
    });
    this.castEffect(source.mesh.position, 0xfacc15, 1.3 + count * 0.12, 0.32);
  }

  processReactions() {
    if (this.reactionQueue.size === 0) return;
    const queue = [...this.reactionQueue];
    this.reactionQueue.clear();
    for (const enemy of queue) {
      if (enemy.dead) continue;
      const events = resolveReactions(enemy, (source, element) => this.spreadElement(source, element));
      for (const event of events) {
        if (event.type === 'overload') {
          const radiusSq = (event.radius * TILE_SIZE) ** 2;
          for (const target of this.enemies) {
            if (target.dead) continue;
            const dx = target.mesh.position.x - enemy.mesh.position.x;
            const dz = target.mesh.position.z - enemy.mesh.position.z;
            if (dx * dx + dz * dz > radiusSq) continue;
            this.damageEnemy(target, event.damage, {
              damageType: 'physical',
              element: 'fire',
              attach: 0,
              source: 'overload',
              reaction: true
            });
          }
          this.castEffect(enemy.mesh.position, 0xf97316, event.radius * 1.2, 0.5);
          continue;
        }
        if (event.type === 'superconduct') {
          this.damageEnemy(enemy, event.damage, {
            damageType: 'physical',
            element: 'none',
            attach: 0,
            source: 'superconduct',
            reaction: true
          });
          this.castEffect(enemy.mesh.position, 0x93c5fd, 1.8, 0.42);
          continue;
        }
        if (event.type === 'annihilation') {
          const radiusSq = (event.radius * TILE_SIZE) ** 2;
          const targets = [];
          for (const target of this.enemies) {
            if (target.dead) continue;
            const dx = target.mesh.position.x - enemy.mesh.position.x;
            const dz = target.mesh.position.z - enemy.mesh.position.z;
            if (dx * dx + dz * dz <= radiusSq) targets.push(target);
          }
          let highest = null;
          for (const target of targets) {
            if (!highest || target.maxHp > highest.maxHp) highest = target;
          }
          for (const target of targets) {
            const ratio = target === highest ? event.highestTrueRatio : event.otherTrueRatio;
            this.damageEnemy(target, target.maxHp * ratio, {
              damageType: 'magic',
              element: 'none',
              attach: 0,
              source: 'annihilation',
              trueDamage: true
            });
          }
          for (const target of targets) {
            if (target.dead) continue;
            this.damageEnemy(target, event.damage, {
              damageType: 'magic',
              element: 'none',
              attach: 0,
              source: 'annihilation',
              reaction: true
            });
          }
          this.castEffect(enemy.mesh.position, 0xf5d0fe, event.radius * 1.2, 0.55);
          continue;
        }
        if (event.type === 'parallel') {
          const radiusSq = (event.radius * TILE_SIZE) ** 2;
          const targets = [];
          for (const target of this.enemies) {
            if (target.dead) continue;
            const dx = target.mesh.position.x - enemy.mesh.position.x;
            const dz = target.mesh.position.z - enemy.mesh.position.z;
            if (dx * dx + dz * dz <= radiusSq) targets.push(target);
          }
          const damage = event.perTarget * targets.length;
          for (const target of targets) {
            this.damageEnemy(target, damage, {
              damageType: 'magic',
              element: 'lightning',
              attach: 0,
              source: 'parallel',
              reaction: true
            });
          }
          this.castEffect(enemy.mesh.position, 0xfacc15, event.radius * 1.2, 0.45);
          continue;
        }
        if (event.type === 'sweep') {
          const radiusSq = (event.radius * TILE_SIZE) ** 2;
          applySweepResistanceDebuff(enemy);
          for (const target of this.enemies) {
            if (target.dead || target === enemy) continue;
            const dx = target.mesh.position.x - enemy.mesh.position.x;
            const dz = target.mesh.position.z - enemy.mesh.position.z;
            if (dx * dx + dz * dz > radiusSq) continue;
            applySweepResistanceDebuff(target);
            if (event.debuffs.includes('scorch') && !target.status.scorch) {
              target.status.scorch = { tickTimer: SCORCH_TICK_SECONDS };
            }
            if (event.debuffs.includes('drunken')) target.status.drunken = true;
            if (event.debuffs.includes('stasis')) target.status.stasis = true;
            this.castEffect(target.mesh.position, 0xa855f7, 0.9, 0.3);
          }
          this.sweepVortices.push({
            position: enemy.mesh.position.clone(),
            radius: event.radius * TILE_SIZE,
            ticksLeft: SWEEP_VORTEX_TICKS,
            timer: SWEEP_VORTEX_TICK_SECONDS,
            damage: SWEEP_VORTEX_DAMAGE
          });
          this.castEffect(enemy.mesh.position, 0x4ade80, event.radius * 2, 0.45);
          continue;
        }
        if (event.type === 'evaporate') {
          this.damageEnemy(enemy, event.damage, {
            damageType: 'physical',
            element: 'none',
            attach: 0,
            source: 'evaporate',
            reaction: true
          });
          this.castEffect(enemy.mesh.position, 0xbfdbfe, 1.4, 0.4);
          continue;
        }
        if (event.type === 'melt') {
          this.damageEnemy(enemy, event.damage, {
            damageType: 'physical',
            element: 'water',
            attach: 0,
            source: 'melt',
            reaction: true
          });
          this.castEffect(enemy.mesh.position, 0x93c5fd, 1.3, 0.38);
          continue;
        }

        const color =
          event.type === 'melt'
            ? 0xbfdbfe
            : event.type === 'evaporate'
              ? 0x94a3b8
              : event.type === 'condense'
                ? 0x67e8f9
                : event.type === 'shock'
                  ? 0xfacc15
                  : event.type === 'scorch'
                    ? 0xf97316
                    : event.type === 'drunken'
                      ? 0xfb7185
                      : event.type === 'stasis'
                        ? 0x67e8f9
                        : ELEMENTS[event.element]
                          ? ELEMENTS[event.element].color
                          : 0xffffff;
        this.castEffect(enemy.mesh.position, color, 1.3, 0.35);
      }
    }
  }

  findPierceTargets(tower, primary, count) {
    if (count <= 0) return [];
    const dx = primary.mesh.position.x - tower.mesh.position.x;
    const dz = primary.mesh.position.z - tower.mesh.position.z;
    const length = Math.hypot(dx, dz) || 1;
    const dirX = dx / length;
    const dirZ = dz / length;
    const rangeSq = (tower.stats.range * TILE_SIZE) ** 2;
    const targets = [];

    for (const enemy of this.enemies) {
      if (enemy.dead || enemy === primary) continue;
      const ex = enemy.mesh.position.x - tower.mesh.position.x;
      const ez = enemy.mesh.position.z - tower.mesh.position.z;
      if (ex * ex + ez * ez > rangeSq) continue;
      const forward = ex * dirX + ez * dirZ;
      if (forward <= length) continue;
      const side = Math.abs(ex * dirZ - ez * dirX);
      if (side > 0.9 * TILE_SIZE) continue;
      targets.push({ enemy, forward });
    }

    targets.sort((a, b) => a.forward - b.forward);
    return targets.slice(0, count).map((entry) => entry.enemy);
  }

  fire(tower, target) {
    const type = tower.type;
    const stats = tower.stats;
    const origin = this.tmpA.set(
      tower.mesh.position.x,
      tower.mesh.position.y + 0.78,
      tower.mesh.position.z
    );
    const targetPos = this.tmpB.set(
      target.mesh.position.x,
      target.mesh.position.y + target.type.height * 0.5,
      target.mesh.position.z
    );

    const packet = {
      damageType: stats.damageType || 'physical',
      element: stats.element || 'none',
      attach: stats.element && stats.element !== 'none' ? 1 : 0,
      source: stats.id,
      critChance: stats.critChance || 0,
      critDamage: stats.critDamage || 0
    };

    if (stats.splash) {
      const radiusSq = (stats.splash * TILE_SIZE) ** 2;
      for (const enemy of this.enemies) {
        if (enemy.dead) continue;
        const dx = enemy.mesh.position.x - target.mesh.position.x;
        const dz = enemy.mesh.position.z - target.mesh.position.z;
        if (dx * dx + dz * dz <= radiusSq) this.damageEnemy(enemy, stats.damage, packet);
      }
      this.castEffect(target.mesh.position, type.color, stats.splash * 1.6, 0.4);
    } else {
      this.damageEnemy(target, stats.damage, packet);
      if (stats.pierce > 0) {
        for (const enemy of this.findPierceTargets(tower, target, stats.pierce)) {
          this.damageEnemy(enemy, stats.damage, packet);
          this.castEffect(enemy.mesh.position, type.color, 0.45, 0.22);
        }
      }
    }

    this.spawnTracer(origin, targetPos, type.color, type.id === 'cannon' ? 0.12 : 0.06);
  }

  fireMagicTower(tower, target) {
    const rangeSq = (tower.type.recognizeRange * TILE_SIZE) ** 2;
    const elements = [];
    for (const other of this.towers) {
      if (other === tower || !other.type.element || other.type.element === 'none') continue;
      const dx = other.mesh.position.x - tower.mesh.position.x;
      const dz = other.mesh.position.z - tower.mesh.position.z;
      if (dx * dx + dz * dz <= rangeSq) elements.push(other.type.element);
    }
    const attributes = elements.length > 0 ? [...new Set(elements)] : ['none'];

    const origin = tower.mesh.position.clone();
    const position = target.mesh.position.clone();
    const count = tower.type.pickCount || 3;
    const interval = tower.type.castInterval || 0.08;
    for (let i = 0; i < count; i++) {
      this.magicCasts.push({
        time: this.waveClock + i * interval,
        element: attributes[Math.floor(this.rng() * attributes.length)],
        position: position.clone(),
        origin: origin.clone(),
        damage: tower.stats.damage,
        radius: tower.stats.splash,
        critChance: tower.stats.critChance || 0,
        critDamage: tower.stats.critDamage || 0
      });
    }
  }

  updateMagicCasts() {
    if (this.magicCasts.length === 0) return;
    for (let i = this.magicCasts.length - 1; i >= 0; i--) {
      const cast = this.magicCasts[i];
      if (cast.time > this.waveClock) continue;
      this.magicCasts.splice(i, 1);
      const radiusSq = (cast.radius * TILE_SIZE) ** 2;
      for (const enemy of this.enemies) {
        if (enemy.dead) continue;
        const dx = enemy.mesh.position.x - cast.position.x;
        const dz = enemy.mesh.position.z - cast.position.z;
        if (dx * dx + dz * dz > radiusSq) continue;
        this.damageEnemy(enemy, cast.damage, {
          damageType: 'magic',
          element: cast.element,
          attach: cast.element === 'none' ? 0 : 1,
          source: cast.source || 'magic',
          critChance: cast.critChance || 0,
          critDamage: cast.critDamage || 0
        });
      }
      const color = cast.element === 'none' ? 0x818cf8 : ELEMENTS[cast.element].color;
      this.castEffect(cast.position, color, cast.radius * 1.8, 0.38);
      if (cast.kind !== 'cursed') this.spawnTracer(cast.origin, cast.position, color, 0.05);
    }
  }

  fireCursedTower(tower) {
    const recognizeRangeSq = (tower.type.recognizeRange * TILE_SIZE) ** 2;
    const elements = [];
    let consumedHp = 0;
    for (const other of this.towers) {
      const dx = other.mesh.position.x - tower.mesh.position.x;
      const dz = other.mesh.position.z - tower.mesh.position.z;
      if (dx * dx + dz * dz > recognizeRangeSq) continue;
      if (other.type.element && other.type.element !== 'none') elements.push(other.type.element);
      const amount = Math.min(Math.max(0, other.hp - 1), other.hp * tower.type.hpConsumeRatio);
      if (amount > 0) {
        other.hp = Math.max(1, other.hp - amount);
        consumedHp += amount;
        this.castEffect(other.mesh.position, 0x7c3aed, 0.75, 0.25);
      }
    }
    if (this.selectedTower && this.towers.includes(this.selectedTower)) {
      this.updateTowerPanel();
    }

    const attributes = elements.length > 0 ? [...new Set(elements)] : ['none'];
    const lastBonus = consumedHp * tower.type.damagePerHp;
    const origin = tower.mesh.position.clone();
    for (let i = 0; i < tower.type.pickCount; i++) {
      this.magicCasts.push({
        time: this.waveClock + i * tower.type.castInterval,
        element: attributes[Math.floor(this.rng() * attributes.length)],
        position: tower.mesh.position.clone(),
        origin: origin.clone(),
        damage: tower.stats.damage + (i === tower.type.pickCount - 1 ? lastBonus : 0),
        radius: tower.stats.range,
        critChance: tower.stats.critChance || 0,
        critDamage: tower.stats.critDamage || 0,
        source: 'cursed',
        kind: 'cursed'
      });
    }
  }

  updateTowers(dt) {
    for (const tower of this.towers) {
      if (tower.type.support) {
        tower.healTimer -= dt;
        if (tower.healTimer <= 0) {
          tower.healTimer += SUPPLY_UPGRADE.healInterval;
          const aura = tower.stats.auraRange * TILE_SIZE;
          for (const target of this.towers) {
            const dx = target.mesh.position.x - tower.mesh.position.x;
            const dz = target.mesh.position.z - tower.mesh.position.z;
            if (dx * dx + dz * dz > aura * aura) continue;
            target.hp = Math.min(target.maxHp, target.hp + tower.stats.heal);
          }
        }
        continue;
      }

      if (tower.type.coinTower) {
        tower.head.rotation.y += dt * 0.9;
        if (this.waveIndex === 0) {
          tower.cooldown = tower.stats.incomeInterval;
          continue;
        }
        tower.cooldown -= dt;
        if (tower.cooldown <= 0) {
          const overdue = Math.min(0, tower.cooldown);
          tower.cooldown = tower.stats.incomeInterval + overdue;
          if (tower.cooldown <= 0) tower.cooldown = tower.stats.incomeInterval;
          this.gold += tower.stats.income;
          this.castEffect(tower.mesh.position, 0xfacc15, 0.85, 0.3);
          this.updateHud();
        }
        continue;
      }

      tower.cooldown -= dt;
      const target = this.findTarget(tower);
      if (target) {
        const angle = Math.atan2(
          target.mesh.position.x - tower.mesh.position.x,
          target.mesh.position.z - tower.mesh.position.z
        );
        tower.head.rotation.y = dampAngle(tower.head.rotation.y, angle, dt * 14);
        if (tower.cooldown <= 0) {
          if (tower.type.magicTower) this.fireMagicTower(tower, target);
          else if (tower.type.curseTower) this.fireCursedTower(tower);
          else this.fire(tower, target);
          tower.cooldown = 1 / tower.stats.fireRate;
        }
      } else if (tower.type.id === 'frost') {
        tower.head.rotation.y += dt * 0.7;
      }
    }
  }

  updateEnemies(dt) {
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      enemy.age += dt;

      decayStatus(enemy, dt);
      tickBuffs(enemy, dt);
      tickBurning(enemy, dt, (target, amount, packet) => this.damageEnemy(target, amount, packet));
      tickLightning(enemy, dt, (target, amount, packet) => this.damageEnemy(target, amount, packet));
      tickWind(enemy, dt, (target, amount, packet, radius) => this.applyWindTick(target, amount, packet, radius));
      tickShock(enemy, dt, (target, shock) => this.applyShockTick(target, shock));
      tickScorch(enemy, dt, (target, amount, packet, radius) =>
        this.applyScorchTick(target, amount, packet, radius)
      );
      if (enemy.dead) continue;

      const slow = getIceSlowFactor(enemy);
      const speed = enemy.baseSpeed * slow * getStasisMovementFactor(enemy);

      enemy.routeDist += speed * dt;
      enemy.remaining = enemy.routeTotal - enemy.routeDist;
      if (enemy.routeDist >= enemy.routeTotal) {
        if (enemy.noLeak) this.retireEnemy(enemy);
        else this.leakEnemy(enemy);
        continue;
      }

      this.sampleRoute(enemy, this.tmpPos, this.tmpDir);
      const px = this.tmpPos.x - this.tmpDir.z * enemy.offset;
      const pz = this.tmpPos.z + this.tmpDir.x * enemy.offset;
      enemy.mesh.position.set(px, enemy.altitude, pz);
      const yaw = Math.atan2(this.tmpDir.x, this.tmpDir.z);
      enemy.mesh.rotation.y = dampAngle(enemy.mesh.rotation.y, yaw, dt * 9);

      const dominant = dominantElement(enemy);
      if (enemy.flash > 0) {
        enemy.flash -= dt;
        enemy.material.emissive.setHex(0xffffff);
        enemy.material.emissiveIntensity = 1.6;
      } else if (dominant) {
        enemy.material.emissive.setHex(ELEMENTS[dominant].color);
        enemy.material.emissiveIntensity = Math.min(1.4, 0.7 + enemy.status.attachments[dominant] * 0.12);
      } else {
        enemy.material.emissive.setHex(enemy.type.accent);
        enemy.material.emissiveIntensity = 0.65;
      }

      if (enemy.status.reactionCooldown <= 0) {
        const attachments = enemy.status.attachments;
        const total =
          attachments.fire +
          attachments.ice +
          attachments.wind +
          attachments.water +
          attachments.lightning +
          attachments.light +
          attachments.dark;
        if (total > 0) this.reactionQueue.add(enemy);
      }

      const ratio = clamp(enemy.hp / enemy.maxHp, 0, 1);
      enemy.bar.visible = ratio < 1 || enemy.type.id === 'elite';
      if (enemy.bar.visible) {
        enemy.bar.position.set(px, enemy.altitude + enemy.type.height + 0.55, pz);
        enemy.barFill.scale.x = Math.max(0.001, enemy.barWidth * ratio);
        enemy.barFill.position.x = -enemy.barWidth / 2 + (enemy.barWidth * ratio) / 2;
        enemy.barFill.material.color.setHex(ratio > 0.5 ? 0x4ade80 : ratio > 0.25 ? 0xfacc15 : 0xef4444);
      }

      enemy.towerAttackTimer -= dt;
      if (enemy.type.bombard) {
        if (enemy.towerAttackTimer <= 0) {
          const tower = this.findTowerInRange(enemy, enemy.type.bombRange);
          if (tower) {
            this.enemyBombs.push({
              time: this.waveClock + enemy.type.bombTravel,
              source: enemy,
              position: tower.mesh.position.clone(),
              radius: enemy.type.bombRadius,
              damage: enemy.type.bombDamage
            });
            this.spawnTracer(
              enemy.mesh.position,
              tower.mesh.position,
              0xfbbf24,
              0.08
            );
            enemy.towerAttackTimer =
              enemy.type.bombInterval / getStasisAttackFactor(enemy);
          } else {
            enemy.towerAttackTimer = 0.4;
          }
        }
        continue;
      }

      if (enemy.towerAttackTimer <= 0) {
        const tower = this.findTowerInContact(enemy);
        const drunkTarget = enemy.status.drunken ? this.findDrunkenTarget(enemy) : null;
        let attacked = false;
        if (drunkTarget && (!tower || this.rng() < 0.5)) {
          const damage = this.getEnemyAttackDamage(enemy);
          this.damageEnemy(drunkTarget, damage, {
            damageType: 'physical',
            element: 'none',
            attach: 0,
            source: 'drunken'
          });
          this.applyDarkReflect(enemy, damage);
          this.castEffect(drunkTarget.mesh.position, 0xfb7185, 0.9, 0.3);
          attacked = true;
        } else if (tower) {
          this.damageTower(tower, this.getEnemyAttackDamage(enemy), enemy);
          attacked = true;
        }
        enemy.towerAttackTimer = attacked ? this.getEnemyAttackDelay(enemy) : 0.4;
      }
    }
  }

  updateEnemyBombs() {
    if (this.enemyBombs.length === 0) return;
    for (let i = this.enemyBombs.length - 1; i >= 0; i--) {
      const bomb = this.enemyBombs[i];
      if (bomb.time > this.waveClock) continue;
      this.enemyBombs.splice(i, 1);
      const radiusSq = (bomb.radius * TILE_SIZE) ** 2;
      for (const tower of this.towers) {
        const dx = tower.mesh.position.x - bomb.position.x;
        const dz = tower.mesh.position.z - bomb.position.z;
        if (dx * dx + dz * dz > radiusSq) continue;
        this.damageTower(tower, bomb.damage, bomb.source);
      }
      this.castEffect(bomb.position, 0xfbbf24, bomb.radius * 1.8, 0.45);
    }
  }

  leakEnemy(enemy) {
    if (enemy.dead) return;
    enemy.dead = true;
    enemy.leaked = true;
    this.deadEnemies.push(enemy);
    this.lives = Math.max(0, this.lives - enemy.type.leak);
    this.toast(`漏怪 -${enemy.type.leak} 生命`);
    if (this.lives <= 0) this.endGame(false);
  }

  retireEnemy(enemy) {
    if (enemy.dead) return;
    enemy.dead = true;
    enemy.retired = true;
    this.deadEnemies.push(enemy);
    this.castEffect(enemy.mesh.position, 0x93c5fd, 0.8, 0.3);
  }

  processDeaths() {
    if (!this.deadEnemies.length) return;
    const completedStates = new Set();
    for (const enemy of this.deadEnemies) {
      this.scene.remove(enemy.mesh);
      this.scene.remove(enemy.bar);
      enemy.barFill.material.dispose();
      enemy.material.dispose();
      const state = this.waveStates.get(enemy.waveIndex);
      if (state && !state.complete) {
        state.alive = Math.max(0, state.alive - 1);
        completedStates.add(state);
      }
      if (!enemy.leaked && !enemy.retired) {
        this.gold += enemy.reward;
        this.kills++;
        this.score += enemy.type.score || 0;
        this.castEffect(enemy.mesh.position, enemy.type.color, 0.7, 0.32);
      }
    }
    this.deadEnemies.length = 0;
    this.enemies = this.enemies.filter((enemy) => !enemy.dead);
    for (const state of completedStates) this.completeWaveStateIfDone(state);
  }

  completeWaveStateIfDone(state) {
    if (!state || state.complete || state.pending > 0 || state.alive > 0) return;
    if (this.phase === 'won' || this.phase === 'lost') return;
    state.complete = true;
    const bonus = ECONOMY.waveBonusBase + ECONOMY.waveBonusPerWave * state.wave.index;
    this.gold += bonus;
    this.toast(`第 ${state.wave.index} 波完成 +${bonus} 金币`);
    if (!this.modeConfig.endless && this.waveIndex >= this.waves.length) {
      let allComplete = true;
      for (let index = 0; index < this.waves.length; index++) {
        const waveState = this.waveStates.get(index);
        if (!waveState || !waveState.complete) {
          allComplete = false;
          break;
        }
      }
      if (allComplete) {
        this.updateHud();
        this.endGame(true);
        return;
      }
    }
    this.updateHud();
  }

  endGame(win) {
    if (this.phase === 'won' || this.phase === 'lost') return;
    this.phase = win ? 'won' : 'lost';
    if (this.score > this.bestScore) {
      this.bestScore = this.score;
      try {
        localStorage.setItem(this.bestKey, String(this.bestScore));
      } catch {
        // ignore storage failures
      }
    }
    this.updateHud();

    this.dom.overlayEyebrow.textContent = win ? 'VICTORY' : 'DEFEAT';
    this.dom.overlayTitle.textContent = win
      ? '防线守住了'
      : this.modeConfig.endless
        ? '挑战结束'
        : '防线失守';
    const reached = win ? this.waves.length : Math.max(1, this.waveIndex);
    this.dom.overlayDesc.textContent = win
      ? `全部 ${this.waves.length} 波敌人被拦下，这套地图的打法已经成立。`
      : `${this.modeConfig.label} · 抵达第 ${reached} 波，得分 ${this.score}。`;
    this.dom.overlayStats.innerHTML = `
      <span>抵达第 <b>${reached}</b> 波</span>
      <span>得分 <b>${this.score}</b></span>
      <span>最高分 <b>${this.bestScore}</b></span>
      <span>击杀 <b>${this.kills}</b></span>
      <span>建塔 <b>${this.built}</b></span>
      <span>剩余生命 <b>${this.lives}</b></span>`;
    this.dom.overlaySeed.textContent = this.seed;
    this.dom.overlay.classList.remove('hidden');
  }

  update(dt) {
    if (this.phase === 'build' || this.phase === 'combat') {
      this.repairCooldown = Math.max(0, this.repairCooldown - dt);
      if (Number.isFinite(this.prepRemaining)) {
        this.prepRemaining = Math.max(0, this.prepRemaining - dt / Math.max(1, this.speed));
        if (this.prepRemaining <= 0 && this.canStartNextWave()) {
          this.startWave(true);
        }
      }
    }

    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.12;
      this.updateHud();
    }

    if (this.phase === 'build' || this.phase === 'combat') {
      this.waveClock += dt;
      while (this.spawnQueue.length > 0 && this.spawnQueue[0].time <= this.waveClock) {
        const entry = this.spawnQueue.shift();
        this.spawnEnemy(entry.type, entry.spawnIndex, entry.waveIndex);
      }
    }

    this.updateTowers(dt);
    this.updateMagicCasts();
    this.updateEnemies(dt);
    this.updateEnemyBombs();
    this.processReactions();
    this.updateSweepVortices(dt);
    this.processDeaths();
  }

  updateVisuals(dt) {
    this.visualClock += dt;

    for (const tracer of this.tracers) {
      if (tracer.life <= 0) continue;
      tracer.life -= dt;
      if (tracer.life <= 0) {
        tracer.mesh.visible = false;
      } else {
        tracer.mesh.material.opacity = tracer.life / tracer.maxLife;
      }
    }

    for (const effect of this.effects) {
      if (effect.life <= 0) continue;
      effect.life -= dt;
      if (effect.life <= 0) {
        effect.mesh.visible = false;
      } else {
        const t = 1 - effect.life / effect.maxLife;
        effect.mesh.scale.setScalar(0.45 + t * effect.maxScale);
        effect.mesh.material.opacity = 0.9 * (1 - t);
      }
    }

    for (const tower of this.towers) {
      const ratio = clamp(tower.hp / tower.maxHp, 0, 1);
      const show = ratio < 0.999 || this.selectedTower === tower;
      tower.bar.visible = show;
      if (!show) continue;
      tower.bar.position.set(tower.mesh.position.x, 1.95, tower.mesh.position.z);
      tower.bar.quaternion.copy(this.camera.quaternion);
      tower.barFill.scale.x = Math.max(0.001, tower.barWidth * ratio);
      tower.barFill.position.x = -tower.barWidth / 2 + (tower.barWidth * ratio) / 2;
      tower.barFill.material.color.setHex(ratio > 0.5 ? 0x4ade80 : ratio > 0.25 ? 0xfacc15 : 0xef4444);
    }

    let pipIndex = 0;
    for (const enemy of this.enemies) {
      enemy.bar.quaternion.copy(this.camera.quaternion);
      if (enemy.type.id === 'elite') {
        if (enemy.body) enemy.body.rotation.y += dt * 1.4;
      }
      const grow = clamp(0.25 + enemy.age * 5, 0.25, 1) * 1.15;
      enemy.mesh.scale.setScalar(grow);

      const attachments = getVisibleAttachments(enemy).slice(0, 5);
      if (attachments.length === 0) continue;
      const y = 0.14 + enemy.type.height + 0.72;
      attachments.forEach((entry, index) => {
        if (pipIndex >= this.pipMesh.count) return;
        const offset = (index - (attachments.length - 1) / 2) * 0.16;
        this.pipDummy.position.set(enemy.mesh.position.x + offset, y, enemy.mesh.position.z);
        this.pipDummy.scale.setScalar(0.7 + Math.min(1, entry.value / 4) * 0.6);
        this.pipDummy.rotation.set(0, 0, 0);
        this.pipDummy.updateMatrix();
        this.pipMesh.setMatrixAt(pipIndex, this.pipDummy.matrix);
        this.pipMesh.setColorAt(pipIndex, this.pipColor.setHex(entry.color));
        pipIndex++;
      });
    }

    for (let i = pipIndex; i < this.pipCount; i++) {
      this.pipDummy.position.set(0, -100, 0);
      this.pipDummy.scale.setScalar(0);
      this.pipDummy.updateMatrix();
      this.pipMesh.setMatrixAt(i, this.pipDummy.matrix);
    }
    this.pipCount = pipIndex;
    this.pipMesh.instanceMatrix.needsUpdate = true;
    if (this.pipMesh.instanceColor) this.pipMesh.instanceColor.needsUpdate = true;

    const pulse = 1 + Math.sin(this.visualClock * 2.6) * 0.08;
    for (const marker of this.spawnMarkers) {
      marker.userData.ring.scale.setScalar(pulse);
    }
    if (this.goalMarker) this.goalMarker.userData.ring.scale.setScalar(pulse);

    if (this.stars) this.stars.rotation.y += dt * 0.008;

    if (this.selectedTower) {
      this.selectedRing.visible = true;
    }

    if (this.modeConfig.giant) {
      this.minimapTimer -= dt;
      if (this.minimapTimer <= 0) {
        this.minimapTimer = 0.2;
        this.drawMinimap();
      }
    }
  }

  animate(now) {
    requestAnimationFrame(this.animate);
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    dt = Math.min(dt, 0.1);

    if (!this.helpOpen && !this.paused && (this.phase === 'build' || this.phase === 'combat')) {
      this.accumulator += dt * this.speed;
      let steps = 0;
      while (this.accumulator >= STEP && steps < 8) {
        this.update(STEP);
        this.accumulator -= STEP;
        steps++;
      }
      if (steps >= 8) this.accumulator = 0;
    } else {
      this.accumulator = 0;
    }

    this.updatePanFromKeys(dt);
    this.updateVisuals(dt);
    this.renderer.render(this.scene, this.camera);
  }

  disposeObject(root) {
    root.traverse((child) => {
      if (!child.isMesh) return;
      if (child.geometry) child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (material && material.dispose) material.dispose();
      }
    });
  }

  getState() {
    const previewIndex = this.canStartNextWave()
      ? this.waveIndex
      : Math.max(0, this.waves.length - 1);
    const wave = this.waves[Math.min(previewIndex, this.waves.length - 1)];
    const activeSpawns = this.getActiveSpawnIndices();
    return {
      seed: this.seed,
      difficulty: this.difficulty,
      mode: this.mode,
      giant: !!this.modeConfig.giant,
      endless: !!this.modeConfig.endless,
      phase: this.phase,
      wave: Math.max(1, this.waveIndex),
      nextWave: this.waveIndex + 1,
      wavesStarted: this.waveIndex,
      waveCount: this.modeConfig.endless ? null : this.waves.length,
      activeWaves: [...this.waveStates.values()].filter((state) => !state.complete).length,
      prepRemaining: Number(this.prepRemaining.toFixed(1)),
      gold: this.gold,
      lives: this.lives,
      score: this.score,
      bestScore: this.bestScore,
      enemies: this.enemies.length,
      towers: this.towers.length,
      kills: this.kills,
      built: this.built,
      entrances: this.map.metrics.entrances || this.map.paths.length,
      activeSpawns: activeSpawns.length,
      pathLengths: this.map.metrics.pathLengths,
      pathLengthTotal: this.map.metrics.pathLengthTotal,
      uniquePathCells: this.map.metrics.uniquePathCells,
      turnsTotal: this.map.metrics.turnsTotal,
      minCover: this.map.metrics.minCover,
      buildableRatio: this.map.metrics.buildableRatio,
      attempts: this.map.metrics.attempts,
      fallback: this.map.metrics.fallback,
      waveEnemies: waveTotals(wave).count
    };
  }
}
