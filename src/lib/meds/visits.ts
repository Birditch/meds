/**
 * Doctor-visit planning: how much to get at each upcoming visit so the stock at home lasts
 * to the next visit without touching the reserve.
 *
 * Visits are shared by all medications. The prescription at visit k must last from that
 * day up to the day before visit k+1. Everything is computed from the current records
 * (stock, logged supplies, regimen timeline, hospital stays).
 *
 * Stock never goes negative, so pills added at some visit cut the later unmet demand of the
 * current timeline in time order, one for one. Let S_k be that timeline's unmet demand
 * summed over periods 1..k, and C_k the pills got at visits 1..k. Visit k then needs
 * max(0, S_k − C_{k−1}). With an exact prescription each period just closes its own gap, so
 * the amounts never double-count. With whole boxes or bottles, C_k ≥ S_k and the extra pills carry
 * over: visit k arrives with the current-timeline stock plus C_{k−1} − S_{k−1}.
 *
 * Visits are usually about every 4 weeks, at the start of a month (days 1–10, when the
 * hospital has imported drugs). The last visit has no successor, so its period is assumed
 * to run to the usual next one: 4 weeks later, pushed back whole weeks into a month start.
 */

import { addDays, diffDays, fromDayNum, toDayNum, type ISODate } from "./dates";
import { SLOTS, balanceAt, type Moment, type Simulation, type SlotRef } from "./simulate";

export interface VisitInput {
  id?: number;
  date: ISODate;
}

export interface VisitNeed {
  date: ISODate;
  /** Last day this visit's prescription has to cover. */
  coverUntil: ISODate;
  /** coverUntil was assumed from the usual 4-week, month-start rhythm (no later visit entered). */
  estimated: boolean;
  /** Stock expected when arriving (before that day's supplies and doses), if earlier visits follow the plan. */
  stockBefore: number;
  /** Pills still lacking for the period after what earlier visits got; 0 = already covered. */
  need: number;
  /** Whole packs (boxes / bottles) to get, when pills per pack is known. */
  packs: number | null;
  /** Pills got under the plan: packs × pills per pack, or exactly the need. */
  prescribed: number;
}

export interface VisitPlan {
  /** Stock runs short before the first upcoming visit: how much and from when. */
  beforeFirst: { shortfall: number; from: SlotRef } | null;
  visits: VisitNeed[];
}

export interface VisitSchedule {
  date: ISODate;
  /** Exclusive end day of the period this visit covers. */
  endDay: number;
  estimated: boolean;
}

/** The first 10 days of a month, when the hospital has imported drugs. */
export const MONTH_START_DAYS = 10;
export const isMonthStart = (date: ISODate) => Number(date.slice(8, 10)) <= MONTH_START_DAYS;

/** The usual follow-up: 4 weeks later, and that pushed back by whole weeks into a month start. */
export function usualNextVisit(date: ISODate): { fourWeeks: ISODate; monthStart: ISODate } {
  const fourWeeks = addDays(date, 28);
  let monthStart = fourWeeks;
  while (!isMonthStart(monthStart)) monthStart = addDays(monthStart, 7);
  return { fourWeeks, monthStart };
}

/** The first month-start day on or after `date`. */
export function nearestMonthStart(date: ISODate): ISODate {
  if (isMonthStart(date)) return date;
  const [y, m] = date.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/**
 * Dates to offer for the next visit: 4 weeks after the latest visit and, when that is not a
 * month start, the same weekday pushed back into one. Without a recent visit, count from today
 * and also offer the nearest month start.
 */
export function suggestNextVisit(last: ISODate | null, today: ISODate): { label: string; date: ISODate }[] {
  const out: { label: string; date: ISODate }[] = [];
  const fromLast = !!last && addDays(last, 28) >= today;
  const base = fromLast ? last! : today;
  if (!fromLast) {
    const nearest = nearestMonthStart(today);
    if (nearest !== today) out.push({ label: "最近的月初", date: nearest });
  }
  const from = fromLast ? "距上次 " : "";
  const { fourWeeks, monthStart } = usualNextVisit(base);
  if (fourWeeks === monthStart) {
    out.push({ label: `${from}4 周（月初）`, date: fourWeeks });
  } else {
    const weeks = 4 + diffDays(monthStart, fourWeeks) / 7;
    out.push({ label: `${from}4 周`, date: fourWeeks }, { label: `顺延到月初（${from}${weeks} 周）`, date: monthStart });
  }
  return out;
}

/** Upcoming visits (today included) with the period each one covers. */
export function scheduleVisits(visits: readonly VisitInput[], today: ISODate): VisitSchedule[] {
  const upcoming = [...new Set(visits.map((v) => v.date))].filter((d) => d >= today).sort();
  return upcoming.map((date, i) => {
    const next = upcoming[i + 1];
    return next
      ? { date, endDay: toDayNum(next), estimated: false }
      : { date, endDay: toDayNum(usualNextVisit(date).monthStart), estimated: true };
  });
}

/** The last day the simulation must reach for this schedule (pass as `simulate({ until })`). */
export function planHorizon(schedule: readonly VisitSchedule[]): ISODate | undefined {
  return schedule.length ? fromDayNum(Math.max(...schedule.map((s) => s.endDay)) - 1) : undefined;
}

const slotPos = (day: number, slot: number) => day * 3 + slot;

export function planVisits(
  sim: Simulation,
  schedule: readonly VisitSchedule[],
  now: Moment,
  perBox: number | null = null,
): VisitPlan {
  const doneUpTo = slotPos(toDayNum(now.date), now.slotsDone - 1);
  const first = sim.days[0]?.day ?? Infinity;

  /** Unmet demand (required − taken) in [fromDay, toDay), counting only slots after now. */
  const shortIn = (fromDay: number, toDay: number) => {
    let total = 0;
    let firstShort: SlotRef | null = null;
    for (let day = Math.max(fromDay, first); day < toDay; day++) {
      const snap = sim.days[day - first];
      if (!snap) break;
      snap.slots.forEach((s, k) => {
        if (slotPos(day, k) <= doneUpTo || s.taken >= s.required) return;
        total += s.required - s.taken;
        firstShort ??= { date: snap.date, slot: SLOTS[k] };
      });
    }
    return { total, firstShort };
  };

  const baseStock = (date: ISODate) =>
    date === now.date ? balanceAt(sim, now) : balanceAt(sim, { date: addDays(date, -1), slotsDone: 3 });

  let short = 0; // S: unmet demand of the current timeline over the periods so far
  let got = 0; // C: pills got at the visits so far
  const visits = schedule.map((v): VisitNeed => {
    const stockBefore = baseStock(v.date) + got - short;
    short += shortIn(toDayNum(v.date), v.endDay).total;
    const need = Math.max(0, short - got);
    const packs = perBox ? Math.ceil(need / perBox) : null;
    const prescribed = packs !== null && perBox ? packs * perBox : need;
    got += prescribed;
    return { date: v.date, coverUntil: fromDayNum(v.endDay - 1), estimated: v.estimated, stockBefore, need, packs, prescribed };
  });

  let beforeFirst: VisitPlan["beforeFirst"] = null;
  if (schedule.length > 0) {
    const gap = shortIn(toDayNum(now.date), toDayNum(schedule[0].date));
    if (gap.total > 0 && gap.firstShort) beforeFirst = { shortfall: gap.total, from: gap.firstShort };
  }
  return { beforeFirst, visits };
}

/** "下次", "下下次", then "第 3 次"… */
export const visitOrdinal = (i: number) => (i === 0 ? "下次" : i === 1 ? "下下次" : `第 ${i + 1} 次`);

export { weekdayCN } from "./dates";

/** "35 天（5 周）", "30 天（4 周 2 天）" */
export function spanText(days: number): string {
  const w = Math.floor(days / 7);
  const d = days % 7;
  if (w === 0) return `${days} 天`;
  return `${days} 天（${w} 周${d ? ` ${d} 天` : ""}）`;
}

export const daysFromToday = (date: ISODate, today: ISODate) => {
  const d = diffDays(date, today);
  return d === 0 ? "今天" : d === 1 ? "明天" : `${d} 天后`;
};
