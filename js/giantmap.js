import { DIFFICULTIES, TILE } from './config.js';
import { makeRng, shuffle } from './rng.js';

const NEIGHBORS4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
];

export function generateGiantMap(seed, difficultyKey = 'normal') {
  const rng = makeRng(`giant|${seed}|${difficultyKey}`);
  const W = 201;
  const H = 201;
  const step = 8;
  const start = 4;
  const cx = 100;
  const cy = 100;
  const tiles = new Uint8Array(W * H);
  const index = (x, y) => y * W + x;

  const nodes = [];
  for (let y = start; y <= H - 3; y += step) {
    for (let x = start; x <= W - 3; x += step) {
      nodes.push({ id: nodes.length, x, y });
    }
  }
  const cols = Math.floor((W - 3 - start) / step) + 1;
  const rows = Math.floor((H - 3 - start) / step) + 1;

  const edges = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const id = row * cols + col;
      if (col < cols - 1) edges.push({ a: nodes[id], b: nodes[id + 1] });
      if (row < rows - 1) edges.push({ a: nodes[id], b: nodes[id + cols] });
    }
  }

  const shuffled = shuffle(rng, edges);
  const parent = new Int32Array(nodes.length);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (value) => {
    let root = value;
    while (parent[root] !== root) root = parent[root];
    while (parent[value] !== value) {
      const next = parent[value];
      parent[value] = root;
      value = next;
    }
    return root;
  };
  const unite = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return false;
    parent[ra] = rb;
    return true;
  };

  const chosen = [];
  let treeCount = 0;
  for (const edge of shuffled) {
    if (unite(edge.a.id, edge.b.id)) {
      chosen.push(edge);
      treeCount++;
      if (treeCount === nodes.length - 1) break;
    }
  }
  for (const edge of shuffled) {
    if (chosen.includes(edge)) continue;
    if (rng() < 0.32) chosen.push(edge);
  }

  for (const edge of chosen) {
    drawRoad(tiles, W, index, edge.a, edge.b, rng);
  }

  for (let y = cy - 1; y <= cy + 1; y++) {
    for (let x = cx - 1; x <= cx + 1; x++) {
      tiles[index(x, y)] = TILE.PATH;
    }
  }

  const candidates = nodes.filter((node) => {
    const distance = Math.hypot(node.x - cx, node.y - cy);
    return distance >= 16 && distance <= 92 && !(node.x === cx && node.y === cy);
  });

  const rings = [
    { radius: 18, count: 6 },
    { radius: 34, count: 10 },
    { radius: 50, count: 12 },
    { radius: 68, count: 16 },
    { radius: 86, count: 20 }
  ];
  const strongholds = [];
  const used = new Set();

  for (const ring of rings) {
    for (let slot = 0; slot < ring.count; slot++) {
      const targetAngle = (slot / ring.count) * Math.PI * 2 - Math.PI;
      let best = null;
      let bestScore = Infinity;
      for (const node of candidates) {
        if (used.has(node.id)) continue;
        const angle = Math.atan2(node.y - cy, node.x - cx);
        let diff = Math.abs(angle - targetAngle);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;
        const distance = Math.hypot(node.x - cx, node.y - cy);
        const score = diff * 100 + Math.abs(distance - ring.radius) * 2;
        if (score < bestScore) {
          bestScore = score;
          best = node;
        }
      }
      if (best) {
        used.add(best.id);
        strongholds.push(best);
      }
    }
  }

  for (const node of candidates) {
    if (strongholds.length >= 64) break;
    if (used.has(node.id)) continue;
    used.add(node.id);
    strongholds.push(node);
  }

  strongholds.sort(
    (a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy)
  );

  const strongholdRate = DIFFICULTIES[difficultyKey]?.giantStrongholdRate || 1;
  for (let i = 0; i < strongholds.length; i++) {
    const stronghold = strongholds[i];
    stronghold.unlockWave = 1 + Math.floor(i / strongholdRate);
    stronghold.distance = Math.round(Math.hypot(stronghold.x - cx, stronghold.y - cy));
    tiles[index(stronghold.x, stronghold.y)] = TILE.PATH;
  }

  const uniqueCells = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (tiles[index(x, y)] === TILE.PATH) uniqueCells.push({ x, y });
    }
  }

  const distanceField = distanceFromPath(tiles, W, H, index);
  const rockCandidates = [];
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (tiles[index(x, y)] !== TILE.EMPTY) continue;
      if (distanceField[index(x, y)] >= 2) rockCandidates.push({ x, y });
    }
  }

  let rocks = shuffle(rng, rockCandidates).slice(0, Math.round(W * H * 0.014));
  for (const rock of rocks) tiles[index(rock.x, rock.y)] = TILE.ROCK;

  const offsets = coverOffsets(2.45);
  let metrics = evaluate(tiles, uniqueCells, W, H, offsets, index);

  if (!metrics.ok && rocks.length > 0) {
    for (const rock of rocks) tiles[index(rock.x, rock.y)] = TILE.EMPTY;
    rocks = [];
    metrics = evaluate(tiles, uniqueCells, W, H, offsets, index);
  }

  const reachable = pathReachability(tiles, W, H, { x: cx, y: cy }, index);
  metrics.entrances = strongholds.length;
  metrics.pathLengths = [];
  metrics.pathLengthTotal = 0;
  metrics.turnsTotal = 0;
  metrics.uniquePathCells = uniqueCells.length;
  metrics.crossLinks = 0;
  metrics.pathCellsReachable = reachable;
  metrics.allPathsConnected = reachable === uniqueCells.length;
  metrics.rocks = rocks.length;
  metrics.giant = true;
  if (!metrics.allPathsConnected) metrics.ok = false;

  return {
    seed,
    difficulty: difficultyKey,
    giant: true,
    W,
    H,
    tiles,
    paths: [],
    spawns: strongholds.map((stronghold) => ({ x: stronghold.x, y: stronghold.y })),
    strongholds,
    goal: { x: cx, y: cy },
    rocks,
    metrics
  };
}

function drawRoad(tiles, W, index, a, b, rng) {
  const horizontalFirst = rng() < 0.5;
  if (horizontalFirst) {
    for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) tiles[index(x, a.y)] = TILE.PATH;
    for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) tiles[index(b.x, y)] = TILE.PATH;
  } else {
    for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) tiles[index(a.x, y)] = TILE.PATH;
    for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) tiles[index(x, b.y)] = TILE.PATH;
  }
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

function evaluate(tiles, uniqueCells, W, H, offsets, index) {
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
    minCover = Math.min(minCover, count);
    totalCover += count;
  }

  const buildableRatio = buildable / (W * H);
  return {
    ok:
      minCover >= 2 &&
      buildableRatio >= 0.45 &&
      core.size >= uniqueCells.length * 1.2,
    minCover,
    avgCover: totalCover / Math.max(1, uniqueCells.length),
    buildable,
    buildableRatio,
    coreBuildable: core.size,
    rocks: 0
  };
}

function distanceFromPath(tiles, W, H, index) {
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

function pathReachability(tiles, W, H, goal, index) {
  const size = W * H;
  const goalIndex = index(goal.x, goal.y);
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
