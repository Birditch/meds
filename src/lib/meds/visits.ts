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
 * Visits are on Thursdays, usually every 4 weeks, often at the start of a month (days 1–10,
 * when the hospital has imported drugs). A visit counts the stock left after Wednesday evening
 * and must cover through the Wednesday evening before the next visit. The last visit has no
 * successor, so its period is assumed to be the usual 4 weeks: through the Wednesday evening
 * before the Thursday 4 weeks later. Entering that next visit (say, pushed back to a month
 * start) replaces the assumption.
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
  /** coverUntil was assumed from the usual 4 weeks (no later visit entered). */
  estimated: boolean;
  /** Pills the regimen takes in the period (hospital days excluded, only doses still ahead). */
  demand: number;
  /** Pills already logged as supplies within the period. */
  supplied: number;
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
  /**
   * Stock runs short before the first upcoming visit: how much, from when, and the last
   * Thursday (not before today) a visit would still prevent it, if any.
   */
  beforeFirst: { shortfall: number; from: SlotRef; latestVisit: ISODate | null } | null;
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

/**
 * Visits are on Thursdays. A visit's prescription starts with that Thursday's doses; the
 * stock counted for it is what is left after Wednesday evening's dose.
 */
export const CLINIC_WEEKDAY = 4; // 0 = Sunday
export const CLINIC_DAY = "周四";
const weekdayOf = (date: ISODate) => (((toDayNum(date) + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday
export const isClinicDay = (date: ISODate) => weekdayOf(date) === CLINIC_WEEKDAY;
/** The first clinic day (Thursday) on or after `date`. */
export const clinicDayOnOrAfter = (date: ISODate) => addDays(date, (CLINIC_WEEKDAY - weekdayOf(date) + 7) % 7);
/** The last clinic day (Thursday) on or before `date`. */
export const clinicDayOnOrBefore = (date: ISODate) => addDays(date, -((weekdayOf(date) - CLINIC_WEEKDAY + 7) % 7));
/** The clinic day (Thursday) closest to `date`, at most 3 days away. */
export const nearestClinicDay = (date: ISODate) => addDays(date, ((CLINIC_WEEKDAY - weekdayOf(date) + 10) % 7) - 3);

/** The usual follow-up: the Thursday about 4 weeks later, pushed back whole weeks into a month start. */
export function usualNextVisit(date: ISODate): { fourWeeks: ISODate; monthStart: ISODate } {
  const fourWeeks = nearestClinicDay(addDays(date, 28));
  let monthStart = fourWeeks;
  while (!isMonthStart(monthStart)) monthStart = addDays(monthStart, 7);
  return { fourWeeks, monthStart };
}

/** The first month-start Thursday on or after `date`. */
export function nearestMonthStartVisit(date: ISODate): ISODate {
  let d = clinicDayOnOrAfter(date);
  while (!isMonthStart(d)) d = addDays(d, 7);
  return d;
}

/** "4 周", "4 周 6 天" */
const weeksText = (days: number) => (days % 7 ? `${Math.floor(days / 7)} 周 ${days % 7} 天` : `${days / 7} 周`);

export interface VisitSuggestions {
  /** In date order. */
  options: { label: string; date: ISODate }[];
  /** The one to preselect: the usual month-start Thursday. */
  preferred: ISODate;
}

/**
 * Thursdays to offer for the next visit: about 4 weeks after the latest visit and, when that
 * is not a month start, pushed back whole weeks into one. Without a recent visit, count from
 * today and also offer the nearest month-start Thursday.
 */
export function suggestNextVisit(last: ISODate | null, today: ISODate): VisitSuggestions {
  const options: { label: string; date: ISODate }[] = [];
  const add = (label: string, date: ISODate) => {
    if (!options.some((o) => o.date === date)) options.push({ label, date });
  };
  const fromLast = !!last && usualNextVisit(last).fourWeeks >= today;
  const base = fromLast ? last! : today;
  const { fourWeeks, monthStart } = usualNextVisit(base);
  const span = (d: ISODate) => (fromLast ? `距上次 ${weeksText(diffDays(d, base))}` : "");
  if (fourWeeks === monthStart) {
    add(fromLast ? `${span(fourWeeks)}（月初）` : "4 周后（月初）", fourWeeks);
  } else {
    add(fromLast ? span(fourWeeks) : "4 周后", fourWeeks);
    add(fromLast ? `顺延到月初（${span(monthStart)}）` : "顺延到月初", monthStart);
  }
  if (!fromLast) add("最近的月初", nearestMonthStartVisit(today));
  options.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { options, preferred: monthStart };
}

/** Upcoming visits (today included) with the period each one covers. */
export function scheduleVisits(visits: readonly VisitInput[], today: ISODate): VisitSchedule[] {
  const upcoming = [...new Set(visits.map((v) => v.date))].filter((d) => d >= today).sort();
  return upcoming.map((date, i) => {
    const next = upcoming[i + 1];
    return next
      ? { date, endDay: toDayNum(next), estimated: false }
      : { date, endDay: toDayNum(usualNextVisit(date).fourWeeks), estimated: true };
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

  /** Unmet demand (required − taken) in [fromDay, toDay), counting only slots after now; also all that is required, and supplied. */
  const shortIn = (fromDay: number, toDay: number) => {
    let total = 0;
    let required = 0;
    let supplied = 0;
    let firstShort: SlotRef | null = null;
    for (let day = Math.max(fromDay, first); day < toDay; day++) {
      const snap = sim.days[day - first];
      if (!snap) break;
      supplied += snap.supplied;
      snap.slots.forEach((s, k) => {
        if (slotPos(day, k) <= doneUpTo) return;
        required += s.required;
        if (s.taken >= s.required) return;
        total += s.required - s.taken;
        firstShort ??= { date: snap.date, slot: SLOTS[k] };
      });
    }
    // Assigned inside the callback, which TypeScript's narrowing does not follow.
    return { total, required, supplied, firstShort: firstShort as SlotRef | null };
  };

  const baseStock = (date: ISODate) =>
    date === now.date ? balanceAt(sim, now) : balanceAt(sim, { date: addDays(date, -1), slotsDone: 3 });

  let short = 0; // S: unmet demand of the current timeline over the periods so far
  let got = 0; // C: pills got at the visits so far
  const visits = schedule.map((v): VisitNeed => {
    const stockBefore = baseStock(v.date) + got - short;
    const period = shortIn(toDayNum(v.date), v.endDay);
    short += period.total;
    const need = Math.max(0, short - got);
    const packs = perBox ? Math.ceil(need / perBox) : null;
    const prescribed = packs !== null && perBox ? packs * perBox : need;
    got += prescribed;
    return {
      date: v.date,
      coverUntil: fromDayNum(v.endDay - 1),
      estimated: v.estimated,
      demand: period.required,
      supplied: period.supplied,
      stockBefore,
      need,
      packs,
      prescribed,
    };
  });

  let beforeFirst: VisitPlan["beforeFirst"] = null;
  if (schedule.length > 0) {
    const gap = shortIn(toDayNum(now.date), toDayNum(schedule[0].date));
    if (gap.total > 0 && gap.firstShort) {
      // A visit's supply counts before that day's morning dose, so the gap's own day still works.
      const latest = clinicDayOnOrBefore(gap.firstShort.date);
      beforeFirst = { shortfall: gap.total, from: gap.firstShort, latestVisit: latest >= now.date ? latest : null };
    }
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
