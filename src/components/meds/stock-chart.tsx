"use client";

import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceDot, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { fromDayNum, toDayNum } from "@/lib/meds/dates";
import { fmtQty, formatRegimenShort } from "@/lib/meds/format";
import {
  SLOTS,
  SLOT_LABEL,
  SLOT_TAKEN_AT,
  finalDose,
  type DaySnapshot,
  type Moment,
  type Simulation,
  type SlotOutcome,
} from "@/lib/meds/simulate";

/*
 * Time is continuous on the x axis: x = day number, x = d is 00:00 of day d.
 * Each day contributes a point at its start (after that day's supply). A supply day adds a
 * point just before it at the same x, so the line jumps vertically. A final point at
 * last+1 closes the last day.
 *
 * Short timelines ("slot" mode) also get a vertical drop at each dose time (08:00 / 12:00 /
 * 18:00), so the line is an exact staircase and history/projection split at the current
 * slot. Long ones ("day" mode) draw doses as a straight line across each day and split at
 * the start of today. Either way the tooltip spells out the slot-by-slot detail.
 */

const SLOT_MODE_MAX_DAYS = 92;
const SPLIT_EPSILON = 0.01;

interface Point {
  x: number;
  /** Index into sim.days for the tooltip. */
  idx: number;
  history?: number;
  projection?: number;
  marker?: "supply" | "regimen" | "both";
}

/** Where history ends: start of today (day mode) or just after the last slot taken (slot mode). */
function splitPoint(now: Moment, slotMode: boolean): number {
  const today = toDayNum(now.date);
  if (!slotMode) return today;
  const offset = now.slotsDone === 0 ? 0 : SLOT_TAKEN_AT[SLOTS[now.slotsDone - 1]] / 1440;
  return today + offset + SPLIT_EPSILON;
}

const chartConfig = {
  history: { label: "实际余量", theme: { light: "#2a78d6", dark: "#3987e5" } },
  projection: { label: "按规律推演", theme: { light: "#2a78d6", dark: "#3987e5" } },
  supply: { label: "补药", theme: { light: "#1baf7a", dark: "#199e70" } },
  regimen: { label: "规律变更", theme: { light: "#eb6834", dark: "#d95926" } },
  end: { label: "耗尽", theme: { light: "#d03b3b", dark: "#d03b3b" } },
} satisfies ChartConfig;

function buildPoints(sim: Simulation, split: number, slotMode: boolean, balanceNow: number): Point[] {
  const points: Point[] = [];
  const put = (x: number, idx: number, y: number, marker?: Point["marker"]) => {
    points.push({
      x,
      idx,
      history: x <= split ? y : undefined,
      projection: x >= split ? y : undefined,
      marker,
    });
  };
  let splitPlaced = false;
  const placeSplitBefore = (x: number, idx: number) => {
    // In slot mode the split falls between points; give both series a shared point there.
    if (slotMode && !splitPlaced && split < x && split > (points.at(-1)?.x ?? -Infinity)) {
      put(split, idx, balanceNow);
      splitPlaced = true;
    }
  };

  sim.days.forEach((d, i) => {
    const prevEnd = i > 0 ? sim.days[i - 1].endOfDayBalance : 0;
    placeSplitBefore(d.day, i);
    if (d.supplied > 0) put(d.day, i, prevEnd);
    const marker = d.supplied > 0 && d.regimenChanged ? "both" : d.supplied > 0 ? "supply" : d.regimenChanged ? "regimen" : undefined;
    put(d.day, i, d.startBalance, marker);
    if (!slotMode) return;
    let before = d.startBalance;
    d.slots.forEach((s, k) => {
      if (s.taken > 0) {
        const x = d.day + SLOT_TAKEN_AT[SLOTS[k]] / 1440;
        placeSplitBefore(x, i);
        put(x, i, before);
        put(x, i, s.after);
      }
      before = s.after;
    });
  });
  const last = sim.days[sim.days.length - 1];
  placeSplitBefore(last.day + 1, sim.days.length - 1);
  put(last.day + 1, sim.days.length - 1, last.endOfDayBalance);
  return points;
}

/** Both ends plus month starts (or weeks for short spans); recharts drops ticks that would overlap. */
function buildTicks(min: number, max: number): number[] {
  const span = max - min;
  if (span <= 45) {
    const step = span <= 14 ? 2 : 7;
    const ticks: number[] = [];
    for (let x = min; x < max; x += step) ticks.push(x);
    return [...ticks, max];
  }
  const monthStep = span <= 400 ? 1 : span <= 1100 ? 3 : 12;
  const ticks: number[] = [min];
  const [y0, m0] = fromDayNum(min).split("-").map(Number);
  const gap = Math.max(7, span / 20);
  for (let k = monthStep; ; k += monthStep) {
    const y = y0 + Math.floor((m0 - 1 + k) / 12);
    const m = ((m0 - 1 + k) % 12) + 1;
    const x = toDayNum(`${y}-${String(m).padStart(2, "0")}-01`);
    if (x > max - gap) break;
    if (x - min >= gap) ticks.push(x);
  }
  return [...ticks, max];
}

function SlotLine({ s }: { s: SlotOutcome }) {
  const label = SLOT_LABEL[s.slot];
  let text: string;
  let cls = "";
  switch (s.status) {
    case "none":
      text = "不服";
      cls = "text-muted-foreground";
      break;
    case "full":
      text = `−${fmtQty(s.taken)} → 剩 ${fmtQty(s.after)}`;
      break;
    case "partial":
      text = `仅 ${fmtQty(s.taken)}/${fmtQty(s.required)} → 剩 0（不足一顿）`;
      cls = "text-destructive font-medium";
      break;
    case "missed":
      text = `缺药（需 ${fmtQty(s.required)}）`;
      cls = "text-destructive";
      break;
  }
  return (
    <div className="flex gap-2">
      <span className="w-4 text-muted-foreground">{label}</span>
      <span className={`tabular-nums ${cls}`}>{text}</span>
    </div>
  );
}

function DayTooltip({ day }: { day: DaySnapshot }) {
  const required = day.slots.reduce((a, s) => a + s.required, 0);
  return (
    <div className="grid min-w-52 gap-1.5 rounded-lg border bg-background px-3 py-2 text-xs shadow-lg">
      <div className="font-medium tabular-nums">{day.date}</div>
      <div className="text-muted-foreground">
        {day.regimen ? (
          <>
            当日规律：早 {fmtQty(day.regimen.morning)} / 中 {fmtQty(day.regimen.noon)} / 晚 {fmtQty(day.regimen.evening)}
            （当日共消耗 {fmtQty(day.taken)} 颗{day.taken < required ? `，应服 ${fmtQty(required)}` : ""}）
          </>
        ) : (
          "当日尚无生效规律"
        )}
      </div>
      {(day.supplied > 0 || day.regimenChanged) && (
        <div className="grid gap-0.5">
          {day.supplied > 0 && <div>➕ 补药 +{fmtQty(day.supplied)} 颗</div>}
          {day.regimenChanged && day.regimen && <div>⚙️ 规律变更为 {formatRegimenShort(day.regimen)}</div>}
        </div>
      )}
      <div className="grid gap-0.5 border-t pt-1.5">
        <div className="flex gap-2 text-muted-foreground">
          <span className="w-4">始</span>
          <span className="tabular-nums">{fmtQty(day.startBalance)} 颗</span>
        </div>
        {day.slots.map((s) => (
          <SlotLine key={s.slot} s={s} />
        ))}
      </div>
    </div>
  );
}

function Marker(props: { cx?: number; cy?: number; payload?: Point; index?: number }) {
  const { cx, cy, payload, index } = props;
  if (cx == null || cy == null || !payload?.marker) return <g key={`m-${index}`} />;
  const supply = payload.marker === "supply" || payload.marker === "both";
  const regimen = payload.marker === "regimen" || payload.marker === "both";
  return (
    <g key={`m-${index}`}>
      {regimen && (
        <rect
          x={cx - 5.5}
          y={cy - 5.5}
          width={11}
          height={11}
          transform={`rotate(45 ${cx} ${cy})`}
          fill="var(--color-regimen)"
          stroke="var(--background)"
          strokeWidth={2}
        />
      )}
      {supply && (
        <circle cx={cx} cy={cy} r={regimen ? 3.5 : 5} fill="var(--color-supply)" stroke="var(--background)" strokeWidth={2} />
      )}
    </g>
  );
}

export function StockChart({
  sim,
  now,
  balanceNow,
  className,
}: {
  sim: Simulation;
  now: Moment;
  balanceNow: number;
  className?: string;
}) {
  const slotMode = sim.days.length <= SLOT_MODE_MAX_DAYS;
  const split = splitPoint(now, slotMode);
  const { points, ticks, domain, endX } = useMemo(() => {
    const points = buildPoints(sim, split, slotMode, balanceNow);
    const minX = Math.floor(Math.min(points[0].x, split));
    const maxX = Math.ceil(Math.max(points[points.length - 1].x, split));
    const last = finalDose(sim.outcome);
    let endX: number | null = null;
    if (sim.outcome.kind === "depleted") {
      endX = slotMode && last ? toDayNum(last.date) + SLOT_TAKEN_AT[last.slot] / 1440 : points[points.length - 1].x;
    }
    return { points, ticks: buildTicks(minX, maxX), domain: [minX, maxX] as [number, number], endX };
  }, [sim, split, slotMode, balanceNow]);

  return (
    <div className={className}>
      <p className="mb-1 text-xs text-muted-foreground">余量（颗）· 悬停查看每天早 / 中 / 晚明细</p>
      <ChartContainer config={chartConfig} className="aspect-auto h-72 w-full">
        <AreaChart data={points} margin={{ top: 16, right: 16, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="fill-history" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-history)" stopOpacity={0.18} />
              <stop offset="100%" stopColor="var(--color-history)" stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="x"
            interval="preserveStartEnd"
            type="number"
            domain={domain}
            ticks={ticks}
            tickFormatter={(x: number) => fromDayNum(x)}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={28}
            fontSize={11}
          />
          <YAxis
            width={44}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            fontSize={11}
            tickFormatter={(v: number) => `${v}`}
          />
          <ChartTooltip
            cursor={{ strokeDasharray: "4 4" }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as Point | undefined;
              if (!active || !p) return null;
              return <DayTooltip day={sim.days[p.idx]} />;
            }}
          />
          <Area
            dataKey="history"
            type="linear"
            stroke="var(--color-history)"
            strokeWidth={2}
            fill="url(#fill-history)"
            connectNulls={false}
            isAnimationActive={false}
            dot={<Marker />}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--background)" }}
          />
          <Area
            dataKey="projection"
            type="linear"
            stroke="var(--color-projection)"
            strokeWidth={2}
            strokeDasharray="6 4"
            fill="var(--color-projection)"
            fillOpacity={0.06}
            connectNulls={false}
            isAnimationActive={false}
            dot={<Marker />}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--background)" }}
          />
          <ReferenceLine
            x={split}
            stroke="var(--muted-foreground)"
            strokeDasharray="4 4"
            label={{ value: slotMode ? "现在" : "今天", position: "top", fontSize: 11, fill: "var(--muted-foreground)" }}
          />
          {endX !== null && (
            <ReferenceDot x={endX} y={0} r={5} fill="var(--color-end)" stroke="var(--background)" strokeWidth={2} />
          )}
        </AreaChart>
      </ChartContainer>
      <ChartLegend nowLabel={slotMode ? "现在" : "今天"} />
    </div>
  );
}

function ChartLegend({ nowLabel }: { nowLabel: string }) {
  return (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <svg width="18" height="8" aria-hidden>
          <line x1="0" y1="4" x2="18" y2="4" stroke="#2a78d6" strokeWidth="2" />
        </svg>
        实际余量
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="18" height="8" aria-hidden>
          <line x1="0" y1="4" x2="18" y2="4" stroke="#2a78d6" strokeWidth="2" strokeDasharray="5 3" />
        </svg>
        按规律推演
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="10" height="10" aria-hidden>
          <circle cx="5" cy="5" r="4.5" fill="#1baf7a" />
        </svg>
        补药
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="10" height="10" aria-hidden>
          <rect x="1.5" y="1.5" width="7" height="7" transform="rotate(45 5 5)" fill="#eb6834" />
        </svg>
        规律变更
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="10" height="10" aria-hidden>
          <circle cx="5" cy="5" r="4.5" fill="#d03b3b" />
        </svg>
        耗尽
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="2" height="12" aria-hidden>
          <line x1="1" y1="0" x2="1" y2="12" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" />
        </svg>
        {nowLabel}
      </span>
    </div>
  );
}
