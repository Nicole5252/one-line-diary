import { useEffect, useMemo, useRef } from "react";
import { motion } from "motion/react";
import type { Entry } from "../types.ts";
import { AutoHeight } from "./AutoHeight.tsx";
import { AutoTextarea } from "./AutoTextarea.tsx";

export const REVEAL_W = 64;

export function slideTo(el: HTMLElement, revealed: boolean) {
  el.style.transition = "transform .28s cubic-bezier(.3,1.2,.5,1)";
  el.style.transform = `translateX(${revealed ? -REVEAL_W : 0}px)`;
}

function Images({ blobs }: { blobs: Blob[] }) {
  const urls = useMemo(() => blobs.map((b) => URL.createObjectURL(b)), [blobs]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  if (!urls.length) return null;
  return (
    <div className="ol-imgs">
      {urls.map((u) => (
        <img key={u} src={u} alt="" draggable={false} />
      ))}
    </div>
  );
}

export function EntryItem({
  entry,
  expanded,
  settling,
  dragging,
  revealed,
  onToggle,
  onChange,
  onDelete,
}: {
  entry: Entry;
  expanded: boolean;
  settling: boolean;
  dragging: boolean;
  revealed: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<Pick<Entry, "raw" | "short">>) => void;
  onDelete: () => void;
}) {
  const slideRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (slideRef.current) slideTo(slideRef.current, revealed);
  }, [revealed]);
  const same = entry.short === null || entry.short === entry.raw;
  const shown = settling ? entry.raw : (entry.short ?? entry.raw);

  return (
    <motion.li
      layout="position"
      transition={{ type: "spring", stiffness: 520, damping: 44 }}
      className={"ol-entry" + (dragging ? " ol-dragging" : "")}
      data-entry={entry.id}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("textarea,button")) return;
        onToggle();
      }}
    >
      <button
        className="ol-del"
        data-del
        tabIndex={revealed ? 0 : -1}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        刪除
      </button>
      <div className="ol-slide" data-slide ref={slideRef}>
        <div className="ol-entry-in" data-inner>
          <AutoHeight>
            {!expanded ? (
              <p className="ol-text">{shown}</p>
            ) : same ? (
              <AutoTextarea className="ol-edit" value={entry.raw} onChange={(v) => onChange({ raw: v, short: v })} />
            ) : (
              <>
                <AutoTextarea className="ol-edit" value={entry.short ?? ""} onChange={(v) => onChange({ short: v })} />
                <AutoTextarea className="ol-raw" value={entry.raw} onChange={(v) => onChange({ raw: v })} />
              </>
            )}
            {expanded && <Images blobs={entry.images} />}
          </AutoHeight>
        </div>
      </div>
    </motion.li>
  );
}
