"use client";

import { useEffect, useRef, useState } from "react";
import { WeekStat } from "@/lib/types";

const M = { top: 20, right: 52, bottom: 36, left: 52 }; // margins
const H = 300; // total svg height

interface Props {
  data: WeekStat[];
}

export function TimeToReviewChart({ data }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(700);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      setWidth(entries[0].contentRect.width);
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  if (!data || data.length === 0) return null;

  const plotW = width - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const colW = plotW / data.length;
  const boxW = Math.max(Math.min(colW * 0.52, 40), 10);

  // ── Y scale: hours ────────────────────────────────────────────────────────
  const maxHours = data.reduce((m, d) => Math.max(m, d.max ?? 0), 0);
  const yMax = niceMax(maxHours);
  const yTicks = niceTicks(yMax, 5);
  const yH = (v: number) => M.top + plotH * (1 - v / yMax);

  // ── Y scale: merged count ─────────────────────────────────────────────────
  const maxMerged = data.reduce((m, d) => Math.max(m, d.merged_count), 0);
  const mMax = niceMax(maxMerged || 1);
  const mTicks = niceTicks(mMax, 4);
  const yM = (v: number) => M.top + plotH * (1 - v / mMax);

  // ── X helpers ─────────────────────────────────────────────────────────────
  const cx = (i: number) => M.left + (i + 0.5) * colW;

  // ── Merged count line ─────────────────────────────────────────────────────
  const mergedPath = data
    .map((d, i) => `${i === 0 ? "M" : "L"}${cx(i)},${yM(d.merged_count)}`)
    .join(" ");

  const hovD = hovered !== null ? data[hovered] : null;

  return (
    <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
      {/* Legend */}
      <div className="flex items-center gap-5 px-5 py-3 border-b border-neutral-100 bg-neutral-50 text-xs text-neutral-500">
        <span className="font-medium text-neutral-700">Time to first review</span>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-4 rounded-sm bg-blue-200 border border-blue-300" />
          <span>IQR (Q1–Q3)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-0.5 w-4 bg-blue-500" />
          <span>Median</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-2 w-2 rounded-full bg-blue-800" />
          <span>Mean</span>
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <div className="h-0.5 w-4 bg-amber-400" style={{ borderTop: "2px dashed #f59e0b" }} />
          <div className="h-2.5 w-2.5 rounded-full bg-amber-400" />
          <span className="text-amber-600 font-medium">Merged PRs (right axis)</span>
        </div>
      </div>

      <div ref={containerRef} className="relative select-none px-1 py-2">
        <svg width={width} height={H}>

          {/* Grid lines */}
          {yTicks.map((t) => (
            <line key={t}
              x1={M.left} x2={width - M.right}
              y1={yH(t)} y2={yH(t)}
              stroke="#f3f4f6" strokeWidth={1}
            />
          ))}

          {/* Hover column highlight */}
          {hovered !== null && (
            <rect
              x={M.left + hovered * colW}
              y={M.top}
              width={colW}
              height={plotH}
              fill="#f8fafc"
            />
          )}

          {/* Left Y axis labels */}
          {yTicks.map((t) => (
            <text key={t}
              x={M.left - 6} y={yH(t)}
              textAnchor="end" dominantBaseline="middle"
              fontSize={10} fill="#9ca3af"
            >
              {fmtHShort(t)}
            </text>
          ))}

          {/* Right Y axis labels */}
          {mTicks.map((t) => (
            <text key={t}
              x={width - M.right + 6} y={yM(t)}
              textAnchor="start" dominantBaseline="middle"
              fontSize={10} fill="#d97706"
            >
              {t}
            </text>
          ))}

          {/* Box plots */}
          {data.map((d, i) => {
            if (d.q1 == null || d.q3 == null || d.median == null) return null;
            const x = cx(i);
            const bL = x - boxW / 2;
            const bR = x + boxW / 2;
            const capW = boxW * 0.45;

            return (
              <g key={d.week}>
                {/* Full whisker line */}
                <line
                  x1={x} x2={x}
                  y1={yH(d.max ?? d.q3)} y2={yH(d.min ?? d.q1)}
                  stroke="#94a3b8" strokeWidth={1}
                />
                {/* Whisker caps */}
                {d.min != null && (
                  <line x1={x - capW} x2={x + capW} y1={yH(d.min)} y2={yH(d.min)} stroke="#94a3b8" strokeWidth={1} />
                )}
                {d.max != null && (
                  <line x1={x - capW} x2={x + capW} y1={yH(d.max)} y2={yH(d.max)} stroke="#94a3b8" strokeWidth={1} />
                )}
                {/* IQR box */}
                <rect
                  x={bL} y={yH(d.q3)}
                  width={boxW} height={Math.max(yH(d.q1) - yH(d.q3), 1)}
                  fill="#dbeafe" stroke="#93c5fd" strokeWidth={1} rx={2}
                />
                {/* Median line */}
                <line
                  x1={bL} x2={bR}
                  y1={yH(d.median)} y2={yH(d.median)}
                  stroke="#3b82f6" strokeWidth={2}
                />
                {/* Mean dot */}
                {d.mean != null && (
                  <circle cx={x} cy={yH(d.mean)} r={2.5} fill="#1d4ed8" />
                )}
              </g>
            );
          })}

          {/* Merged count line */}
          <path d={mergedPath} fill="none" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 2" />
          {data.map((d, i) => (
            <circle key={d.week} cx={cx(i)} cy={yM(d.merged_count)} r={3.5}
              fill={d.merged_count > 0 ? "#f59e0b" : "#fde68a"}
              stroke="#f59e0b" strokeWidth={1}
            />
          ))}

          {/* X axis labels */}
          {data.map((d, i) => {
            // Show label every 2 weeks if tight
            if (data.length > 8 && i % 2 !== 0) return null;
            return (
              <text key={d.week}
                x={cx(i)} y={H - 6}
                textAnchor="middle" fontSize={10} fill="#9ca3af"
              >
                {fmtWeekLabel(d.week)}
              </text>
            );
          })}

          {/* Axes */}
          <line x1={M.left} x2={M.left} y1={M.top} y2={H - M.bottom} stroke="#e5e7eb" />
          <line x1={width - M.right} x2={width - M.right} y1={M.top} y2={H - M.bottom} stroke="#fcd34d" strokeWidth={0.5} />

          {/* Invisible hover capture areas */}
          {data.map((d, i) => (
            <rect key={d.week}
              x={M.left + i * colW} y={M.top}
              width={colW} height={plotH}
              fill="transparent"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            />
          ))}
        </svg>

        {/* Tooltip */}
        {hovered !== null && hovD && (
          <Tooltip d={hovD} x={cx(hovered)} svgWidth={width} />
        )}
      </div>
    </div>
  );
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function Tooltip({ d, x, svgWidth }: { d: WeekStat; x: number; svgWidth: number }) {
  const TOOLTIP_W = 180;
  // Flip to left side when near right edge
  const left = x + TOOLTIP_W + 16 > svgWidth - M.right
    ? x - TOOLTIP_W - 8
    : x + 8;

  return (
    <div
      className="absolute top-6 z-20 pointer-events-none bg-white border border-neutral-200 rounded-lg shadow-lg p-3 text-xs"
      style={{ left, width: TOOLTIP_W }}
    >
      <p className="font-semibold text-neutral-800 mb-2">{fmtWeekFull(d.week)}</p>
      {d.median != null ? (
        <div className="space-y-1 text-neutral-600">
          <Row label="Median"  value={fmtH(d.median)}  color="text-blue-600" />
          <Row label="Mean"    value={fmtH(d.mean!)}    color="text-blue-800" />
          <Row label="Q1"      value={fmtH(d.q1!)} />
          <Row label="Q3"      value={fmtH(d.q3!)} />
          <Row label="Min"     value={fmtH(d.min!)} />
          <Row label="Max"     value={fmtH(d.max!)} />
          <div className="border-t border-neutral-100 mt-1.5 pt-1.5">
            <Row label="Reviewed" value={`${d.reviewed_count} PR${d.reviewed_count !== 1 ? "s" : ""}`} />
          </div>
        </div>
      ) : (
        <p className="text-neutral-400 italic">No review data</p>
      )}
      <div className="border-t border-neutral-100 mt-1.5 pt-1.5">
        <Row label="Merged" value={`${d.merged_count} PR${d.merged_count !== 1 ? "s" : ""}`} color="text-amber-600" />
      </div>
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-neutral-400">{label}</span>
      <span className={`font-medium ${color ?? "text-neutral-700"}`}>{value}</span>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtHShort(h: number): string {
  if (h === 0) return "0";
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function fmtH(h: number): string {
  if (h < 1)  return `${Math.round(h * 60)}m`;
  if (h < 24) return `${h.toFixed(1)}h`;
  const d = Math.floor(h / 24);
  const rem = Math.round(h % 24);
  return rem > 0 ? `${d}d ${rem}h` : `${d}d`;
}

function fmtWeekLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function fmtWeekFull(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return `Week of ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}`;
}

function niceMax(v: number): number {
  if (v <= 0) return 24;
  const candidates = [6, 12, 24, 36, 48, 72, 96, 120, 168, 240, 336, 504, 720];
  return candidates.find((c) => c >= v * 1.05) ?? Math.ceil((v * 1.1) / 24) * 24;
}

function niceTicks(max: number, count: number): number[] {
  const step = max / count;
  return Array.from({ length: count + 1 }, (_, i) => Math.round(step * i));
}
