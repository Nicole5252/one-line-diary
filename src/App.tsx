import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { animate, motion, useMotionValue } from "motion/react";
import type { Entry } from "./types.ts";
import { dayKey, formatDayLabel, parseDayKey } from "./lib/day.ts";
import { hashString, uid } from "./lib/hash.ts";
import { loadAllDiaries, loadDiary, loadEntries, removeEntry, saveDiary, saveEntry } from "./lib/db.ts";
import { diary as aiDiary, getKey, setKey, shorten } from "./lib/ai.ts";
import { packBackup, parseBackup, planMerge } from "./lib/backup.ts";
import { KeyInput } from "./components/KeyInput.tsx";
import { Tools } from "./components/Tools.tsx";
import { shrinkImage } from "./lib/image.ts";
import { EntryItem, REVEAL_W, slideTo } from "./components/EntryItem.tsx";
import { AutoTextarea } from "./components/AutoTextarea.tsx";
import { Shape } from "./components/Shape.tsx";

const SPRING = { type: "spring", stiffness: 260, damping: 30 } as const;
const PAGE_SPRING = { type: "spring", stiffness: 320, damping: 36 } as const;
const COMPOSER_H = 126;
const PULL_COMMIT = 60;
const LONG_MS = 550;

type Mode = "day" | "overview" | "entering";
type Phase = "idle" | "pending" | "none" | "hpage" | "swipe" | "pull" | "drag" | "pinch";
type DiaryState = { status: "idle" | "loading" | "ok" | "no-key" | "error"; text: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const charLen = (s: string) => [...s].length;
const byOrder = (a: Entry, b: Entry) => a.order - b.order || a.createdAt - b.createdAt;
const damp = (d: number, lim: number) => Math.sign(d) * lim * (1 - Math.exp(-Math.abs(d) / lim));

export function App() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [viewDay, setViewDay] = useState(() => dayKey());
  const [index, setIndexState] = useState(1);
  const [mode, setMode] = useState<Mode>("day");
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [settling, setSettling] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [size, setSize] = useState({ W: window.innerWidth, H: window.innerHeight });
  const [diaryState, setDiaryState] = useState<DiaryState>({ status: "idle", text: "" });
  const [hasKey, setHasKey] = useState(() => !!getKey());
  const [diaryNonce, setDiaryNonce] = useState(0);
  const [keyEditing, setKeyEditing] = useState(false);

  // composer
  const [pulling, setPulling] = useState(false);
  const [composing, setComposing] = useState(false);
  const [composerAuto, setComposerAuto] = useState(false);
  const [text, setText] = useState("");
  const [imgs, setImgs] = useState<Blob[]>([]);
  const [hint, setHint] = useState(false);
  const [selBlock, setSelBlock] = useState<number | null>(null);
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const composeH = useMotionValue(0);
  const composeStart = useRef(0);

  const { W, H } = size;
  const pageX = useMotionValue(-W);
  const wx = useMotionValue(0);
  const wy = useMotionValue(0);
  const ws = useMotionValue(1);

  const rootRef = useRef<HTMLDivElement>(null);
  const pageEls = useRef<(HTMLDivElement | null)[]>([null, null, null]);
  const busy = useRef(false);
  const persistTimers = useRef<Record<string, number>>({});

  const today = dayKey();
  const dayEntries = useMemo(() => entries.filter((e) => e.day === viewDay).sort(byOrder), [entries, viewDay]);
  const byCreated = useMemo(
    () => [...dayEntries].sort((a, b) => a.createdAt - b.createdAt),
    [dayEntries],
  );

  // snapshot for the (stable) native gesture handlers
  const S = useRef({ index, mode, composing, pulling, viewDay, W, H, dayEntries, expandedId, revealedId });
  S.current = { index, mode, composing, pulling, viewDay, W, H, dayEntries, expandedId, revealedId };

  const entriesRef = useRef<Entry[]>([]);
  entriesRef.current = entries;

  /* ---------- load ---------- */
  useEffect(() => {
    loadEntries()
      .then((es) => {
        setEntries(es);
        setLoaded(true);
        entriesRef.current = es;
        // fill in shortening for anything left unfinished (no key yet, failed, or page closed mid-flight)
        void backfill();
      })
      .catch(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onR = () => setSize({ W: window.innerWidth, H: window.innerHeight });
    window.addEventListener("resize", onR);
    return () => window.removeEventListener("resize", onR);
  }, []);
  useEffect(() => {
    pageX.set(-index * W);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [W]);

  // leaving the blocks page / switching day clears the block selection;
  // composing, pulling, paging, or leaving day mode retracts a revealed delete
  useEffect(() => {
    setSelBlock(null);
  }, [index, viewDay]);
  useEffect(() => {
    if (composing || pulling || index !== 1 || mode !== "day") setRevealedId(null);
  }, [composing, pulling, index, mode, viewDay]);

  /* ---------- entry mutations ---------- */
  const patchEntry = useCallback((id: string, patch: Partial<Entry>, persist = true) => {
    let next: Entry | undefined;
    setEntries((prev) =>
      prev.map((e) => {
        if (e.id !== id) return e;
        next = { ...e, ...patch };
        return next;
      }),
    );
    if (persist) {
      window.clearTimeout(persistTimers.current[id]);
      persistTimers.current[id] = window.setTimeout(() => {
        // read latest from state via functional no-op
        setEntries((prev) => {
          const cur = prev.find((e) => e.id === id);
          if (cur) void saveEntry(cur);
          return prev;
        });
      }, 350);
    }
  }, []);

  const deleteEntry = useCallback((id: string) => {
    setEntries((p) => p.filter((e) => e.id !== id));
    setExpandedId(null);
    setRevealedId(null);
    void removeEntry(id);
  }, []);

  const runShorten = useCallback(
    async (id: string, raw: string, withDelay: boolean) => {
      const [res] = await Promise.all([shorten(raw), withDelay ? sleep(1500) : Promise.resolve()]);
      // no key / failure leaves short null (shown as raw); retried later. Never overwrite a manual edit.
      const cur = entriesRef.current.find((e) => e.id === id);
      if (res.status === "ok" && cur && cur.short === null) {
        const t = res.text.trim();
        patchEntry(id, { short: t && charLen(t) < charLen(raw) ? t : raw });
      }
      setSettling((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    },
    [patchEntry],
  );

  // one at a time, so a pile of old entries never turns into parallel API calls
  const backfilling = useRef(false);
  const backfill = useCallback(async () => {
    if (backfilling.current) return;
    backfilling.current = true;
    try {
      const todo = entriesRef.current.filter((e) => e.short === null && charLen(e.raw) > 20).map((e) => e.id);
      for (const id of todo) {
        if (!getKey()) break;
        const cur = entriesRef.current.find((e) => e.id === id);
        if (!cur || cur.short !== null) continue;
        await runShorten(id, cur.raw, false);
      }
    } finally {
      backfilling.current = false;
    }
  }, [runShorten]);

  const onKey = useCallback(
    (k: string) => {
      setKey(k);
      setHasKey(!!getKey());
      setKeyEditing(false);
      setDiaryNonce((n) => n + 1);
      void backfill();
    },
    [backfill],
  );

  /* ---------- backup ---------- */
  const doExport = useCallback(async (): Promise<string> => {
    try {
      const b = await packBackup(entriesRef.current, await loadAllDiaries());
      const name = `one-line-backup-${new Date().toISOString().slice(0, 10)}.json`;
      const file = new File([JSON.stringify(b)], name, { type: "application/json" });
      const nav = navigator as Navigator;
      if (nav.canShare?.({ files: [file] })) {
        try {
          await nav.share({ files: [file] });
          return `已匯出 ${b.entries.length} 筆`;
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") return "";
          /* otherwise fall back to download */
        }
      }
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      return `已匯出 ${b.entries.length} 筆`;
    } catch {
      return "匯出失敗";
    }
  }, []);

  const doImport = useCallback(async (f: File): Promise<string> => {
    try {
      const b = parseBackup(await f.text());
      if (!b) return "檔案格式不符";
      const diaries = await loadAllDiaries();
      const plan = planMerge(b, new Set(entriesRef.current.map((e) => e.id)), new Set(diaries.map((d) => d.day)));
      for (const e of plan.newEntries) await saveEntry(e);
      for (const d of plan.newDiaries) await saveDiary(d);
      if (plan.newEntries.length) setEntries((p) => [...p, ...plan.newEntries]);
      void backfill();
      return `已匯入 ${plan.newEntries.length} 筆`;
    } catch {
      return "檔案格式不符";
    }
  }, [backfill]);

  /* ---------- composer ---------- */
  const closeComposer = useCallback(async () => {
    taRef.current?.blur();
    setComposing(false);
    composeH.set(composerAuto ? (document.querySelector(".ol-composer") as HTMLElement | null)?.offsetHeight ?? COMPOSER_H : composeH.get());
    setComposerAuto(false);
    // clear right away: if the composer is reopened while it is still collapsing,
    // a late reset would leak the old text into (or wipe) the next entry
    setText("");
    setImgs([]);
    await animate(composeH, 0, SPRING);
    if (!S.current.composing) setPulling(false);
  }, [composeH, composerAuto]);

  const finish = useCallback(() => {
    const t = text.trim();
    if (!t && imgs.length === 0) {
      void closeComposer();
      return;
    }
    if (!t) {
      setHint(true);
      setTimeout(() => setHint(false), 1800);
      taRef.current?.focus();
      return;
    }
    const mine = entries.filter((e) => e.day === viewDay);
    const entry: Entry = {
      id: uid(),
      day: viewDay,
      createdAt: Date.now(),
      order: mine.length ? Math.max(...mine.map((e) => e.order)) + 1 : 0,
      raw: t,
      short: charLen(t) <= 20 ? t : null,
      images: imgs,
    };
    setEntries((p) => [...p, entry]);
    void saveEntry(entry);
    void closeComposer();
    if (entry.short === null) {
      setSettling((s) => new Set(s).add(entry.id));
      void runShorten(entry.id, t, true);
    }
    setTimeout(() => {
      document.querySelector(`[data-entry="${entry.id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 120);
  }, [text, imgs, entries, viewDay, closeComposer, runShorten]);

  const openComposerProgrammatic = useCallback(async () => {
    const s = S.current;
    if (s.mode !== "day" || s.composing) return;
    flushSync(() => {
      setPulling(true);
      setComposing(true);
    });
    composeStart.current = Date.now();
    taRef.current?.focus();
    await animate(composeH, COMPOSER_H, SPRING);
    setComposerAuto(true);
    taRef.current?.focus();
  }, [composeH]);

  const addImages = async (files: FileList | null) => {
    if (!files) return;
    const out: Blob[] = [];
    for (const f of Array.from(files)) {
      try {
        out.push(await shrinkImage(f));
      } catch {
        /* skip unreadable */
      }
    }
    setImgs((p) => [...p, ...out]);
    taRef.current?.focus();
  };

  /* ---------- paging ---------- */
  const goPage = useCallback(
    (i: number) => {
      const n = Math.max(0, Math.min(2, i));
      setIndexState(n);
      void animate(pageX, -n * S.current.W, PAGE_SPRING);
    },
    [pageX],
  );

  /* ---------- overview ---------- */
  const days = useMemo(() => {
    const set = new Map<string, number>();
    for (const e of entries) set.set(e.day, (set.get(e.day) ?? 0) + 1);
    if (!set.has(today)) set.set(today, 0);
    if (overviewOpen && !set.has(viewDay)) set.set(viewDay, 0);
    return [...set.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [entries, today, viewDay, overviewOpen]);

  const cardRect = (day: string) => {
    const el = document.querySelector(`[data-daycard="${day}"]`) as HTMLElement | null;
    if (!el) {
      const w = S.current.W * 0.4;
      return { x: (S.current.W - w) / 2, y: S.current.H * 0.3, w };
    }
    el.scrollIntoView({ block: "nearest" });
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width };
  };

  const zoomOut = useCallback(async () => {
    const s = S.current;
    if (s.mode !== "day" || busy.current) return;
    busy.current = true;
    taRef.current?.blur();
    flushSync(() => setOverviewOpen(true));
    const r = cardRect(s.viewDay);
    await Promise.all([
      animate(ws, r.w / s.W, SPRING),
      animate(wx, r.x, SPRING),
      animate(wy, r.y, SPRING),
    ]);
    setMode("overview");
    busy.current = false;
  }, [ws, wx, wy]);

  const enterDay = useCallback(
    async (day: string) => {
      if (busy.current) return;
      busy.current = true;
      const r = cardRect(day);
      setViewDay(day);
      setExpandedId(null);
      setIndexState(1);
      pageX.set(-S.current.W);
      ws.set(r.w / S.current.W);
      wx.set(r.x);
      wy.set(r.y);
      setMode("entering");
      await sleep(30);
      pageEls.current[1]?.querySelector(".ol-scroll")?.scrollTo(0, 0);
      await Promise.all([animate(ws, 1, SPRING), animate(wx, 0, SPRING), animate(wy, 0, SPRING)]);
      setMode("day");
      setOverviewOpen(false);
      busy.current = false;
    },
    [pageX, ws, wx, wy],
  );

  const F = useRef({ zoomOut, goPage, enterDay, patchEntry, openComposerProgrammatic });
  F.current = { zoomOut, goPage, enterDay, patchEntry, openComposerProgrammatic };

  /* ---------- gestures ---------- */
  const dragRef = useRef<{ id: string; grabOff: number; lastY: number } | null>(null);

  const applyDragTransform = () => {
    const d = dragRef.current;
    if (!d) return;
    const li = document.querySelector(`[data-entry="${d.id}"]`) as HTMLElement | null;
    const inner = li?.querySelector("[data-inner]") as HTMLElement | null;
    if (!li || !inner) return;
    const top = li.getBoundingClientRect().top;
    inner.style.transform = `translateY(${d.lastY - d.grabOff - top}px)`;
  };
  useLayoutEffect(() => {
    applyDragTransform();
  });

  useEffect(() => {
    const root = rootRef.current!;
    const g = {
      phase: "idle" as Phase,
      x0: 0,
      y0: 0,
      lastX: 0,
      lastT: 0,
      vx: 0,
      timer: 0,
      entryEl: null as HTMLElement | null,
      slideEl: null as HTMLElement | null,
      swId: "",
      swBase: 0,
      swOff: 0,
      scroller: null as HTMLElement | null,
      pinchD0: 0,
      pinchS: 1,
      lastTouch: 0,
      moved: false,
    };
    const suppressClick = () => {
      (root as any)._suppress = true;
      setTimeout(() => ((root as any)._suppress = false), 350);
    };

    const start = (x: number, y: number, t: HTMLElement) => {
      const s = S.current;
      g.phase = "none";
      if (s.mode !== "day" || s.composing || s.pulling || busy.current) return;
      if (t.closest("[data-keep],textarea,input,button")) return;
      // touching anywhere other than the revealed entry retracts it
      const touchedId = (t.closest("[data-entry]") as HTMLElement | null)?.dataset.entry ?? null;
      if (s.revealedId && s.revealedId !== touchedId) setRevealedId(null);
      g.phase = "pending";
      g.x0 = g.lastX = x;
      g.y0 = y;
      g.lastT = performance.now();
      g.vx = 0;
      g.moved = false;
      g.entryEl = t.closest("[data-entry]") as HTMLElement | null;
      g.scroller = pageEls.current[s.index]?.querySelector(".ol-scroll") as HTMLElement | null;
      const isBlock = !!t.closest("[data-block]");
      window.clearTimeout(g.timer);
      g.timer = window.setTimeout(() => {
        if (g.phase !== "pending") return;
        if (g.entryEl && S.current.index === 1) {
          g.phase = "drag";
          if (S.current.revealedId) setRevealedId(null);
          const r = g.entryEl.getBoundingClientRect();
          dragRef.current = { id: g.entryEl.dataset.entry!, grabOff: g.y0 - r.top, lastY: g.y0 };
          setDragId(dragRef.current.id);
          navigator.vibrate?.(8);
        } else if (!g.entryEl && !isBlock) {
          g.phase = "none";
          suppressClick();
          void F.current.zoomOut();
        }
      }, LONG_MS);
    };

    const move = (x: number, y: number, e: Event, cancelable: boolean) => {
      if (g.phase === "idle" || g.phase === "none") return;
      const s = S.current;
      const dx = x - g.x0,
        dy = y - g.y0;
      const now = performance.now();
      if (now > g.lastT) g.vx = (x - g.lastX) / (now - g.lastT);
      g.lastX = x;
      g.lastT = now;
      if (g.phase === "pending") {
        if (Math.hypot(dx, dy) < 8) return;
        window.clearTimeout(g.timer);
        g.moved = true;
        if (Math.abs(dx) > Math.abs(dy) * 1.1) {
          // Horizontal swipe. Gesture split: starting on an entry, a LEFT swipe (or any swipe on the
          // already-revealed entry) is the delete reveal; everything else pages as before.
          const eid = g.entryEl?.dataset.entry;
          const slide = g.entryEl?.querySelector("[data-slide]") as HTMLElement | null;
          if (eid && slide && s.index === 1 && (dx < 0 || s.revealedId === eid)) {
            g.phase = "swipe";
            g.slideEl = slide;
            g.swId = eid;
            g.swBase = s.revealedId === eid ? -REVEAL_W : 0;
            g.swOff = g.swBase;
            slide.style.transition = "none";
          } else g.phase = "hpage";
        } else if (dy > 0 && s.index === 1 && (g.scroller?.scrollTop ?? 0) <= 0) {
          g.phase = "pull";
          setPulling(true);
          composeH.set(0);
        } else g.phase = "none";
        if (g.phase === "none") return;
      }
      if (cancelable && e.cancelable) e.preventDefault();
      if (g.phase === "hpage") {
        let off = dx;
        if ((s.index === 0 && dx > 0) || (s.index === 2 && dx < 0)) off = dx * 0.25;
        pageX.set(-s.index * s.W + off);
      } else if (g.phase === "swipe" && g.slideEl) {
        const raw = Math.min(0, g.swBase + dx);
        const off = raw >= -REVEAL_W ? raw : -REVEAL_W - damp(-REVEAL_W - raw, 24);
        g.swOff = off;
        g.slideEl.style.transform = `translateX(${off}px)`;
      } else if (g.phase === "pull") {
        composeH.set(Math.min(COMPOSER_H * 1.6, damp(Math.max(0, dy), 160) * 0.62));
      } else if (g.phase === "drag" && dragRef.current) {
        const d = dragRef.current;
        d.lastY = y;
        const sc = g.scroller;
        if (sc) {
          const r = sc.getBoundingClientRect();
          if (y < r.top + 70) sc.scrollTop -= 8;
          else if (y > r.bottom - 70) sc.scrollTop += 8;
        }
        applyDragTransform();
        // swap with neighbours
        const li = document.querySelector(`[data-entry="${d.id}"]`) as HTMLElement | null;
        if (li) {
          const h = li.getBoundingClientRect().height;
          const center = y - d.grabOff + h / 2;
          const ids = S.current.dayEntries.map((en) => en.id);
          const i = ids.indexOf(d.id);
          const at = (k: number) => {
            const r = (document.querySelector(`[data-entry="${ids[k]}"]`) as HTMLElement).getBoundingClientRect();
            return r.top + r.height / 2;
          };
          let j = i;
          if (i > 0 && center < at(i - 1)) j = i - 1;
          else if (i < ids.length - 1 && center > at(i + 1)) j = i + 1;
          if (j !== i) {
            const nx = [...ids];
            [nx[i], nx[j]] = [nx[j], nx[i]];
            const dayStr = S.current.viewDay;
            setEntries((prev) =>
              prev.map((en) => (en.day === dayStr ? { ...en, order: nx.indexOf(en.id) } : en)),
            );
          }
        }
      } else if (g.phase === "pinch") {
        /* handled in touch handler */
      }
    };

    const end = () => {
      window.clearTimeout(g.timer);
      const s = S.current;
      const ph = g.phase;
      g.phase = "idle";
      if (ph === "hpage") {
        const off = pageX.get() + s.index * s.W;
        let n = s.index;
        if (off < -s.W * 0.18 || g.vx < -0.5) n = s.index + 1;
        else if (off > s.W * 0.18 || g.vx > 0.5) n = s.index - 1;
        suppressClick();
        F.current.goPage(n);
      } else if (ph === "swipe" && g.slideEl) {
        suppressClick();
        let rev: boolean;
        if (g.vx < -0.6) rev = true;
        else if (g.vx > 0.6) rev = false;
        else rev = g.swOff <= (g.swBase ? -(REVEAL_W - 24) : -64);
        slideTo(g.slideEl, rev);
        setRevealedId(rev ? g.swId : null);
        g.slideEl = null;
      } else if (ph === "pull") {
        suppressClick();
        if (composeH.get() > PULL_COMMIT) {
          composeStart.current = Date.now();
          setComposing(true);
          taRef.current?.focus(); // inside the user-gesture handler so iOS opens the keyboard
          void animate(composeH, COMPOSER_H, SPRING).then(() => setComposerAuto(true));
        } else {
          void animate(composeH, 0, SPRING).then(() => setPulling(false));
        }
      } else if (ph === "drag" && dragRef.current) {
        const d = dragRef.current;
        suppressClick();
        const li = document.querySelector(`[data-entry="${d.id}"]`) as HTMLElement | null;
        const inner = li?.querySelector("[data-inner]") as HTMLElement | null;
        dragRef.current = null;
        if (inner) {
          inner.style.transition = "transform .25s cubic-bezier(.3,1.2,.5,1)";
          inner.style.transform = "translateY(0)";
          setTimeout(() => {
            inner.style.transition = "";
          }, 300);
        }
        setDragId(null);
        // persist the order of this day
        setEntries((prev) => {
          prev.filter((en) => en.day === S.current.viewDay).forEach((en) => void saveEntry(en));
          return prev;
        });
      } else if (ph === "pinch") {
        suppressClick();
        if (g.pinchS < 0.85) void F.current.zoomOut();
        else {
          void Promise.all([animate(ws, 1, SPRING), animate(wx, 0, SPRING), animate(wy, 0, SPRING)]).then(() =>
            setOverviewOpen(false),
          );
        }
      }
    };

    // touch
    const ts = (e: TouchEvent) => {
      g.lastTouch = Date.now();
      const s = S.current;
      if (e.touches.length === 2) {
        window.clearTimeout(g.timer);
        if (s.mode !== "day" || s.composing || s.pulling || busy.current || g.phase === "drag") return;
        g.phase = "pinch";
        g.pinchD0 = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        g.pinchS = 1;
        flushSync(() => setOverviewOpen(true));
        return;
      }
      if (e.touches.length === 1) start(e.touches[0].clientX, e.touches[0].clientY, e.target as HTMLElement);
    };
    const tm = (e: TouchEvent) => {
      g.lastTouch = Date.now();
      if (g.phase === "pinch" && e.touches.length === 2) {
        if (e.cancelable) e.preventDefault();
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        const k = Math.max(0.45, Math.min(1, d / g.pinchD0));
        g.pinchS = k;
        const { W: w, H: h } = S.current;
        ws.set(k);
        wx.set((1 - k) * w * 0.5);
        wy.set((1 - k) * h * 0.5);
        return;
      }
      if (e.touches.length === 1) move(e.touches[0].clientX, e.touches[0].clientY, e, true);
    };
    const te = (e: TouchEvent) => {
      g.lastTouch = Date.now();
      if (g.phase === "pinch" || e.touches.length === 0) end();
    };
    // mouse (desktop debugging)
    const md = (e: MouseEvent) => {
      if (Date.now() - g.lastTouch < 700 || e.button !== 0) return;
      start(e.clientX, e.clientY, e.target as HTMLElement);
    };
    const mm = (e: MouseEvent) => {
      if (Date.now() - g.lastTouch < 700) return;
      if (e.buttons === 0 && g.phase !== "idle") return end();
      move(e.clientX, e.clientY, e, true);
    };
    const mu = () => {
      if (Date.now() - g.lastTouch < 700) return;
      end();
    };
    const ctx = (e: Event) => e.preventDefault();

    root.addEventListener("touchstart", ts, { passive: true });
    root.addEventListener("touchmove", tm, { passive: false });
    root.addEventListener("touchend", te);
    root.addEventListener("touchcancel", te);
    root.addEventListener("mousedown", md);
    window.addEventListener("mousemove", mm);
    window.addEventListener("mouseup", mu);
    root.addEventListener("contextmenu", ctx);
    return () => {
      root.removeEventListener("touchstart", ts);
      root.removeEventListener("touchmove", tm);
      root.removeEventListener("touchend", te);
      root.removeEventListener("touchcancel", te);
      root.removeEventListener("mousedown", md);
      window.removeEventListener("mousemove", mm);
      window.removeEventListener("mouseup", mu);
      root.removeEventListener("contextmenu", ctx);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- keyboard (desktop debugging) ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("textarea,input")) return;
      const s = S.current;
      const k = e.key.toLowerCase();
      if (k === "o") {
        if (s.mode === "day") void F.current.zoomOut();
        else if (s.mode === "overview") void F.current.enterDay(s.viewDay);
      } else if (s.mode === "day" && !s.composing) {
        if (k === "arrowleft") F.current.goPage(s.index - 1);
        else if (k === "arrowright") F.current.goPage(s.index + 1);
        else if (k === "n") {
          e.preventDefault();
          if (s.index !== 1) F.current.goPage(1);
          void F.current.openComposerProgrammatic();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ---------- diary ---------- */
  const diaryHash = useMemo(
    () => hashString(dayEntries.map((e) => `${e.id}\u0001${e.raw}`).join("\u0002")),
    [dayEntries],
  );
  const dayEntriesRef = useRef(dayEntries);
  dayEntriesRef.current = dayEntries;
  useEffect(() => {
    if (index !== 2 || mode !== "day" || !loaded) return;
    let dead = false;
    const t = setTimeout(async () => {
      const list = dayEntriesRef.current;
      if (!list.length) return setDiaryState({ status: "idle", text: "" });
      const cached = await loadDiary(viewDay).catch(() => undefined);
      if (dead) return;
      if (cached && cached.hash === diaryHash) return setDiaryState({ status: "ok", text: cached.text });
      setDiaryState({ status: "loading", text: "" });
      const res = await aiDiary(list.map((e) => e.raw));
      if (dead) return;
      if (res.status === "ok") {
        setDiaryState({ status: "ok", text: res.text });
        void saveDiary({ day: viewDay, hash: diaryHash, text: res.text });
      } else setDiaryState({ status: res.status, text: "" });
    }, 250);
    return () => {
      dead = true;
      clearTimeout(t);
    };
  }, [index, mode, viewDay, diaryHash, loaded, diaryNonce]);

  /* ---------- misc ---------- */
  const selEntry = selBlock === null ? undefined : byCreated[selBlock];
  const selText = selEntry ? (settling.has(selEntry.id) ? selEntry.raw : (selEntry.short ?? selEntry.raw)) : "";

  const showComposer = pulling || composing;
  const scaled = mode !== "day";

  return (
    <div
      ref={rootRef}
      className="ol-app"
      onScrollCapture={() => {
        if (S.current.revealedId) setRevealedId(null);
      }}
      onClickCapture={(e) => {
        const root = rootRef.current as any;
        if (root._suppress) {
          e.stopPropagation();
          e.preventDefault();
          return;
        }
        if (revealedId && !(e.target as HTMLElement).closest("[data-del]")) {
          setRevealedId(null);
          // tapping an entry body while revealed only retracts; it must not toggle expand
          if ((e.target as HTMLElement).closest("[data-entry]")) {
            e.stopPropagation();
            e.preventDefault();
            return;
          }
        }
        if (composing && Date.now() - composeStart.current > 400 && !(e.target as HTMLElement).closest("[data-keep]")) {
          e.stopPropagation();
          e.preventDefault();
          finish();
          return;
        }
        // tapping anywhere outside the expanded entry collapses it
        if (expandedId && !(e.target as HTMLElement).closest("[data-entry]")) setExpandedId(null);
      }}
    >
      <div className={"ol-overview" + (overviewOpen ? "" : " ol-off")}>
        <div className="ol-grid">
          {days.map(([d, n]) => (
            <button
              key={d}
              className="ol-card"
              data-daycard={d}
              style={{ aspectRatio: `${W} / ${H}` }}
              onClick={() => mode === "overview" && void enterDay(d)}
            >
              <span className="ol-card-date">{formatDayLabel(d)}</span>
              <span className="ol-card-shape">
                <Shape day={d} n={n} size="70%" />
              </span>
            </button>
          ))}
        </div>
        <Tools hasKey={hasKey} onKey={onKey} onExport={doExport} onImport={doImport} />
      </div>

      <motion.div
        className={"ol-wrap" + (scaled ? " ol-scaled" : "") + (mode === "overview" ? " ol-hidden" : "")}
        style={{ x: wx, y: wy, scale: ws }}
      >
        <div className="ol-date">{formatDayLabel(viewDay)}</div>
        <div className="ol-dots">
          {[0, 1, 2].map((i) => (
            <span key={i} className={"ol-dot" + (i === index ? " ol-on" : "")} />
          ))}
        </div>

        <motion.div className="ol-pager" style={{ x: pageX }}>
          {/* blocks */}
          <div
            className="ol-page"
            ref={(el) => void (pageEls.current[0] = el)}
            onClick={(e) => {
              if (!(e.target as Element).closest("[data-block]")) setSelBlock(null);
            }}
          >
            {selEntry && (
              <div className="ol-blockline">
                <p key={selEntry.id} className="ol-blockline-in">
                  {selText}
                </p>
              </div>
            )}
            <div className="ol-blocks">
              <Shape
                day={viewDay}
                n={dayEntries.length}
                size={Math.min(W - 56, H * 0.6)}
                onBlock={(i) => setSelBlock(i)}
                selected={selEntry ? selBlock : null}
              />
            </div>
          </div>

          {/* canvas */}
          <div className="ol-page" ref={(el) => void (pageEls.current[1] = el)}>
            <div className="ol-scroll">
              {showComposer && (
                <motion.div
                  className="ol-composer"
                  data-keep
                  style={{ height: composerAuto ? "auto" : composeH }}
                >
                  <div className="ol-composer-in">
                    <AutoTextarea ref={taRef} className="ol-text" value={text} onChange={setText} />
                    <button
                      className="ol-addrow"
                      type="button"
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => fileRef.current?.click()}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
                        <circle cx="9" cy="10" r="1.6" />
                        <path d="M4 17.5l5-4.5 3.5 3 3-2.5 4.5 4" />
                      </svg>
                      <span>加入圖片</span>
                      {hint && <span className="ol-barhint">先寫一句話</span>}
                    </button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      multiple
                      hidden
                      onChange={(e) => {
                        void addImages(e.target.files);
                        e.target.value = "";
                      }}
                    />
                    {imgs.length > 0 && <Thumbs blobs={imgs} onRemove={(i) => setImgs((p) => p.filter((_, k) => k !== i))} />}
                  </div>
                </motion.div>
              )}
              <ul className="ol-list">
                {dayEntries.map((e) => (
                  <EntryItem
                    key={e.id}
                    entry={e}
                    expanded={expandedId === e.id}
                    settling={settling.has(e.id)}
                    revealed={revealedId === e.id}
                    dragging={dragId === e.id}
                    onToggle={() => setExpandedId((cur) => (cur === e.id ? null : e.id))}
                    onChange={(p) => patchEntry(e.id, p)}
                    onDelete={() => deleteEntry(e.id)}
                  />
                ))}
              </ul>
            </div>
          </div>

          {/* diary */}
          <div className="ol-page" ref={(el) => void (pageEls.current[2] = el)}>
            <div className="ol-scroll">
              {diaryState.status === "ok" && dayEntries.length > 0 && <p className="ol-diary">{diaryState.text}</p>}
              {diaryState.status === "loading" && <p className="ol-diary-note">…</p>}
              {diaryState.status === "no-key" &&
                (keyEditing ? (
                  <KeyInput
                    placeholder="貼上 Gemini API 金鑰"
                    onDone={(v) => {
                      if (v) onKey(v);
                      else setKeyEditing(false);
                    }}
                  />
                ) : (
                  <button type="button" className="ol-diary-note" data-keep onClick={() => setKeyEditing(true)}>
                    尚未設定 AI 金鑰，點這裡輸入
                  </button>
                ))}
              {diaryState.status === "error" && <p className="ol-diary-note">暫時無法生成</p>}
            </div>
          </div>
        </motion.div>
      </motion.div>

    </div>
  );
}

function Thumbs({ blobs, onRemove }: { blobs: Blob[]; onRemove: (i: number) => void }) {
  const urls = useMemo(() => blobs.map((b) => URL.createObjectURL(b)), [blobs]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  return (
    <div className="ol-thumbs">
      {urls.map((u, i) => (
        <button key={u} className="ol-thumb" style={{ backgroundImage: `url(${u})` }} onClick={() => onRemove(i)} aria-label="remove" />
      ))}
    </div>
  );
}

void parseDayKey;
