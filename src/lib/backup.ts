import type { DiaryCache, Entry } from "../types.ts";

export interface BackupEntry extends Omit<Entry, "images"> {
  images: string[]; // data URLs
}
export interface Backup {
  version: 1;
  exportedAt: string;
  entries: BackupEntry[];
  diaries: DiaryCache[];
}

export async function blobToDataUrl(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${b.type || "application/octet-stream"};base64,${btoa(bin)}`;
}

export function dataUrlToBlob(u: string): Blob {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(u);
  if (!m) throw new Error("bad data url");
  const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

export async function packBackup(entries: Entry[], diaries: DiaryCache[], now = new Date()): Promise<Backup> {
  const out: BackupEntry[] = [];
  for (const e of entries) out.push({ ...e, images: await Promise.all(e.images.map(blobToDataUrl)) });
  return { version: 1, exportedAt: now.toISOString(), entries: out, diaries };
}

const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Returns null when the text is not a valid backup. */
export function parseBackup(text: string): Backup | null {
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    return null;
  }
  if (!j || j.version !== 1 || !Array.isArray(j.entries) || !Array.isArray(j.diaries) || !isStr(j.exportedAt)) return null;
  for (const e of j.entries) {
    if (!e || !isStr(e.id) || !isStr(e.day) || !isNum(e.createdAt) || !isNum(e.order) || !isStr(e.raw)) return null;
    if (!(e.short === null || isStr(e.short))) return null;
    if (!Array.isArray(e.images) || !e.images.every((u: unknown) => isStr(u) && u.startsWith("data:"))) return null;
  }
  for (const d of j.diaries) if (!d || !isStr(d.day) || !isStr(d.hash) || !isStr(d.text)) return null;
  return j as Backup;
}

export interface MergePlan {
  newEntries: Entry[];
  newDiaries: DiaryCache[];
}

/** Merge by id / day: existing records are never overwritten or removed. */
export function planMerge(b: Backup, existingIds: Set<string>, existingDiaryDays: Set<string>): MergePlan {
  const newEntries = b.entries
    .filter((e) => !existingIds.has(e.id))
    .map((e) => ({ ...e, images: e.images.map(dataUrlToBlob) }));
  const newDiaries = b.diaries.filter((d) => !existingDiaryDays.has(d.day));
  return { newEntries, newDiaries };
}
