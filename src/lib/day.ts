export const DAY_START_HOUR = 4;

const pad = (n: number) => String(n).padStart(2, "0");

/** Local-time day key; the day rolls over at 04:00. */
export function dayKey(d: Date = new Date()): string {
  const s = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    d.getHours() - DAY_START_HOUR,
    d.getMinutes(),
  );
  return `${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}`;
}

export function parseDayKey(k: string): Date {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function formatDayLabel(k: string): string {
  const d = parseDayKey(k);
  return `${d.getMonth() + 1}月${d.getDate()}日 週${"日一二三四五六"[d.getDay()]}`;
}
