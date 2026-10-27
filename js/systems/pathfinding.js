class MinHeap {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(cost, value) {
    const items = this.items;
    items.push({ cost, value });
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (items[parent].cost <= items[index].cost) break;
      [items[parent], items[index]] = [items[index], items[parent]];
      index = parent;
    }
  }

  pop() {
    const items = this.items;
    if (items.length === 0) return null;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0) {
      items[0] = last;
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < items.length && items[left].cost < items[smallest].cost) smallest = left;
        if (right < items.length && items[right].cost < items[smallest].cost) smallest = right;
        if (smallest === index) break;
        [items[index], items[smallest]] = [items[smallest], items[index]];
        index = smallest;
      }
    }
    return top;
  }
}

const NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
];

export function buildPathGraph(tiles, W, H, goal) {
  const size = W * H;
  const indexAt = new Int32Array(size);
  indexAt.fill(-1);
  const cells = [];

  for (let i = 0; i < size; i++) {
    if (tiles[i] !== 1) continue;
    indexAt[i] = cells.length;
    cells.push({ x: i % W, y: (i / W) | 0 });
  }

  const neighbors = new Array(cells.length);
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const list = [];
    for (const [dx, dy] of NEIGHBORS) {
      const x = cell.x + dx;
      const y = cell.y + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const next = indexAt[y * W + x];
      if (next >= 0) list.push(next);
    }
    neighbors[i] = list;
  }

  const goalIndex = indexAt[goal.y * W + goal.x];
  const distance = new Int32Array(cells.length);
  distance.fill(-1);
  if (goalIndex >= 0) {
    const queue = new Int32Array(cells.length);
    let head = 0;
    let tail = 0;
    distance[goalIndex] = 0;
    queue[tail++] = goalIndex;
    while (head < tail) {
      const current = queue[head++];
      for (const next of neighbors[current]) {
        if (distance[next] >= 0) continue;
        distance[next] = distance[current] + 1;
        queue[tail++] = next;
      }
    }
  }

  return {
    W,
    H,
    cells,
    indexAt,
    neighbors,
    distance,
    goalIndex
  };
}

export function findRoute(graph, startIndex, rng, options = {}) {
  const { detour = false, detourWeight = 2.5 } = options;
  if (startIndex < 0 || graph.goalIndex < 0) return null;
  if (graph.distance[startIndex] < 0) return null;
  if (startIndex === graph.goalIndex) return [startIndex];

  if (!detour) {
    const route = [startIndex];
    let current = startIndex;
    let guard = 0;
    while (current !== graph.goalIndex && guard++ < 10000) {
      const candidates = [];
      for (const next of graph.neighbors[current]) {
        if (graph.distance[next] === graph.distance[current] - 1) candidates.push(next);
      }
      if (candidates.length === 0) return null;
      current = candidates[Math.floor(rng() * candidates.length)];
      route.push(current);
    }
    return route;
  }

  const size = graph.cells.length;
  const cost = new Float64Array(size);
  cost.fill(Infinity);
  const previous = new Int32Array(size);
  previous.fill(-1);
  const heap = new MinHeap();
  cost[startIndex] = 0;
  heap.push(0, startIndex);

  while (heap.size > 0) {
    const entry = heap.pop();
    if (!entry) break;
    const current = entry.value;
    if (entry.cost > cost[current]) continue;
    if (current === graph.goalIndex) break;
    for (const next of graph.neighbors[current]) {
      const weight = 1 + rng() * detourWeight;
      const nextCost = entry.cost + weight;
      if (nextCost < cost[next]) {
        cost[next] = nextCost;
        previous[next] = current;
        heap.push(nextCost, next);
      }
    }
  }

  if (previous[graph.goalIndex] < 0 && graph.goalIndex !== startIndex) return null;
  const route = [graph.goalIndex];
  let current = graph.goalIndex;
  let guard = 0;
  while (current !== startIndex && guard++ < 10000) {
    current = previous[current];
    if (current < 0) return null;
    route.push(current);
  }
  route.reverse();
  return route;
}
