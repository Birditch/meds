/**
 * What hospital stays (住院) change in the numbers, spelled out for the printed lists.
 *
 * In hospital the doses come from the hospital, so nothing is taken from home stock on those
 * days (the day of admission and the day of discharge included). The projection already leaves
 * them out; this says, per medication, which hospital days fall where (already behind the stock
 * now, before a visit, in the period a visit covers), what the regimen would have taken on them,
 * and what each figure would be without the stays — so every number a stay changed is explained.
 */

import { addDays, diffDays, fmtDate, fmtDay, toDayNum, weekdayCN, type ISODate } from "./dates";
import { COUNT_MOMENT_LABEL, fmtQty, type MedicationStatus } from "./format";
import { SLOT_NAME, fullDays, type DateRange, type Moment, type Simulation, type SlotRef } from "./simulate";
import type { CountRecord } from "./types";
import type { VisitNeed } from "./visits";

const pos = (day: number, slot: number) => day * 3 + slot;
/** The last slot done at `m` (−1 of its day before the morning dose). */
const donePos = (m: Moment) => pos(toDayNum(m.date), m.slotsDone - 1);

/** Dose slots after `after` up to and including `through` (slot positions). */
export interface SlotWindow {
  after: number;
  through: number;
}

export interface HospitalPart {
  /** Hospital days with a slot in the window, as runs of consecutive days. */
  runs: DateRange[];
  days: number;
  /** What the regimen would have taken in those slots; none of it comes from home stock. */
  doses: number;
}

export interface HomePart {
  /** Days at home with a slot in the window. */
  days: number;
  /** Pills taken from home stock in those slots. */
  taken: number;
  /** Supplies logged on those days. */
  supplied: number;
}

const inWindow = (w: SlotWindow, day: number) => [0, 1, 2].filter((k) => pos(day, k) > w.after && pos(day, k) <= w.through);

/** The hospital days of a projection in a window, and what the regimen would have taken on them. */
export function hospitalPart(sim: Simulation, w: SlotWindow): HospitalPart {
  const runs: DateRange[] = [];
  let days = 0;
  let halves = 0;
  let previous = Number.NEGATIVE_INFINITY;
  for (const snap of sim.days) {
    if (!snap.paused) continue;
    const slots = inWindow(w, snap.day);
    if (!slots.length) continue;
    days++;
    const r = snap.regimen;
    if (r) halves += slots.reduce((n, k) => n + Math.round([r.morning, r.noon, r.evening][k] * 2), 0);
    if (snap.day === previous + 1) runs[runs.length - 1].end = snap.date;
    else runs.push({ start: snap.date, end: snap.date });
    previous = snap.day;
  }
  return { runs, days, doses: halves / 2 };
}

/**
 * The days at home in a window: what was taken from the stock, and the supplies logged after
 * `today` (a day's supply is already in the stock from that day's start on).
 */
export function homePart(sim: Simulation, w: SlotWindow, today: ISODate): HomePart {
  let days = 0;
  let taken = 0;
  let supplied = 0;
  for (const snap of sim.days) {
    const slots = inWindow(w, snap.day);
    if (!slots.length) continue;
    if (snap.date > today) supplied += snap.supplied;
    if (snap.paused) continue;
    days++;
    taken += slots.reduce((n, k) => n + snap.slots[k].taken, 0);
  }
  return { days, taken, supplied };
}

export interface Compared<T> {
  /** As projected: hospital days not taken from home stock. */
  with: T;
  /** The same records, as if there had been no stay. */
  without: T;
}

/** The latest stock count at or before `now`: the stock is what was counted from then on. */
export function latestCount(counts: readonly Pick<CountRecord, "date" | "slotsDone" | "recordedAt">[], now: Moment): Moment | null {
  const until = donePos(now);
  let best: (Moment & { at: number; recordedAt: number }) | null = null;
  for (const c of counts) {
    const at = pos(toDayNum(c.date), c.slotsDone - 1);
    if (at > until) continue;
    if (!best || at > best.at || (at === best.at && c.recordedAt > best.recordedAt)) {
      best = { date: c.date, slotsDone: c.slotsDone as Moment["slotsDone"], at, recordedAt: c.recordedAt };
    }
  }
  return best && { date: best.date, slotsDone: best.slotsDone };
}

export interface PastStay {
  /** Hospital days behind the stock now, after its latest count. */
  past: HospitalPart;
  /** That count, when there is one. */
  countedAt: Moment | null;
  /** Hospital days before that count: the count replaced whatever they changed. */
  beforeCount: HospitalPart;
}

function pastStay(sim: Simulation, counts: readonly CountRecord[], now: Moment): PastStay {
  const countedAt = latestCount(counts, now);
  const from = countedAt ? donePos(countedAt) : Number.NEGATIVE_INFINITY;
  let beforeCount = EMPTY;
  if (countedAt && sim.days.length) {
    // A stay running when the count was taken: the count replaced what its earlier days changed.
    // (A stay over before the day of the count changes nothing and is not mentioned.)
    const first = sim.days[0].day;
    const paused = (day: number) => sim.days[day - first]?.paused === true;
    let start = toDayNum(countedAt.date);
    if (paused(start)) {
      while (paused(start - 1)) start--;
      beforeCount = hospitalPart(sim, { after: pos(start, -1), through: from });
    }
  }
  return { past: hospitalPart(sim, { after: from, through: donePos(now) }), countedAt, beforeCount };
}

const EMPTY: HospitalPart = { runs: [], days: 0, doses: 0 };

/* ------------------------------------ visit list ------------------------------------ */

export interface VisitStayEffect extends PastStay {
  /** Hospital days after now and before the visit (through the evening before it). */
  beforeVisit: HospitalPart;
  /** The days at home in the same stretch. */
  homeBeforeVisit: HomePart;
  /** Hospital days in the period the visit covers. */
  period: HospitalPart;
  balanceNow: Compared<number>;
  /** Stock arriving at the visit (after the evening before it). */
  stockBefore: Compared<number>;
  /** Pills the period takes. */
  demand: Compared<number>;
  need: Compared<VisitNeed>;
  /** Next visit only: when the stock would run out before it, if it would. */
  runsOutBefore: Compared<SlotRef | null>;
}

/** What the stays change for one medication at one upcoming visit; null when they change nothing. */
export function visitStayEffect(
  status: Compared<MedicationStatus>,
  counts: readonly CountRecord[],
  now: Moment,
  index: number,
): VisitStayEffect | null {
  const need = status.with.plan.visits[index];
  const bare = status.without.plan.visits[index];
  if (!need || !bare) return null;
  const { sim } = status.with;
  const nowAt = donePos(now);
  const visitDay = toDayNum(need.date);
  const beforeWindow = { after: nowAt, through: pos(visitDay - 1, 2) };
  const effect: VisitStayEffect = {
    ...pastStay(sim, counts, now),
    beforeVisit: hospitalPart(sim, beforeWindow),
    homeBeforeVisit: homePart(sim, beforeWindow, now.date),
    period: hospitalPart(sim, { after: Math.max(nowAt, pos(visitDay, -1)), through: pos(toDayNum(need.coverUntil), 2) }),
    balanceNow: { with: status.with.balanceNow, without: status.without.balanceNow },
    stockBefore: { with: need.stockBefore, without: bare.stockBefore },
    demand: { with: need.demand, without: bare.demand },
    need: { with: need, without: bare },
    runsOutBefore: {
      with: index === 0 ? (status.with.plan.beforeFirst?.from ?? null) : null,
      without: index === 0 ? (status.without.plan.beforeFirst?.from ?? null) : null,
    },
  };
  const touched = effect.past.doses + effect.beforeVisit.doses + effect.period.doses > 0;
  const changed =
    effect.balanceNow.with !== effect.balanceNow.without ||
    effect.stockBefore.with !== effect.stockBefore.without ||
    effect.demand.with !== effect.demand.without ||
    need.prescribed !== bare.prescribed;
  return touched || changed ? effect : null;
}

/* ------------------------------------ stock list ------------------------------------ */

export interface StockStayEffect extends PastStay {
  /** Hospital days still ahead (or the rest of today's), while there is stock to last through them. */
  ahead: HospitalPart;
  balanceNow: Compared<number>;
  /** Last day taken in full, when the stock runs out (能吃到). */
  lastFullDay: Compared<ISODate | null>;
  /** The board's sentence for it, e.g. "能吃到：2026.12.14 周一". */
  headline: Compared<string>;
}

export function stockStayEffect(status: Compared<MedicationStatus>, counts: readonly CountRecord[], now: Moment): StockStayEffect | null {
  const { sim } = status.with;
  const effect: StockStayEffect = {
    ...pastStay(sim, counts, now),
    ahead: hospitalPart(sim, { after: donePos(now), through: Number.POSITIVE_INFINITY }),
    balanceNow: { with: status.with.balanceNow, without: status.without.balanceNow },
    lastFullDay: { with: fullDays(sim)?.lastFullDay ?? null, without: fullDays(status.without.sim)?.lastFullDay ?? null },
    headline: { with: status.with.conclusion.headline, without: status.without.conclusion.headline },
  };
  const touched = effect.past.doses + effect.ahead.doses > 0;
  const changed = effect.balanceNow.with !== effect.balanceNow.without || effect.headline.with !== effect.headline.without;
  return touched || changed ? effect : null;
}

/* --------------------------------------- words --------------------------------------- */

/** "11.16", or with the year when it is not `ref`'s. */
export const shortDay = (date: ISODate, ref: ISODate) => (date.slice(0, 4) === ref.slice(0, 4) ? fmtDay(date).slice(5) : fmtDay(date));

/** "11.16–11.23（8 天）", runs joined with "、" and their total. */
export function runsText(part: Pick<HospitalPart, "runs" | "days">, ref: ISODate): string {
  const runs = part.runs.map((r) => {
    const days = diffDays(r.end, r.start) + 1;
    const span = r.start === r.end ? shortDay(r.start, ref) : `${shortDay(r.start, ref)}–${shortDay(r.end, ref)}`;
    return part.runs.length > 1 ? `${span}（${days} 天）` : span;
  });
  return part.runs.length > 1 ? `${runs.join("、")}，共 ${part.days} 天` : `${runs[0]}（${part.days} 天）`;
}

/** "2026.11.16 周一 – 2026.11.27 周五，共 12 天" */
export const stayRangeText = (s: DateRange) =>
  `${fmtDate(s.start)} – ${fmtDate(s.end)}，共 ${diffDays(s.end, s.start) + 1} 天`;

/** 已出院 / 住院中 / 还没入院 */
export const stayState = (s: DateRange, today: ISODate) => (s.end < today ? "已出院" : s.start <= today ? "住院中" : "还没入院");

/** The stays with a day in [from, through]. */
export const staysIn = (stays: readonly DateRange[], from: ISODate, through: ISODate) =>
  [...stays].filter((s) => s.end >= from && s.start <= through).sort((a, b) => (a.start < b.start ? -1 : 1));

/** A stay cut to [from, through], or null when nothing is left. */
export function clip(s: DateRange, from: ISODate, through: ISODate): DateRange | null {
  const start = s.start > from ? s.start : from;
  const end = s.end < through ? s.end : through;
  return start <= end ? { start, end } : null;
}

const pills = (n: number) => `${fmtQty(n)} 颗`;

/** "12.02 周三晚上" */
const eveningOf = (date: ISODate, ref: ISODate) => `${shortDay(date, ref)} ${weekdayCN(date)}晚上`;

/** "11.29 晚上" */
const slotText = (s: SlotRef, ref: ISODate) => `${shortDay(s.date, ref)} ${SLOT_NAME[s.slot]}`;

/** "现在剩 17 颗（不算住院为 9 颗）" for a pair; the plain number when both are the same. */
const pair = (label: string, c: Compared<number>) =>
  c.with === c.without ? `${label} ${pills(c.with)}` : `${label} ${pills(c.with)}（不算住院为 ${pills(c.without)}）`;

/** "11.18 早上服药后盘点" */
const countText = (m: Moment, ref: ISODate) => `${shortDay(m.date, ref)} ${COUNT_MOMENT_LABEL[m.slotsDone]}盘点`;

/** The lines for the stock already behind now: one or two, or none when no hospital day touched it. */
function pastLines(e: PastStay & { balanceNow: Compared<number> }, now: Moment): string[] {
  const lines: string[] = [];
  const ref = now.date;
  if (e.past.days > 0) {
    const since = e.countedAt ? `${countText(e.countedAt, ref)}之后，` : "";
    lines.push(
      e.past.doses > 0
        ? `到现在：${since}住院 ${runsText(e.past, ref)}，按规律本应吃 ${pills(e.past.doses)}，都由医院配发，没从家里扣 → ${pair("现在剩", e.balanceNow)}`
        : `到现在：${since}住院 ${runsText(e.past, ref)}，按规律这几天本来就不吃这种药，不影响现有余量`,
    );
  }
  if (e.beforeCount.doses > 0 && e.countedAt) {
    lines.push(`更早的住院 ${runsText(e.beforeCount, ref)}在 ${countText(e.countedAt, ref)}之前：现有余量按盘点的实数推算，那几天不再另算`);
  }
  return lines;
}

/** "3 盒（16 颗）" or "16 颗" or "无需开药" */
const needWords = (n: VisitNeed, unit: string) =>
  n.need === 0 ? "无需开药" : n.packs !== null ? `${n.packs} ${unit}（缺 ${pills(n.need)}，开 ${pills(n.prescribed)}）` : `${pills(n.need)}`;

/** "4 盒" / "28 颗" / "无需开药": what to get, short. */
export const needShort = (n: VisitNeed, unit: string) =>
  n.need === 0 ? "无需开药" : n.packs !== null ? `${n.packs} ${unit}` : pills(n.need);

/** "少开 1 盒（7 颗）", or 多开; null when the same. */
export function needDelta(e: Pick<VisitStayEffect, "need">, unit: string): string | null {
  const { with: got, without: bare } = e.need;
  const pillsDiff = bare.prescribed - got.prescribed;
  if (pillsDiff === 0) return null;
  const packs = got.packs !== null && bare.packs !== null ? bare.packs - got.packs : null;
  const amount = packs ? `${Math.abs(packs)} ${unit}（${pills(Math.abs(pillsDiff))}）` : pills(Math.abs(pillsDiff));
  return `${pillsDiff > 0 ? "少开" : "多开"} ${amount}`;
}

/** What the stays change in what to get at the visit: one sentence. */
export function needChange(e: Pick<VisitStayEffect, "need">, unit: string): string {
  const { with: got, without: bare } = e.need;
  if (got.prescribed === bare.prescribed) {
    return got.need === 0 ? "有没有住院都无需开药" : `开药量不变：有没有住院都开 ${needWords(got, unit)}`;
  }
  const fewer = bare.prescribed - got.prescribed;
  const packs = got.packs !== null && bare.packs !== null ? bare.packs - got.packs : null;
  const diff = packs ? `${packs} ${unit}（${pills(fewer)}）` : pills(fewer);
  const now = got.need === 0 ? "这次无需开药" : `这次开 ${needWords(got, unit)}`;
  return fewer > 0
    ? `${now}；不算住院要开 ${needWords(bare, unit)}，住院让这次少开 ${diff}`
    : `${now}；不算住院只要开 ${needWords(bare, unit)}，住院让这次多开 ${packs ? `${-packs} ${unit}（${pills(-fewer)}）` : pills(-fewer)}`;
}

/**
 * Every step of how the stays shape one medication's figures at a visit:
 * the stock now, the stock arriving at the visit, the period's need and what to get.
 */
export function visitStayLines(e: VisitStayEffect, visit: { date: ISODate; coverUntil: ISODate; index: number }, now: Moment, unit: string): string[] {
  const ref = now.date;
  const lines = pastLines(e, now);
  // A visit today counts the stock as it is now: nothing comes before it.
  if (visit.date > now.date) {
    const home = e.homeBeforeVisit;
    const homeText =
      home.days > 0
        ? `其余 ${home.days} 天在家，共扣 ${pills(home.taken)}${home.supplied > 0 ? `，期间补药 +${pills(home.supplied)}` : ""}`
        : "其余时间都在住院，不扣药";
    const arithmetic =
      visit.index === 0 && e.balanceNow.with + home.supplied - home.taken === e.stockBefore.with
        ? `：${fmtQty(e.balanceNow.with)}${home.supplied > 0 ? ` + ${fmtQty(home.supplied)}` : ""} − ${fmtQty(home.taken)} = ${pills(e.stockBefore.with)}`
        : "";
    if (e.beforeVisit.days > 0) {
      lines.push(
        e.beforeVisit.doses > 0
          ? `复诊前：住院 ${runsText(e.beforeVisit, ref)}，按规律本应吃 ${pills(e.beforeVisit.doses)}，也不从家里扣；${homeText}${arithmetic}`
          : `复诊前：住院 ${runsText(e.beforeVisit, ref)}，按规律这几天本来就不吃这种药；${homeText}${arithmetic}`,
      );
    } else {
      lines.push(`复诊前：没有住院；${homeText}${arithmetic}`);
    }
    const arriving = pair(`${eveningOf(addDays(visit.date, -1), ref)}剩`, e.stockBefore);
    lines.push(visit.index > 0 ? `→ ${arriving}；这里已算上前几次复诊按本计划开的药` : `→ ${arriving}`);
  }
  const periodText = `${shortDay(visit.date, ref)}–${shortDay(visit.coverUntil, ref)}`;
  lines.push(
    e.period.days === 0
      ? `开药期间 ${periodText}：没有住院，${pair("需", e.demand)}`
      : e.period.doses > 0
        ? `开药期间 ${periodText}：住院 ${runsText(e.period, ref)}，按规律本应吃 ${pills(e.period.doses)}，由医院配发，不算在需要量里 → ${pair("需", e.demand)}`
        : `开药期间 ${periodText}：住院 ${runsText(e.period, ref)}，这几天本来就不吃这种药 → ${pair("需", e.demand)}`,
  );
  const gap = e.runsOutBefore;
  if (gap.without && !gap.with) lines.push(`不算住院的话，${slotText(gap.without, ref)}起就会断药，等不到这次复诊；住院让现有的药撑到了复诊`);
  else if (gap.with && gap.without && gap.with.date !== gap.without.date) {
    lines.push(`算上住院，仍会在 ${slotText(gap.with, ref)}起断药（不算住院为 ${slotText(gap.without, ref)}起）`);
  }
  lines.push(`结果：${needChange(e, unit)}`);
  return lines;
}

/** Every step of how the stays shape one medication's stock now and how long it lasts. */
export function stockStayLines(e: StockStayEffect, now: Moment): string[] {
  const ref = now.date;
  const lines = pastLines(e, now);
  if (e.ahead.days > 0) {
    lines.push(
      e.ahead.doses > 0
        ? `接下来：住院 ${runsText(e.ahead, ref)}，按规律本应吃 ${pills(e.ahead.doses)}，也不从家里扣`
        : `接下来：住院 ${runsText(e.ahead, ref)}，按规律这几天本来就不吃这种药`,
    );
  }
  const { with: last, without: bare } = e.lastFullDay;
  const total = e.past.doses + e.ahead.doses;
  lines.push(
    last && bare && last !== bare
      ? `结果：能吃到 ${shortDay(last, ref)}（不算住院为 ${shortDay(bare, ref)}）：住院一共省下家里的 ${pills(total)}，能吃到的日子推后 ${diffDays(last, bare)} 天`
      : e.headline.with === e.headline.without
        ? `结果：${e.headline.with}，有没有住院都一样`
        : `结果：${e.headline.with}（不算住院为：${e.headline.without}）`,
  );
  return lines;
}

/* ------------------------------- the stays of a whole list ------------------------------- */

export type StayWhere = "past" | "beforeVisit" | "period" | "after" | "ahead";

export interface StayNote {
  stay: DateRange;
  /** 已出院 / 住院中 / 还没入院 */
  state: string;
  /** Its days cut by where they fall, in order; a day of today can fall on both sides of now. */
  parts: { where: StayWhere; range: DateRange }[];
}

const FAR_PAST = "0001-01-01";
const FAR_FUTURE = "9999-12-31";

/** The last day with a dose behind `now`, and the first with one ahead of it. */
const nowBounds = (now: Moment) => ({
  pastThrough: now.slotsDone > 0 ? now.date : addDays(now.date, -1),
  aheadFrom: now.slotsDone < 3 ? now.date : addDays(now.date, 1),
});

/** The stays, each cut into: behind now, before the visit, in its period, after it. */
export function visitStayNotes(stays: readonly DateRange[], now: Moment, visit: { date: ISODate; coverUntil: ISODate }): StayNote[] {
  const { pastThrough, aheadFrom } = nowBounds(now);
  const cuts: [StayWhere, ISODate, ISODate][] = [
    ["past", FAR_PAST, pastThrough],
    ["beforeVisit", aheadFrom, addDays(visit.date, -1)],
    ["period", aheadFrom > visit.date ? aheadFrom : visit.date, visit.coverUntil],
    ["after", addDays(visit.coverUntil, 1), FAR_FUTURE],
  ];
  return notes(stays, now, cuts);
}

/** The stays, each cut into: behind now, and still ahead. */
export function stockStayNotes(stays: readonly DateRange[], now: Moment): StayNote[] {
  const { pastThrough, aheadFrom } = nowBounds(now);
  return notes(stays, now, [
    ["past", FAR_PAST, pastThrough],
    ["ahead", aheadFrom, FAR_FUTURE],
  ]);
}

function notes(stays: readonly DateRange[], now: Moment, cuts: [StayWhere, ISODate, ISODate][]): StayNote[] {
  return [...stays]
    .sort((a, b) => (a.start < b.start ? -1 : 1))
    .map((stay) => ({
      stay,
      state: stayState(stay, now.date),
      parts: cuts.flatMap(([where, from, through]) => {
        const range = clip(stay, from, through);
        return range ? [{ where, range }] : [];
      }),
    }));
}

/** Whether a stay has a day among the runs. */
export const overlaps = (stay: DateRange, runs: readonly DateRange[]) => runs.some((r) => stay.start <= r.end && stay.end >= r.start);

/** "11.16–11.23（8 天）" */
export const rangeText = (r: DateRange, ref: ISODate) => runsText({ runs: [r], days: diffDays(r.end, r.start) + 1 }, ref);

const WHERE_TEXT: Record<StayWhere, string> = {
  past: "已经过去：这些天吃的是医院配发的药，没有从家里扣，现有余量里已经算上",
  beforeVisit: "在本次复诊之前：这些天也不从家里扣药，所以复诊前一晚剩得更多",
  period: "在本次开药期间：这些天的药由医院配发，不算在需要量里，所以开得更少",
  after: "在本次开药期间之后：不影响本次，到下一次复诊再算",
  ahead: "还没到（或仍在住院）：这些天也不从家里扣药，能吃到的日期相应推后",
};

/** "1. 2026.11.16 周一 – 2026.11.27 周五，共 12 天（住院中）" and a line for each part. */
export function stayNoteLines(note: StayNote, i: number, ref: ISODate): string[] {
  return [
    `${i + 1}. ${stayRangeText(note.stay)}（${note.state}）`,
    ...note.parts.map((p) => `    · ${rangeText(p.range, ref)}${WHERE_TEXT[p.where]}`),
  ];
}

/** The rule every list states once when a stay is in it. */
export const STAY_RULE = "住院期间吃的药由医院配发，不从家里的余量里扣，也不动用储备；入院、出院当天都整天算作住院。";
