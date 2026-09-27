"use client";

import { useMemo, useRef, useState } from "react";

export interface ProductionPoint {
  hour: string;
  itemCode: string;
  kg: number;
}

/** Colour follows the material, never its rank (validated categorical order; see ARCHITECTURE.md). */
const SERIES_COLORS: Record<string, string> = {
  O2: "var(--color-series-1)",
  FE: "var(--color-series-2)",
  SI: "var(--color-series-3)",
  TI: "var(--color-series-4)",
  H2O: "var(--color-series-5)",
  REGOLITH: "var(--color-series-6)",
};
const OTHER_COLOR = "#898781";
const MAX_SERIES = 4;

const W = 720;
const H = 260;
const M = { top: 12, right: 56, bottom: 28, left: 56 };

/** Clean tick step (1, 2, 2.5 or 5 × 10ⁿ) giving about four intervals. */
function niceStep(max: number): number {
  if (max <= 0) return 1;
  const raw = max / 4;
  const exp = 10 ** Math.floor(Math.log10(raw));
  const f = raw / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: n < 10 ? 1 : 0 }).format(n);
const hourLabel = (iso: string) => `${iso.slice(5, 10)} ${iso.slice(11, 16)}`;

export function ProductionChart({
  points,
  hours,
  endIso,
}: {
  points: ProductionPoint[];
  hours: number;
  endIso: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const model = useMemo(() => {
    // End at the last COMPLETE hour so a partial current hour doesn't read as a production drop.
    const end = new Date(endIso);
    end.setUTCMinutes(0, 0, 0);
    end.setTime(end.getTime() - 3_600_000);
    const slots = Array.from({ length: hours }, (_, i) =>
      new Date(end.getTime() - (hours - 1 - i) * 3_600_000).toISOString(),
    );
    const index = new Map(slots.map((s, i) => [s, i]));
    const totals = new Map<string, number>();
    for (const p of points) totals.set(p.itemCode, (totals.get(p.itemCode) ?? 0) + p.kg);
    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([code]) => code);
    const shown = ranked.length > MAX_SERIES ? ranked.slice(0, MAX_SERIES - 1) : ranked;
    const folded = ranked.length > MAX_SERIES;
    // Keep legend order stable by material code, not by rank.
    const order = Object.keys(SERIES_COLORS);
    shown.sort(
      (a, b) =>
        (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) -
        (order.indexOf(b) === -1 ? 99 : order.indexOf(b)),
    );
    const names = folded ? [...shown, "Other"] : shown;
    const values = new Map(names.map((n) => [n, new Array<number>(hours).fill(0)]));
    for (const p of points) {
      const i = index.get(new Date(p.hour).toISOString());
      if (i === undefined) continue;
      const key = shown.includes(p.itemCode) ? p.itemCode : "Other";
      const arr = values.get(key);
      if (arr) arr[i]! += p.kg;
    }
    const step = niceStep(Math.max(0, ...[...values.values()].flat()));
    const max = step * Math.max(1, Math.ceil(Math.max(0, ...[...values.values()].flat()) / step));
    const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
    return { slots, names, values, max, ticks };
  }, [points, hours, endIso]);

  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const x = (i: number) => M.left + (hours <= 1 ? 0 : (i / (hours - 1)) * plotW);
  const y = (v: number) => M.top + plotH - (v / model.max) * plotH;
  const ticks = model.ticks;
  const color = (name: string) => SERIES_COLORS[name] ?? OTHER_COLOR;

  if (model.names.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-600">
        No production telemetry in the last {hours} hours.
      </p>
    );
  }

  const endLabels = model.names.map((n) => ({ name: n, y: y(model.values.get(n)![hours - 1]!) }));
  const labelsCollide = endLabels.some((a, i) =>
    endLabels.some((b, j) => i !== j && Math.abs(a.y - b.y) < 12),
  );

  function onPointer(e: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current!.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - M.left) / plotW) * (hours - 1));
    setActive(Math.max(0, Math.min(hours - 1, i)));
  }

  function onKey(e: React.KeyboardEvent<SVGSVGElement>) {
    if (e.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? hours - 1) - 1));
    else if (e.key === "ArrowRight") setActive((a) => Math.min(hours - 1, (a ?? hours - 2) + 1));
    else if (e.key === "Escape") setActive(null);
    else return;
    e.preventDefault();
  }

  const tooltipLeft = active === null ? 0 : (x(active) / W) * 100;

  return (
    <figure className="space-y-3">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-700" aria-label="Legend">
        {model.names.map((n) => (
          <li key={n} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-0.5 w-4 rounded"
              style={{ background: color(n) }}
            />
            {n}
          </li>
        ))}
      </ul>
      <div className="relative overflow-x-auto">
        <div className="relative min-w-[560px]">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full touch-none"
            role="img"
            aria-label={`Production rate in kg per hour over the last ${hours} hours for ${model.names.join(", ")}. Use left and right arrow keys to inspect hours.`}
            tabIndex={0}
            onPointerMove={onPointer}
            onPointerDown={onPointer}
            onPointerLeave={() => setActive(null)}
            onKeyDown={onKey}
            onBlur={() => setActive(null)}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={M.left}
                  x2={W - M.right}
                  y1={y(t)}
                  y2={y(t)}
                  stroke={t === 0 ? "#c3c2b7" : "#e1e0d9"}
                  strokeWidth={1}
                />
                <text
                  x={M.left - 8}
                  y={y(t)}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-slate-500 text-[11px] tabular-nums"
                >
                  {fmt(t)}
                </text>
              </g>
            ))}
            {model.slots.map((s, i) =>
              i % 12 === 0 || i === hours - 1 ? (
                <text
                  key={s}
                  x={x(i)}
                  y={H - 8}
                  textAnchor={i === 0 ? "start" : i === hours - 1 ? "end" : "middle"}
                  className="fill-slate-500 text-[11px] tabular-nums"
                >
                  {hourLabel(s)}
                </text>
              ) : null,
            )}
            <text
              x={12}
              y={M.top + plotH / 2}
              transform={`rotate(-90 12 ${M.top + plotH / 2})`}
              textAnchor="middle"
              className="fill-slate-500 text-[11px]"
            >
              kg / hour
            </text>
            {model.names.map((n) => {
              const vals = model.values.get(n)!;
              const d = vals
                .map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
                .join(" ");
              return (
                <path
                  key={n}
                  d={d}
                  fill="none"
                  stroke={color(n)}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              );
            })}
            {model.names.map((n) => (
              <circle
                key={n}
                cx={x(hours - 1)}
                cy={y(model.values.get(n)![hours - 1]!)}
                r={4}
                fill={color(n)}
                stroke="#ffffff"
                strokeWidth={2}
              />
            ))}
            {!labelsCollide &&
              endLabels.map((l) => (
                <text
                  key={l.name}
                  x={x(hours - 1) + 8}
                  y={l.y}
                  dy="0.32em"
                  className="fill-slate-700 text-[11px] font-medium"
                >
                  {l.name}
                </text>
              ))}
            {active !== null && (
              <g pointerEvents="none">
                <line
                  x1={x(active)}
                  x2={x(active)}
                  y1={M.top}
                  y2={M.top + plotH}
                  stroke="#898781"
                  strokeWidth={1}
                />
                {model.names.map((n) => (
                  <circle
                    key={n}
                    cx={x(active)}
                    cy={y(model.values.get(n)![active]!)}
                    r={4}
                    fill={color(n)}
                    stroke="#ffffff"
                    strokeWidth={2}
                  />
                ))}
              </g>
            )}
          </svg>
          {active !== null && (
            <div
              role="status"
              className="pointer-events-none absolute top-2 z-10 min-w-40 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"
              style={{
                left: `${tooltipLeft}%`,
                transform: tooltipLeft > 60 ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
              }}
            >
              <p className="mb-1 text-slate-500">
                {hourLabel(model.slots[active]!)}–{hourLabel(model.slots[active]!).slice(-5, -3)}:59
                UTC
              </p>
              <ul className="space-y-0.5">
                {model.names.map((n) => (
                  <li key={n} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5 text-slate-600">
                      <span
                        aria-hidden="true"
                        className="inline-block h-0.5 w-3 rounded"
                        style={{ background: color(n) }}
                      />
                      {n}
                    </span>
                    <strong className="text-slate-900 tabular-nums">
                      {fmt(model.values.get(n)![active]!)} kg
                    </strong>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-slate-700">Show data table</summary>
        <div className="mt-2 max-h-72 overflow-auto">
          <table className="w-full text-left text-xs tabular-nums">
            <caption className="sr-only">Hourly production in kg</caption>
            <thead>
              <tr>
                <th className="px-2 py-1">Hour (UTC)</th>
                {model.names.map((n) => (
                  <th key={n} className="px-2 py-1 text-right">
                    {n} (kg)
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {model.slots.map((s, i) => (
                <tr key={s} className="border-t border-slate-100">
                  <td className="px-2 py-1">{hourLabel(s)}</td>
                  {model.names.map((n) => (
                    <td key={n} className="px-2 py-1 text-right">
                      {fmt(model.values.get(n)![i]!)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
