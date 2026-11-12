export interface Cell {
  x: number;
  y: number;
}

/** cyrb53-style string hash -> 32-bit unsigned. */
export function hashSeed(str: string): number {
  let h1 = 0xdeadbeef,
    h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0) ^ (h1 >>> 0);
}

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic polyomino growth. Block k depends only on (seed, k):
 * one RNG draw per step, candidates in a canonical order. Hence the first n
 * blocks of growShape(seed, m) for any m>=n equal growShape(seed, n).
 */
export function growShape(seed: string, n: number): Cell[] {
  if (n <= 0) return [];
  const rng = mulberry32(hashSeed(seed));
  const cells: Cell[] = [{ x: 0, y: 0 }];
  const occ = new Set<string>(["0,0"]);
  const key = (x: number, y: number) => `${x},${y}`;
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (let k = 1; k < n; k++) {
    const cand = new Map<string, { x: number; y: number; w: number }>();
    for (const c of cells) {
      for (const [dx, dy] of dirs) {
        const x = c.x + dx,
          y = c.y + dy,
          kk = key(x, y);
        if (occ.has(kk)) continue;
        const e = cand.get(kk);
        if (e) e.w += 1;
        else cand.set(kk, { x, y, w: 1 });
      }
    }
    const list = [...cand.values()].sort((a, b) => a.y - b.y || a.x - b.x);
    // more occupied neighbours -> more likely: keeps shapes blobby
    const weights = list.map((c) => c.w * c.w);
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rng() * total;
    let pick = list[list.length - 1];
    for (let i = 0; i < list.length; i++) {
      r -= weights[i];
      if (r < 0) {
        pick = list[i];
        break;
      }
    }
    cells.push({ x: pick.x, y: pick.y });
    occ.add(key(pick.x, pick.y));
  }
  return cells;
}
