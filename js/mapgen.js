import { TILE, DIFFICULTIES } from './config.js';
import { makeRng, randInt, shuffle } from './rng.js';

const NEIGHBORS4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
];

export function generateMap(seed, difficultyKey = 'normal') {
  const cfg = DIFFICULTIES[difficultyKey];
  if (!cfg) throw new Error(`Unknown difficulty: ${difficultyKey}`);

  const rng = makeRng(`map|${seed}|${cfg.key}`);
  let fallback = null;
  let attempt = 0;
  const strictLimit = 450;

  for (let i = 0; i < strictLimit; i++) {
    attempt++;
    const candidate = buildPaths(rng, cfg);
    if (!candidate || !meetsShape(candidate, cfg)) continue;
    const map = finalize(candidate, cfg, seed, rng, attempt, false);
    if (map.metrics.ok) return map;
    fallback = map;
  }

  for (let i = 0; i < 300; i++) {
    attempt++;
    const candidate = buildPaths(rng, cfg);
    if (!candidate) continue;
    const map = finalize(candidate, cfg, seed, rng, attempt, true);
    if (map.metrics.ok) return map;
    fallback = map;
  }

  if (!fallback) throw new Error('Map generation failed');
  fallback.metrics.fallback = true;
  return fallback;
}

function meetsShape(candidate, cfg) {
  if (candidate.paths.length !== cfg.entrances) return false;
  for (const entry of candidate.paths) {
    if (entry.length < cfg.minPathLen || entry.length > cfg.maxPathLen) return false;
  }
  if (candidate.turnsTotal < cfg.minTurnsTotal || candidate.turnsTotal > cfg.maxTurnsTotal) {
    return false;
  }
  return true;
}

function splitBands(W, count, gap = 1) {
  const usable = W - 2 - (count - 1) * gap;
  if (usable < count * 5) return null;
  const base = Math.floor(usable / count);
  const remainder = usable - base * count;
  const bands = [];
  let cursor = 1;

  for (let i = 0; i < count; i++) {
    const width = base + (i < remainder ? 1 : 0);
    bands.push({ lo: cursor, hi: cursor + width - 1 });
    cursor += width + gap;
  }
  return bands;
}

function buildPaths(rng, cfg) {
  const { W, H, entrances, mergeRows } = cfg;
  if (entrances < 1) return null;

  const bands = splitBands(W, entrances, cfg.bandGap || 1);
  if (!bands || bands.some((band) => band.hi <= band.lo)) return null;

  const goalX = Math.floor(W / 2);
  const joinSpacing = cfg.joinSpacing || 2;
  const joinRows = [];
  for (let i = 0; i < entrances; i++) {
    const row = H - 2 - i * joinSpacing;
    if (row < 3) return null;
    joinRows.push(row);
  }
  const minJoin = joinRows[joinRows.length - 1];
  if (minJoin < H - 1 - mergeRows) return null;
  const mergeStart = minJoin - 1;
  const protectedRows = new Set();
  for (const row of joinRows) {
    protectedRows.add(row - 1);
    protectedRows.add(row);
    protectedRows.add(row + 1);
  }

  const paths = [];
  let turnsTotal = 0;

  for (let i = 0; i < entrances; i++) {
    const band = bands[i];
    const width = band.hi - band.lo + 1;
    const inset = Math.max(1, Math.floor(width * 0.25));
    const low = Math.min(band.lo + inset, band.hi - inset);
    const high = Math.max(band.lo + inset, band.hi - inset);
    let x = randInt(rng, low, high);
    const startX = x;
    const joinRow = joinRows[i];
    const mainEnd = joinRow - 2;
    const path = [{ x, y: 0 }];
    let lastDir = 0;
    let lastRowHadRun = false;
    let turns = 0;

    for (let y = 1; y <= mainEnd; y++) {
      path.push({ x, y });

      if (lastRowHadRun || protectedRows.has(y) || rng() < cfg.straightChance) {
        lastRowHadRun = false;
        continue;
      }

      let dir = lastDir !== 0 && rng() < cfg.momentum ? lastDir : rng() < 0.5 ? -1 : 1;
      let room = dir > 0 ? band.hi - x : x - band.lo;
      let run = Math.min(1 + Math.floor(rng() * cfg.maxRun), room);

      if (run === 0) {
        dir = -dir;
        room = dir > 0 ? band.hi - x : x - band.lo;
        run = Math.min(1 + Math.floor(rng() * cfg.maxRun), room);
      }

      for (let step = 0; step < run; step++) {
        x += dir;
        path.push({ x, y });
      }

      if (run > 0) {
        if (lastDir !== 0 && dir !== lastDir) turns++;
        lastDir = dir;
        lastRowHadRun = true;
      } else {
        lastRowHadRun = false;
      }
    }

    path.push({ x, y: joinRow - 1 });
    path.push({ x, y: joinRow });
    const dir = Math.sign(goalX - x);
    while (x !== goalX) {
      x += dir;
      path.push({ x, y: joinRow });
    }

    for (let y = joinRow + 1; y < H; y++) {
      path.push({ x: goalX, y });
    }

    const tail = path[path.length - 1];
    if (tail.x !== goalX || tail.y !== H - 1) return null;

    paths.push({
      id: i,
      entrance: { x: startX, y: 0 },
      path,
      length: path.length,
      turns
    });
    turnsTotal += turns;
  }

  const spawns = paths.map((entry) => entry.entrance).sort((a, b) => a.x - b.x);

  return {
    paths,
    spawns,
    goal: { x: goalX, y: H - 1 },
    bands,
    mergeStart,
    joinRows,
    turnsTotal
  };
}

function finalize(candidate, cfg, seed, rng, attempt, relaxed) {
  const { W, H } = cfg;
  const size = W * H;
  const tiles = new Uint8Array(size);
  const uniqueFlags = new Uint8Array(size);
  const index = (x, y) => y * W + x;

  for (const entry of candidate.paths) {
    for (const cell of entry.path) {
      tiles[index(cell.x, cell.y)] = TILE.PATH;
    }
  }

  const crossLinkCount = addCrossLinks(candidate, cfg, rng, tiles, index);

  for (let i = 0; i < size; i++) {
    if (tiles[i] === TILE.PATH) uniqueFlags[i] = 1;
  }

  const uniqueCells = [];
  for (let i = 0; i < size; i++) {
    if (uniqueFlags[i]) uniqueCells.push({ x: i % W, y: (i / W) | 0 });
  }

  const reachable = pathReachability(tiles, W, H, candidate.goal);
  const pathDistance = distanceFromPath(tiles, W, H);
  const rockCandidates = [];
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = index(x, y);
      if (tiles[i] === TILE.EMPTY && pathDistance[i] >= 2) rockCandidates.push({ x, y });
    }
  }

  const wantRocks = Math.round(W * H * cfg.rockRatio);
  let rocks = shuffle(rng, rockCandidates).slice(0, wantRocks);
  for (const rock of rocks) tiles[index(rock.x, rock.y)] = TILE.ROCK;

  const offsets = coverOffsets(cfg.coverRadius);
  let metrics = evaluate(tiles, uniqueCells, W, H, offsets, cfg, relaxed);

  if (!metrics.ok && rocks.length > 0) {
    const keep = Math.floor(rocks.length / 2);
    for (let i = keep; i < rocks.length; i++) {
      tiles[index(rocks[i].x, rocks[i].y)] = TILE.EMPTY;
    }
    rocks = rocks.slice(0, keep);
    metrics = evaluate(tiles, uniqueCells, W, H, offsets, cfg, relaxed);
  }

  if (!metrics.ok && rocks.length > 0) {
    for (const rock of rocks) tiles[index(rock.x, rock.y)] = TILE.EMPTY;
    rocks = [];
    metrics = evaluate(tiles, uniqueCells, W, H, offsets, cfg, relaxed);
  }

  const density = measureDensity(tiles, W, H);
  metrics.maxPath5 = density.max5;
  metrics.pathBlocks2x2 = density.blocks;
  metrics.attempts = attempt;
  metrics.entrances = candidate.paths.length;
  metrics.pathLengths = candidate.paths.map((entry) => entry.length);
  metrics.pathLengthTotal = metrics.pathLengths.reduce((sum, value) => sum + value, 0);
  metrics.uniquePathCells = uniqueCells.length;
  metrics.turnsTotal = candidate.turnsTotal;
  metrics.mergeRows = cfg.mergeRows;
  metrics.rocks = rocks.length;
  metrics.crossLinks = crossLinkCount;
  metrics.pathCellsReachable = reachable;
  metrics.allPathsConnected = reachable === uniqueCells.length;
  if (!metrics.allPathsConnected) metrics.ok = false;
  if (metrics.maxPath5 > cfg.maxPath5 || metrics.pathBlocks2x2 > cfg.maxPathBlocks2x2) {
    metrics.ok = false;
  }

  return {
    seed,
    difficulty: cfg.key,
    W,
    H,
    tiles,
    paths: candidate.paths,
    spawns: candidate.spawns,
    goal: candidate.goal,
    rocks,
    metrics
  };
}

function evaluate(tiles, uniqueCells, W, H, offsets, cfg, relaxed) {
  const index = (x, y) => y * W + x;
  let buildable = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === TILE.EMPTY) buildable++;
  }

  let minCover = Infinity;
  let totalCover = 0;
  const core = new Set();

  for (const cell of uniqueCells) {
    let count = 0;
    for (const [dx, dy] of offsets) {
      const x = cell.x + dx;
      const y = cell.y + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = index(x, y);
      if (tiles[i] === TILE.EMPTY) {
        count++;
        core.add(i);
      }
    }
    if (count < minCover) minCover = count;
    totalCover += count;
  }

  const buildableRatio = buildable / (W * H);
  const metrics = {
    ok: false,
    fallback: false,
    relaxed,
    pathLengths: [],
    pathLengthTotal: 0,
    uniquePathCells: uniqueCells.length,
    turnsTotal: 0,
    entrances: 0,
    mergeRows: 0,
    buildable,
    buildableRatio,
    coreBuildable: core.size,
    minCover,
    avgCover: totalCover / Math.max(1, uniqueCells.length),
    rocks: 0,
    attempts: 0
  };

  metrics.ok =
    minCover >= cfg.minCover &&
    buildableRatio >= cfg.minBuildableRatio &&
    core.size >= uniqueCells.length * 1.2;

  return metrics;
}

function addCrossLinks(candidate, cfg, rng, tiles, index) {
  const count = cfg.crossLinks || 0;
  if (count <= 0 || candidate.paths.length < 2) return 0;

  const rows = candidate.paths.map((entry) => {
    const map = new Map();
    for (const cell of entry.path) {
      if (!map.has(cell.y)) map.set(cell.y, []);
      map.get(cell.y).push(cell.x);
    }
    return map;
  });

  const low = 4;
  const high = candidate.mergeStart - 3;
  if (high <= low) return 0;

  let links = 0;
  for (let i = 0; i < candidate.paths.length - 1; i++) {
    const usedRows = new Set();
    for (let k = 0; k < count; k++) {
      let row = null;
      for (let attempt = 0; attempt < 40; attempt++) {
        const y = randInt(rng, low, high);
        if (usedRows.has(y)) continue;
        let tooClose = false;
        for (const used of usedRows) {
          if (Math.abs(used - y) < 4) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;
        if (!rows[i].has(y) || !rows[i + 1].has(y)) continue;
        const endpointRun =
          rows[i].get(y).length > 1 || rows[i + 1].get(y).length > 1;
        if (endpointRun) continue;
        row = y;
        break;
      }
      if (row === null) break;

      const xsA = rows[i].get(row);
      const xsB = rows[i + 1].get(row);
      const xa = xsA[Math.floor(rng() * xsA.length)];
      const xb = xsB[Math.floor(rng() * xsB.length)];
      const start = Math.min(xa, xb);
      const end = Math.max(xa, xb);
      if (end - start < 2) continue;

      const additions = [];
      for (let x = start; x <= end; x++) {
        const i = index(x, row);
        if (tiles[i] !== TILE.PATH) additions.push(i);
      }
      if (createsSolidBlock(tiles, cfg.W, cfg.H, additions)) continue;

      usedRows.add(row);
      for (const i of additions) tiles[i] = TILE.PATH;
      links++;
    }
  }
  return links;
}

function pathReachability(tiles, W, H, goal) {
  const size = W * H;
  const goalIndex = goal.y * W + goal.x;
  if (tiles[goalIndex] !== TILE.PATH) return 0;

  const seen = new Uint8Array(size);
  const queue = new Int32Array(size);
  let head = 0;
  let tail = 0;
  queue[tail++] = goalIndex;
  seen[goalIndex] = 1;
  let count = 0;

  while (head < tail) {
    const current = queue[head++];
    count++;
    const x = current % W;
    const y = (current / W) | 0;
    for (const [dx, dy] of NEIGHBORS4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (seen[ni] || tiles[ni] !== TILE.PATH) continue;
      seen[ni] = 1;
      queue[tail++] = ni;
    }
  }

  return count;
}

function distanceFromPath(tiles, W, H) {
  const size = W * H;
  const dist = new Int16Array(size);
  dist.fill(32767);
  const queue = new Int32Array(size);
  let head = 0;
  let tail = 0;

  for (let i = 0; i < size; i++) {
    if (tiles[i] === TILE.PATH) {
      dist[i] = 0;
      queue[tail++] = i;
    }
  }

  while (head < tail) {
    const current = queue[head++];
    const x = current % W;
    const y = (current / W) | 0;
    const nextDist = dist[current] + 1;
    for (const [dx, dy] of NEIGHBORS4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (dist[ni] > nextDist) {
        dist[ni] = nextDist;
        queue[tail++] = ni;
      }
    }
  }

  return dist;
}

function createsSolidBlock(tiles, W, H, additions) {
  if (additions.length === 0) return false;
  const added = new Set(additions);
  const isPath = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const i = y * W + x;
    return tiles[i] === TILE.PATH || added.has(i);
  };

  for (const i of additions) {
    const x = i % W;
    const y = (i / W) | 0;
    for (const [ax, ay] of [[x - 1, y - 1], [x, y - 1], [x - 1, y], [x, y]]) {
      if (ax < 0 || ay < 0 || ax + 1 >= W || ay + 1 >= H) continue;
      if (isPath(ax, ay) && isPath(ax + 1, ay) && isPath(ax, ay + 1) && isPath(ax + 1, ay + 1)) {
        return true;
      }
    }
  }
  return false;
}

function measureDensity(tiles, W, H) {
  let blocks = 0;
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      if (
        tiles[y * W + x] === TILE.PATH &&
        tiles[y * W + x + 1] === TILE.PATH &&
        tiles[(y + 1) * W + x] === TILE.PATH &&
        tiles[(y + 1) * W + x + 1] === TILE.PATH
      ) {
        blocks++;
      }
    }
  }

  let max5 = 0;
  for (let y = 0; y <= H - 5; y++) {
    for (let x = 0; x <= W - 5; x++) {
      let count = 0;
      for (let dy = 0; dy < 5; dy++) {
        for (let dx = 0; dx < 5; dx++) {
          if (tiles[(y + dy) * W + x + dx] === TILE.PATH) count++;
        }
      }
      if (count > max5) max5 = count;
    }
  }
  return { max5, blocks };
}

function coverOffsets(radius) {
  const limit = Math.ceil(radius);
  const offsets = [];
  for (let dy = -limit; dy <= limit; dy++) {
    for (let dx = -limit; dx <= limit; dx++) {
      if (dx * dx + dy * dy <= radius * radius) offsets.push([dx, dy]);
    }
  }
  return offsets;
}
