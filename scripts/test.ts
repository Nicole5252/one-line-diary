import assert from "node:assert/strict";
import { growShape } from "../src/lib/blocks.ts";
import { dayKey } from "../src/lib/day.ts";

const connected = (cells: { x: number; y: number }[]) => {
  const set = new Set(cells.map((c) => `${c.x},${c.y}`));
  const seen = new Set<string>([`${cells[0].x},${cells[0].y}`]);
  const q = [cells[0]];
  while (q.length) {
    const c = q.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${c.x + dx},${c.y + dy}`;
      if (set.has(k) && !seen.has(k)) {
        seen.add(k);
        q.push({ x: c.x + dx, y: c.y + dy });
      }
    }
  }
  return seen.size === cells.length;
};

// blocks
const day = "2026-11-11";
assert.deepEqual(growShape(day, 12), growShape(day, 12));
console.log("PASS same date + same n -> identical");
for (let n = 1; n <= 30; n++) {
  const a = growShape(day, n), b = growShape(day, n + 1);
  assert.equal(a.length, n);
  assert.equal(b.length, n + 1);
  assert.deepEqual(b.slice(0, n), a);
  assert.ok(connected(b));
  assert.equal(new Set(b.map((c) => `${c.x},${c.y}`)).size, n + 1);
}
console.log("PASS n=1..30: prefix of n+1 equals n, 4-connected, no overlaps");
const sigs = new Set<string>();
for (let d = 1; d <= 20; d++) sigs.add(JSON.stringify(growShape(`2026-11-${String(d).padStart(2, "0")}`, 12)));
assert.equal(sigs.size, 20);
console.log("PASS 20 different dates -> 20 different shapes (n=12)");

// day boundary
const k = (h: number, m: number) => dayKey(new Date(2026, 10, 11, h, m));
assert.equal(k(3, 59), "2026-11-10");
assert.equal(k(4, 0), "2026-11-11");
assert.equal(k(0, 0), "2026-11-10");
assert.equal(k(23, 59), "2026-11-11");
assert.equal(dayKey(new Date(2026, 0, 1, 2, 0)), "2025-12-31");
console.log("PASS 03:59 -> 2026-11-10, 04:00 -> 2026-11-11, 00:00 -> prev day, 01-01 02:00 -> 2025-12-31");

// backup round trip
import { packBackup, parseBackup, planMerge } from "../src/lib/backup.ts";
{
  const img = new Blob([new Uint8Array([0, 1, 2, 250, 255, 7])], { type: "image/jpeg" });
  const es = [
    { id: "a", day: "2026-11-11", createdAt: 1, order: 0, raw: "原文 a", short: null as string | null, images: [img] },
    { id: "b", day: "2026-11-12", createdAt: 2, order: 1, raw: "b", short: "b", images: [] as Blob[] },
  ];
  const di = [{ day: "2026-11-11", hash: "h", text: "日記" }];
  const text = JSON.stringify(await packBackup(es, di, new Date(0)));
  const back = parseBackup(text)!;
  assert.ok(back && back.version === 1 && back.exportedAt === "1970-01-01T00:00:00.000Z");
  const plan = planMerge(back, new Set(), new Set());
  assert.equal(plan.newEntries.length, 2);
  for (const [i, e] of plan.newEntries.entries()) {
    const o = es[i];
    assert.deepEqual({ ...e, images: undefined }, { ...o, images: undefined });
    assert.equal(e.images.length, o.images.length);
  }
  assert.deepEqual([...new Uint8Array(await plan.newEntries[0].images[0].arrayBuffer())], [0, 1, 2, 250, 255, 7]);
  assert.equal(plan.newEntries[0].images[0].type, "image/jpeg");
  assert.deepEqual(plan.newDiaries, di);
  console.log("PASS backup round trip: fields equal, image bytes + type preserved");
  const p2 = planMerge(back, new Set(["a"]), new Set(["2026-11-11"]));
  assert.deepEqual(p2.newEntries.map((e) => e.id), ["b"]);
  assert.equal(p2.newDiaries.length, 0);
  console.log("PASS existing id/day skipped, not overwritten");
  for (const bad of ["", "not json", "{}", "[]", JSON.stringify({ ...back, version: 2 }), JSON.stringify({ ...back, entries: [{ id: 1 }] }),
    JSON.stringify({ ...back, entries: [{ ...back.entries[0], images: ["http://x"] }] })])
    assert.equal(parseBackup(bad), null);
  console.log("PASS malformed backups rejected");
}
