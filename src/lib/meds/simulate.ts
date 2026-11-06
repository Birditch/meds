/**
 * Deterministic day-by-day, slot-by-slot simulation of one medication's stock.
 *
 * Shared verbatim by the server (API, SSR) and the browser (live recompute), so it must
 * stay pure: no I/O, no clock — "today" is always passed in.
 *
 * Quantities are 0.5-pill granular. Internally everything is counted in half pills
 * (integers), so sums never drift the way repeated float subtraction would.
 */

import { fromDayNum, toDayNum, type ISODate } from "./dates";

export const SLOTS = ["morning", "noon", "evening"] as const;
export type Slot = (typeof SLOTS)[number];
export const SLOT_LABEL: Record<Slot, string> = { morning: "早", noon: "中", evening: "晚" };

/** Minute of day (Beijing time) after which a slot's dose counts as taken: 08:00 / 12:00 / 18:00. */
export const SLOT_TAKEN_AT: Record<Slot, number> = { morning: 8 * 60, noon: 12 * 60, evening: 18 * 60 };

export interface Dose {
  morning: number;
  noon: number;
  evening: number;
}

export interface SupplyInput {
  date: ISODate;
  quantity: number;
  /** When it was entered; only compared with a count on the same day. */
  recordedAt?: number;
}

/**
 * A stock count: after `slotsDone` (0–3) of that day's doses the stock is `quantity`, whatever
 * the earlier records say. A same-day supply entered after the count (later `recordedAt`) is
 * added on top of it; one entered before it is already in the count.
 */
export interface CountInput {
  date: ISODate;
  slotsDone: 0 | 1 | 2 | 3;
  quantity: number;
  recordedAt?: number;
}

export interface RegimenInput extends Dose {
  effectiveFrom: ISODate;
}

/** A span of days, both ends included. */
export interface DateRange {
  start: ISODate;
  end: ISODate;
}

export type SlotStatus =
  | "none" // nothing scheduled for this slot
  | "full" // the whole dose was taken
  | "partial" // only part of the dose was left; stock hit 0
  | "missed"; // stock was already 0

export interface SlotOutcome {
  slot: Slot;
  required: number;
  taken: number;
  /** Balance right after this slot (and after a stock count taken right then). */
  after: number;
  status: SlotStatus;
}

export interface DaySnapshot {
  date: ISODate;
  day: number;
  /** Sum of supply logs on this day (added before the morning dose, or with a later count). */
  supplied: number;
  /** A stock count on this day: the balance it replaced and what came on top of it. */
  count: DayCount | null;
  /** Balance after today's supply, before the morning dose. */
  startBalance: number;
  /** Regimen in force today, or null before the first regimen. */
  regimen: Dose | null;
  /** A regimen takes effect on this very day. */
  regimenChanged: boolean;
  /** In hospital: nothing is taken from home stock today. */
  paused: boolean;
  slots: [SlotOutcome, SlotOutcome, SlotOutcome];
  taken: number;
  endOfDayBalance: number;
}

export interface DayCount {
  /** How many of the day's slots were behind the count (0 = before the morning dose). */
  slotsDone: 0 | 1 | 2 | 3;
  /** What the records gave at that moment, replaced by the count. */
  before: number;
  /** The counted pills. */
  quantity: number;
  /** Same-day supplies entered after the count, added on top of it. */
  late: number;
}

export interface FullDose {
  date: ISODate;
  slot: Slot;
  remainingAfter: number;
}

export interface PartialDose {
  date: ISODate;
  slot: Slot;
  partialRemaining: number;
  required: number;
}

export type Outcome =
  | { kind: "empty" }
  /** Past the last record the regimen is all zeros (or none was ever set): the stock just sits. */
  | { kind: "stopped"; reason: "zero-dose" | "no-regimen"; balance: number; since: ISODate | null }
  /** Stock reached 0 after the last record. `lastFull`/`partial` describe the final doses. */
  | { kind: "depleted"; lastFull: FullDose | null; partial: PartialDose | null }
  /** Still not empty after the safety horizon. */
  | { kind: "capped"; balance: number; until: ISODate };

export interface Simulation {
  days: DaySnapshot[];
  /** The latest supply / regimen date (null when there are no records). */
  lastRecordDate: ISODate | null;
  outcome: Outcome;
}

export interface SimulateOptions {
  /** Keep simulating at least through this date, so "today" is always on the timeline. */
  today?: ISODate;
  /** Also keep simulating through this date (e.g. the end of the visit plan), out of stock or not. */
  until?: ISODate;
  /** Safety horizon past max(last record, today, until). Default 10 years. */
  maxYears?: number;
  /** Hospital stays: every dose on these days is skipped. */
  pauses?: readonly DateRange[];
  /** Stock counts (at most one per day; a later one in the list wins). */
  counts?: readonly CountInput[];
}

const toHalves = (n: number) => Math.round(n * 2);
const fromHalves = (h: number) => h / 2;

interface HalfRegimen {
  day: number;
  doses: [number, number, number];
}

export function simulate(
  supplies: readonly SupplyInput[],
  regimens: readonly RegimenInput[],
  options: SimulateOptions = {},
): Simulation {
  const counts = options.counts ?? [];
  if (supplies.length === 0 && regimens.length === 0 && counts.length === 0) {
    return { days: [], lastRecordDate: null, outcome: { kind: "empty" } };
  }

  const countOn = new Map<number, { at: number; halves: number; recordedAt: number | undefined }>();
  for (const c of counts) countOn.set(toDayNum(c.date), { at: c.slotsDone, halves: toHalves(c.quantity), recordedAt: c.recordedAt });

  // Supplies count from the start of their day, unless entered after that day's count.
  const suppliedOn = new Map<number, number>();
  const lateOn = new Map<number, number>();
  for (const s of supplies) {
    const day = toDayNum(s.date);
    const c = countOn.get(day);
    const late = c !== undefined && c.recordedAt !== undefined && s.recordedAt !== undefined && s.recordedAt > c.recordedAt;
    const into = late ? lateOn : suppliedOn;
    into.set(day, (into.get(day) ?? 0) + toHalves(s.quantity));
  }

  // One regimen per day; if the caller passes duplicates the later one wins.
  const regimenOn = new Map<number, HalfRegimen>();
  for (const r of regimens) {
    const day = toDayNum(r.effectiveFrom);
    regimenOn.set(day, { day, doses: [toHalves(r.morning), toHalves(r.noon), toHalves(r.evening)] });
  }
  const timeline = [...regimenOn.values()].sort((a, b) => a.day - b.day);

  const recordDays = [...suppliedOn.keys(), ...lateOn.keys(), ...countOn.keys(), ...regimenOn.keys()];
  const start = Math.min(...recordDays);
  const lastRecord = Math.max(...recordDays);
  const horizon = Math.max(
    lastRecord,
    options.today ? toDayNum(options.today) : -Infinity,
    options.until ? toDayNum(options.until) : -Infinity,
  );
  const cap = horizon + Math.round((options.maxYears ?? 10) * 365.25);
  const pauses = (options.pauses ?? []).map((p) => [toDayNum(p.start), toDayNum(p.end)] as const);

  const days: DaySnapshot[] = [];
  let balance = 0;
  let regimenIdx = -1;
  let lastFull: FullDose | null = null;
  let lastPartial: PartialDose | null = null;
  let outcome: Outcome;

  for (let day = start; ; day++) {
    const date = fromDayNum(day);

    // Step A: today's supply is available before the morning dose.
    const early = suppliedOn.get(day) ?? 0;
    const late = lateOn.get(day) ?? 0;
    balance += early;

    // A count replaces the balance once `at` slots are behind; later supplies come on top.
    const counted = countOn.get(day);
    let count: DayCount | null = null;
    const applyCount = (slotsDone: number) => {
      if (!counted || counted.at !== slotsDone) return;
      count = {
        slotsDone: slotsDone as DayCount["slotsDone"],
        before: fromHalves(balance),
        quantity: fromHalves(counted.halves),
        late: fromHalves(late),
      };
      balance = counted.halves + late;
    };
    applyCount(0);
    const startBalance = balance;

    // Step B: latest regimen with effectiveFrom <= today.
    while (regimenIdx + 1 < timeline.length && timeline[regimenIdx + 1].day <= day) regimenIdx++;
    const regimen = regimenIdx >= 0 ? timeline[regimenIdx] : null;
    const paused = pauses.some(([from, to]) => day >= from && day <= to);

    // Step C: morning -> noon -> evening (nothing while in hospital).
    let takenToday = 0;
    const slots: SlotOutcome[] = [];
    for (let i = 0; i < SLOTS.length; i++) {
      const slot = SLOTS[i];
      const dose = regimen && !paused ? regimen.doses[i] : 0;
      let taken = 0;
      let status: SlotStatus;
      if (dose <= 0) {
        // Nothing scheduled: skip the slot.
        status = "none";
      } else if (balance >= dose) {
        taken = dose;
        balance -= dose;
        lastFull = { date, slot, remainingAfter: fromHalves(balance) };
        lastPartial = null;
        status = "full";
      } else if (balance > 0) {
        // Not enough for a whole dose: take what is left, stock hits exactly 0.
        taken = balance;
        balance = 0;
        lastPartial = { date, slot, partialRemaining: fromHalves(taken), required: fromHalves(dose) };
        status = "partial";
      } else {
        // Out of stock: nothing to take, and the balance never goes negative.
        status = "missed";
      }
      takenToday += taken;
      applyCount(i + 1);
      slots.push({ slot, required: status === "none" ? 0 : fromHalves(dose), taken: fromHalves(taken), after: fromHalves(balance), status });
    }

    // Step D: daily snapshot.
    days.push({
      date,
      day,
      supplied: fromHalves(early + late),
      count,
      startBalance: fromHalves(startBalance),
      regimen: regimen
        ? { morning: fromHalves(regimen.doses[0]), noon: fromHalves(regimen.doses[1]), evening: fromHalves(regimen.doses[2]) }
        : null,
      regimenChanged: regimen?.day === day,
      paused,
      slots: slots as DaySnapshot["slots"],
      taken: fromHalves(takenToday),
      endOfDayBalance: fromHalves(balance),
    });

    // Termination: only once every record (and today) is behind us.
    if (day >= horizon) {
      const daily = regimen ? regimen.doses[0] + regimen.doses[1] + regimen.doses[2] : 0;
      if (daily === 0) {
        outcome = regimen
          ? { kind: "stopped", reason: "zero-dose", balance: fromHalves(balance), since: fromDayNum(regimen.day) }
          : { kind: "stopped", reason: "no-regimen", balance: fromHalves(balance), since: null };
        break;
      }
      if (balance === 0) {
        outcome = { kind: "depleted", lastFull, partial: lastPartial };
        break;
      }
      if (day >= cap) {
        outcome = { kind: "capped", balance: fromHalves(balance), until: date };
        break;
      }
    }
  }

  return { days, lastRecordDate: fromDayNum(lastRecord), outcome };
}

/* ------------------------------------------------------------------------------------------
 * Reading the simulation at "now".
 * A moment is (date, slotsDone): slotsDone = how many of today's slots (0..3) are past.
 * ---------------------------------------------------------------------------------------- */

export interface Moment {
  date: ISODate;
  slotsDone: 0 | 1 | 2 | 3;
}

export function momentAt(date: ISODate, minuteOfDay: number): Moment {
  const slotsDone = SLOTS.filter((s) => minuteOfDay >= SLOT_TAKEN_AT[s]).length as Moment["slotsDone"];
  return { date, slotsDone };
}

/** Absolute slot index: day * 3 + slot index. */
const slotPos = (day: number, slotIndex: number) => day * 3 + slotIndex;
/** Position of the last slot already behind `m`. */
const lastDonePos = (m: Moment) => slotPos(toDayNum(m.date), m.slotsDone - 1);

/** Balance at moment `m` (today's supply counts from the start of the day). */
export function balanceAt(sim: Simulation, m: Moment): number {
  if (sim.days.length === 0) return 0;
  const day = toDayNum(m.date);
  const first = sim.days[0];
  if (day < first.day) return 0;
  const last = sim.days[sim.days.length - 1];
  if (day > last.day) return last.endOfDayBalance;
  const snap = sim.days[day - first.day];
  return m.slotsDone === 0 ? snap.startBalance : snap.slots[m.slotsDone - 1].after;
}

export function regimenAt<T extends RegimenInput>(regimens: readonly T[], date: ISODate): T | null {
  let best: T | null = null;
  for (const r of regimens) {
    if (r.effectiveFrom <= date && (!best || r.effectiveFrom > best.effectiveFrom)) best = r;
  }
  return best;
}

export const dailyTotal = (d: Dose) => d.morning + d.noon + d.evening;

export interface SlotRef {
  date: ISODate;
  slot: Slot;
}

/** The last slot that got any pills in a depleted outcome (the partial one if there was one). */
export function finalDose(outcome: Outcome): SlotRef | null {
  if (outcome.kind !== "depleted") return null;
  return outcome.partial ?? outcome.lastFull;
}

export interface Shortfall extends SlotRef {
  status: "partial" | "missed";
  /** Next supply date after the shortfall that ends it, if any. */
  resumesOn: ISODate | null;
}

/**
 * First slot after `m` that does not get its full dose *before* the final run-out,
 * i.e. a gap in the middle of the timeline (e.g. a refill planned too late).
 */
export function nextShortfall(sim: Simulation, m: Moment): Shortfall | null {
  if (sim.days.length === 0) return null;
  const from = lastDonePos(m);
  const final = finalDose(sim.outcome);
  const finalPos = final ? slotPos(toDayNum(final.date), SLOTS.indexOf(final.slot)) : Infinity;
  const first = sim.days[0].day;
  const startIdx = Math.max(0, Math.floor((from + 1) / 3) - first);

  for (let i = startIdx; i < sim.days.length; i++) {
    const snap = sim.days[i];
    for (let s = 0; s < 3; s++) {
      const pos = slotPos(snap.day, s);
      if (pos <= from) continue;
      if (pos >= finalPos) return null;
      const out = snap.slots[s];
      if (out.status === "partial" || out.status === "missed") {
        const resume = sim.days.slice(i + 1).find((d) => d.supplied > 0);
        return { date: snap.date, slot: out.slot, status: out.status, resumesOn: resume?.date ?? null };
      }
    }
  }
  return null;
}

/** Number of dosing slots after `m` that still get pills (full or partial). */
export function dosesLeft(sim: Simulation, m: Moment): number {
  const from = lastDonePos(m);
  let count = 0;
  for (const snap of sim.days) {
    for (let s = 0; s < 3; s++) {
      if (slotPos(snap.day, s) > from && snap.slots[s].taken > 0) count++;
    }
  }
  return count;
}

/** True when the final dose of a depleted timeline is already behind `m`. */
export function isExhaustedAt(sim: Simulation, m: Moment): boolean {
  const final = finalDose(sim.outcome);
  if (sim.outcome.kind !== "depleted") return false;
  if (!final) return true; // never had stock to take
  return slotPos(toDayNum(final.date), SLOTS.indexOf(final.slot)) <= lastDonePos(m);
}

export interface FullDays {
  /** Last day whose scheduled doses were all taken in full; null when not even the first day is. */
  lastFullDay: ISODate | null;
  /** The day after it, which only gets part of its doses; null when the stock ends on a day boundary. */
  shortDay: DaySnapshot | null;
}

/**
 * Whole days a depleted timeline lasts: a day that gets only some of its doses does not
 * count (pills for 早 but not 晚 on day x → the stock lasts through x − 1).
 */
export function fullDays(sim: Simulation): FullDays | null {
  const final = finalDose(sim.outcome);
  if (!final || sim.days.length === 0) return null;
  const idx = toDayNum(final.date) - sim.days[0].day;
  const snap = sim.days[idx];
  if (snap.slots.every((s) => s.status === "none" || s.status === "full")) {
    return { lastFullDay: final.date, shortDay: null };
  }
  return { lastFullDay: idx > 0 ? sim.days[idx - 1].date : null, shortDay: snap };
}

/**
 * The fewest pills a new supply on `supply.date` needs so that every dose from then through
 * the evening of `until` is taken in full, given what is already recorded: 0 when the stock
 * already lasts, null when no amount can do it (a later stock count resets it in between).
 * Found by searching with the simulation itself, so hospital stays and counts all count.
 */
export function supplyToLast(
  supplies: readonly SupplyInput[],
  regimens: readonly RegimenInput[],
  supply: { date: ISODate; recordedAt?: number },
  until: ISODate,
  options: Pick<SimulateOptions, "pauses" | "counts"> = {},
): number | null {
  const from = toDayNum(supply.date);
  const last = toDayNum(until);
  if (last < from) return 0;
  // A supply entered after that day's count only comes in at the count.
  const sameDay = options.counts?.find((c) => c.date === supply.date);
  const late =
    sameDay !== undefined && sameDay.recordedAt !== undefined && supply.recordedAt !== undefined && supply.recordedAt > sameDay.recordedAt;
  const firstSlot = late ? sameDay.slotsDone : 0;

  const run = (halves: number) =>
    simulate([...supplies, { date: supply.date, quantity: halves / 2, recordedAt: supply.recordedAt }], regimens, {
      ...options,
      until,
      maxYears: 0,
    });
  const slotsIn = (sim: Simulation) =>
    sim.days
      .filter((d) => d.day >= from && d.day <= last)
      .flatMap((d) => (d.day === from ? d.slots.slice(firstSlot) : d.slots));
  const covered = (halves: number) => slotsIn(run(halves)).every((s) => s.status === "none" || s.status === "full");

  if (covered(0)) return 0;
  // Enough for every dose in the span even from an empty stock; if that fails, nothing will.
  let hi = slotsIn(run(0)).reduce((sum, s) => sum + toHalves(s.required), 0);
  if (!covered(hi)) return null;
  let lo = 0; // not covered
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (covered(mid)) hi = mid;
    else lo = mid;
  }
  return fromHalves(hi);
}
