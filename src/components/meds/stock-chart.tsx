"use client";

import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceArea, ReferenceDot, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { fmtDate, fmtDay, fromDayNum, toDayNum, type ISODate } from "@/lib/meds/dates";
import { fmtQty, formatRegimenShort } from "@/lib/meds/format";
import {
  SLOTS,
  SLOT_LABEL,
  SLOT_TAKEN_AT,
  finalDose,
  type DateRange,
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
  regimen: { label: "规律变更", theme: { light: "#d97706", dark: "#c98112" } },
  end: { label: "耗尽", theme: { light: "#b3262e", dark: "#c9343c" } },
  visit: { label: "就诊", theme: { light: "#a8329a", dark: "#c24fb5" } },
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
      <div className="font-medium tabular-nums">{fmtDate(day.date)}</div>
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
      {(day.supplied > 0 || day.regimenChanged || day.paused) && (
        <div className="grid gap-0.5">
          {day.paused && <div>住院中：不消耗家里的药</div>}
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
  visits = [],
  stays = [],
  className,
}: {
  sim: Simulation;
  now: Moment;
  balanceNow: number;
  /** Upcoming visit dates, drawn as vertical lines. */
  visits?: readonly ISODate[];
  /** Hospital stays, shaded. */
  stays?: readonly DateRange[];
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
      // The timeline may run on past the run-out (to cover planned visits), so place the dot at
      // the final dose: its slot time, or the end of that day when doses are drawn per day.
      if (!last) endX = points[0].x;
      else endX = toDayNum(last.date) + (slotMode ? SLOT_TAKEN_AT[last.slot] / 1440 : 1);
    }
    return { points, ticks: buildTicks(minX, maxX), domain: [minX, maxX] as [number, number], endX };
  }, [sim, split, slotMode, balanceNow]);
  const visitXs = visits.map(toDayNum).filter((x) => x >= domain[0] && x <= domain[1]);
  const stayXs = stays
    .map((s) => [Math.max(toDayNum(s.start), domain[0]), Math.min(toDayNum(s.end) + 1, domain[1])] as const)
    .filter(([a, b]) => a < b);

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
          {stayXs.map(([x1, x2]) => (
            <ReferenceArea
              key={`stay-${x1}`}
              x1={x1}
              x2={x2}
              fill="var(--muted-foreground)"
              fillOpacity={0.12}
              strokeOpacity={0}
              ifOverflow="hidden"
              label={{ value: "住院", position: "insideTop", fontSize: 11, fill: "var(--muted-foreground)" }}
            />
          ))}
          <XAxis
            dataKey="x"
            interval="preserveStartEnd"
            type="number"
            domain={domain}
            ticks={ticks}
            tickFormatter={(x: number) => fmtDay(fromDayNum(x))}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={24}
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
          {visitXs.map((x) => (
            <ReferenceLine
              key={`visit-${x}`}
              x={x}
              stroke="var(--color-visit)"
              strokeWidth={1.5}
              strokeDasharray="2 3"
              label={{ value: "就诊", position: "insideTopRight", fontSize: 11, fill: "var(--color-visit)" }}
            />
          ))}
          {endX !== null && (
            <ReferenceDot x={endX} y={0} r={5} fill="var(--color-end)" stroke="var(--background)" strokeWidth={2} />
          )}
        </AreaChart>
      </ChartContainer>
      <ChartLegend nowLabel={slotMode ? "现在" : "今天"} visits={visitXs.length > 0} stays={stayXs.length > 0} />
    </div>
  );
}

function ChartLegend({ nowLabel, visits, stays }: { nowLabel: string; visits: boolean; stays: boolean }) {
  return (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <svg width="18" height="8" aria-hidden>
          <line x1="0" y1="4" x2="18" y2="4" className="stroke-[#2a78d6] dark:stroke-[#3987e5]" strokeWidth="2" />
        </svg>
        实际余量
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="18" height="8" aria-hidden>
          <line x1="0" y1="4" x2="18" y2="4" className="stroke-[#2a78d6] dark:stroke-[#3987e5]" strokeWidth="2" strokeDasharray="5 3" />
        </svg>
        按规律推演
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="10" height="10" aria-hidden>
          <circle cx="5" cy="5" r="4.5" className="fill-[#1baf7a] dark:fill-[#199e70]" />
        </svg>
        补药
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="10" height="10" aria-hidden>
          <rect x="1.5" y="1.5" width="7" height="7" transform="rotate(45 5 5)" className="fill-[#d97706] dark:fill-[#c98112]" />
        </svg>
        规律变更
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="10" height="10" aria-hidden>
          <circle cx="5" cy="5" r="4.5" className="fill-[#b3262e] dark:fill-[#c9343c]" />
        </svg>
        耗尽
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="2" height="12" aria-hidden>
          <line x1="1" y1="0" x2="1" y2="12" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" />
        </svg>
        {nowLabel}
      </span>
      {visits && (
        <span className="flex items-center gap-1.5">
          <svg width="2" height="12" aria-hidden>
            <line x1="1" y1="0" x2="1" y2="12" className="stroke-[#a8329a] dark:stroke-[#c24fb5]" strokeWidth="1.5" strokeDasharray="2 2" />
          </svg>
          就诊
        </span>
      )}
      {stays && (
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm bg-muted-foreground/20" aria-hidden />
          住院（不消耗）
        </span>
      )}
    </div>
  );
}
