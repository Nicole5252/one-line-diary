import { useMemo } from "react";
import { growShape } from "../lib/blocks.ts";

export function Shape({
  day,
  n,
  size,
  onBlock,
  selected = null,
}: {
  day: string;
  n: number;
  size: number | string;
  onBlock?: (i: number) => void;
  selected?: number | null;
}) {
  const cells = useMemo(() => growShape(day, n), [day, n]);
  if (n === 0) return null;
  const xs = cells.map((c) => c.x),
    ys = cells.map((c) => c.y);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  const L = Math.max(maxX - minX + 1, maxY - minY + 1, 6) + 2;
  const cx = (minX + maxX + 1) / 2,
    cy = (minY + maxY + 1) / 2;
  const vb = `${cx - L / 2} ${cy - L / 2} ${L} ${L}`;
  return (
    <svg viewBox={vb} width={size} height={size} style={{ display: "block" }}>
      {cells.map((c, i) => (
        <rect
          key={i}
          data-block={onBlock ? i : undefined}
          x={c.x + 0.04}
          y={c.y + 0.04}
          width={0.92}
          height={0.92}
          fill={selected === null || selected === i ? "#111" : "#d6d6d6"}
          onClick={onBlock ? () => onBlock(i) : undefined}
          style={onBlock ? { cursor: "pointer" } : undefined}
        />
      ))}
    </svg>
  );
}
