import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Animates its own height to follow its content (spring-ish overshoot via CSS). */
export function AutoHeight({ children }: { children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<number | null>(null);
  const [anim, setAnim] = useState(false);
  useLayoutEffect(() => {
    const el = inner.current!;
    const ro = new ResizeObserver(() => setH(el.offsetHeight));
    ro.observe(el);
    setH(el.offsetHeight);
    const t = setTimeout(() => setAnim(true), 80);
    return () => {
      ro.disconnect();
      clearTimeout(t);
    };
  }, []);
  return (
    <div className={"ol-ah" + (anim ? " ol-ah-anim" : "")} style={{ height: h === null ? "auto" : h }}>
      <div ref={inner}>{children}</div>
    </div>
  );
}
