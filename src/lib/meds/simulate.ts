/**
 * Deterministic day-by-day, slot-by-slot simulation of one medication's stock.
 *
 * Shared verbatim by the server (API, SSR) and the browser (live recompute), so it must
 * stay pure: no I/O, no clock — "today" is always passed in.
 *
 * Quantities are 0.5-pill granular. Internally everything is counted in half pills
 * (integers), so sums never drift the way repeated float subtraction would.
 *
 * A medication can come in several packs (manufacturers). Each keeps its own balance: a supply
 * goes to its pack, a count can be of one pack, and doses are taken from the packs in order
 * (the default first, the next once it is empty). Without `packs` it is all one balance.
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
  /** The pack it came in (one of `SimulateOptions.packs`); none / unknown = the first. */
  packId?: number | null;
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
  /** Counts this pack only (the others keep theirs); none = all packs together. */
  packId?: number | null;
}

/** (Part of) a dose not taken whose pills stayed in the stock (漏服): that slot takes `quantity` less. */
export interface SkipInput {
  date: ISODate;
  slot: Slot;
  quantity: number;
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
  | "none" // nothing to take for this slot: none scheduled, or the whole dose skipped
  | "full" // the whole dose was taken
  | "partial" // only part of the dose was left; stock hit 0
  | "missed"; // stock was already 0

export interface SlotOutcome {
  slot: Slot;
  /** What was to be taken from the stock: the scheduled dose less any skipped part. */
  required: number;
  taken: number;
  /** Pills of the scheduled dose not taken that stayed in the stock (漏服), when any. */
  skipped?: number;
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
  /** Each pack's balance (in `Simulation.packs` order), when there are several. */
  byPack?: PackBalances;
}

export interface PackBalances {
  /** At `startBalance`. */
  start: number[];
  /** Right after each slot, like `SlotOutcome.after`. */
  after: [number[], number[], number[]];
}

export interface DayCount {
  /** How many of the day's slots were behind the count (0 = before the morning dose). */
  slotsDone: 0 | 1 | 2 | 3;
  /** What the records gave at that moment (all packs), replaced by the count. */
  before: number;
  /** The pills there were after the count (all packs; a count of one pack keeps the others'). */
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
  /** The pack ids balanced separately (`SimulateOptions.packs`); [] when not given. */
  packs: readonly number[];
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
  /** Stock counts (at most one per day and pack; a later one in the list wins). */
  counts?: readonly CountInput[];
  /** Doses not taken whose pills stayed in the stock. */
  skips?: readonly SkipInput[];
  /**
   * The medication's pack ids, in the order their pills are taken (the default first). Each
   * keeps its own balance; supplies and counts name theirs. Pass them whenever a count or
   * supply may name a pack.
   */
  packs?: readonly number[];
}

const toHalves = (n: number) => Math.round(n * 2);
const fromHalves = (h: number) => h / 2;

interface HalfRegimen {
  day: number;
  doses: [number, number, number];
}

interface HalfCount {
  at: number;
  halves: number;
  recordedAt: number | undefined;
  /** The pack's index, or null for all packs. */
  pack: number | null;
  /** Same-day supplies entered after it, per pack. */
  late: number[];
}

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/** Takes `n` from the balances in order (the first pack first); returns what was taken. */
function takeInOrder(bal: number[], n: number): number {
  let left = n;
  for (let i = 0; i < bal.length && left > 0; i++) {
    const t = Math.min(bal[i], left);
    bal[i] -= t;
    left -= t;
  }
  return n - left;
}

/**
 * Sets the packs' total to `total`, as a count of all packs together says: extra pills go to the
 * first pack, missing ones come off in the order pills are taken (the first pack first).
 */
export function settleTotal(amounts: readonly number[], total: number): number[] {
  const out = amounts.map(toHalves);
  settleHalves(out, toHalves(total));
  return out.map(fromHalves);
}

function settleHalves(bal: number[], total: number) {
  if (bal.length === 0) return;
  const diff = total - sum(bal);
  if (diff >= 0) bal[0] += diff;
  else takeInOrder(bal, -diff);
}

export function simulate(
  supplies: readonly SupplyInput[],
  regimens: readonly RegimenInput[],
  options: SimulateOptions = {},
): Simulation {
  const counts = options.counts ?? [];
  const packs = options.packs ?? [];
  if (supplies.length === 0 && regimens.length === 0 && counts.length === 0) {
    return { packs, days: [], lastRecordDate: null, outcome: { kind: "empty" } };
  }
  const width = Math.max(1, packs.length);
  const tracked = packs.length > 1;
  const packIndex = (id: number | null | undefined) => {
    const i = id == null ? -1 : packs.indexOf(id);
    return i < 0 ? 0 : i;
  };
  const zeros = () => new Array<number>(width).fill(0);

  // One count per day and pack (or all packs); applied by slot, then in the order entered.
  const byKey = new Map<string, HalfCount & { day: number }>();
  for (const c of counts) {
    const day = toDayNum(c.date);
    const pack = c.packId == null || !tracked ? null : packIndex(c.packId);
    byKey.set(`${day}|${pack}`, { day, at: c.slotsDone, halves: toHalves(c.quantity), recordedAt: c.recordedAt, pack, late: zeros() });
  }
  const countsOn = new Map<number, HalfCount[]>();
  for (const c of byKey.values()) countsOn.set(c.day, [...(countsOn.get(c.day) ?? []), c]);
  for (const list of countsOn.values()) list.sort((a, b) => a.at - b.at || (a.recordedAt ?? 0) - (b.recordedAt ?? 0));

  // Supplies count from the start of their day, unless entered after a count of that day that
  // covers their pack: then they come on top of the latest such count.
  const suppliedOn = new Map<number, number[]>();
  for (const s of supplies) {
    const day = toDayNum(s.date);
    const pack = packIndex(s.packId);
    const halves = toHalves(s.quantity);
    const after = (countsOn.get(day) ?? [])
      .filter((c) => (c.pack === null || c.pack === pack) && c.recordedAt !== undefined && s.recordedAt !== undefined && s.recordedAt > c.recordedAt)
      .reduce<HalfCount | null>((a, c) => (!a || c.recordedAt! > a.recordedAt! ? c : a), null);
    if (after) {
      after.late[pack] += halves;
    } else {
      const list = suppliedOn.get(day) ?? zeros();
      list[pack] += halves;
      suppliedOn.set(day, list);
    }
  }

  // One regimen per day; if the caller passes duplicates the later one wins.
  const regimenOn = new Map<number, HalfRegimen>();
  for (const r of regimens) {
    const day = toDayNum(r.effectiveFrom);
    regimenOn.set(day, { day, doses: [toHalves(r.morning), toHalves(r.noon), toHalves(r.evening)] });
  }
  const timeline = [...regimenOn.values()].sort((a, b) => a.day - b.day);

  const recordDays = [...suppliedOn.keys(), ...countsOn.keys(), ...regimenOn.keys()];
  const start = Math.min(...recordDays);
  const lastRecord = Math.max(...recordDays);
  const horizon = Math.max(
    lastRecord,
    options.today ? toDayNum(options.today) : -Infinity,
    options.until ? toDayNum(options.until) : -Infinity,
  );
  const cap = horizon + Math.round((options.maxYears ?? 10) * 365.25);
  const pauses = (options.pauses ?? []).map((p) => [toDayNum(p.start), toDayNum(p.end)] as const);
  const skippedOn = new Map<number, [number, number, number]>();
  for (const k of options.skips ?? []) {
    const day = toDayNum(k.date);
    const list = skippedOn.get(day) ?? [0, 0, 0];
    list[SLOTS.indexOf(k.slot)] += toHalves(k.quantity);
    skippedOn.set(day, list);
  }

  const days: DaySnapshot[] = [];
  const bal = zeros();
  let regimenIdx = -1;
  let lastFull: FullDose | null = null;
  let lastPartial: PartialDose | null = null;
  let outcome: Outcome;

  for (let day = start; ; day++) {
    const date = fromDayNum(day);

    // Step A: today's supply is available before the morning dose.
    const early = suppliedOn.get(day);
    if (early) for (let i = 0; i < width; i++) bal[i] += early[i];
    let suppliedToday = early ? sum(early) : 0;

    // A count replaces the balance once `at` slots are behind; later supplies come on top.
    const dayCounts = countsOn.get(day);
    let count: { slotsDone: number; before: number; after: number; late: number } | null = null;
    const applyCounts = (slotsDone: number) => {
      if (!dayCounts) return;
      for (const c of dayCounts) {
        if (c.at !== slotsDone) continue;
        const before = sum(bal);
        if (c.pack === null) settleHalves(bal, c.halves);
        else bal[c.pack] = c.halves;
        const late = sum(c.late);
        for (let i = 0; i < width; i++) bal[i] += c.late[i];
        suppliedToday += late;
        // Several counts in a day read as one: from the first one's before to the last one's after.
        count = { slotsDone, before: count?.before ?? before, after: sum(bal), late: (count?.late ?? 0) + late };
      }
    };
    const dayCount = (): DayCount | null =>
      count && {
        slotsDone: count.slotsDone as DayCount["slotsDone"],
        before: fromHalves(count.before),
        quantity: fromHalves(count.after - count.late),
        late: fromHalves(count.late),
      };
    applyCounts(0);
    const startBalance = sum(bal);
    const byPack: PackBalances | undefined = tracked ? { start: bal.map(fromHalves), after: [[], [], []] } : undefined;

    // Step B: latest regimen with effectiveFrom <= today.
    while (regimenIdx + 1 < timeline.length && timeline[regimenIdx + 1].day <= day) regimenIdx++;
    const regimen = regimenIdx >= 0 ? timeline[regimenIdx] : null;
    const paused = pauses.some(([from, to]) => day >= from && day <= to);

    // Step C: morning -> noon -> evening (nothing while in hospital, less what was skipped).
    let takenToday = 0;
    const slots: SlotOutcome[] = [];
    const skipped = skippedOn.get(day);
    for (let i = 0; i < SLOTS.length; i++) {
      const slot = SLOTS[i];
      const scheduled = regimen && !paused ? regimen.doses[i] : 0;
      const skip = Math.min(scheduled, skipped?.[i] ?? 0);
      const dose = scheduled - skip;
      let taken = 0;
      let status: SlotStatus;
      if (dose <= 0) {
        // Nothing scheduled: skip the slot.
        status = "none";
      } else if (sum(bal) >= dose) {
        // The first pack first, then the next.
        taken = takeInOrder(bal, dose);
        lastFull = { date, slot, remainingAfter: fromHalves(sum(bal)) };
        lastPartial = null;
        status = "full";
      } else if (sum(bal) > 0) {
        // Not enough for a whole dose: take what is left, stock hits exactly 0.
        taken = takeInOrder(bal, dose);
        lastPartial = { date, slot, partialRemaining: fromHalves(taken), required: fromHalves(dose) };
        status = "partial";
      } else {
        // Out of stock: nothing to take, and the balance never goes negative.
        status = "missed";
      }
      takenToday += taken;
      applyCounts(i + 1);
      if (byPack) byPack.after[i] = bal.map(fromHalves);
      slots.push({
        slot,
        required: status === "none" ? 0 : fromHalves(dose),
        taken: fromHalves(taken),
        after: fromHalves(sum(bal)),
        status,
        ...(skip > 0 ? { skipped: fromHalves(skip) } : {}),
      });
    }

    // Step D: daily snapshot.
    days.push({
      date,
      day,
      supplied: fromHalves(suppliedToday),
      count: dayCount(),
      startBalance: fromHalves(startBalance),
      regimen: regimen
        ? { morning: fromHalves(regimen.doses[0]), noon: fromHalves(regimen.doses[1]), evening: fromHalves(regimen.doses[2]) }
        : null,
      regimenChanged: regimen?.day === day,
      paused,
      slots: slots as DaySnapshot["slots"],
      taken: fromHalves(takenToday),
      endOfDayBalance: fromHalves(sum(bal)),
      ...(byPack ? { byPack } : {}),
    });

    // Termination: only once every record (and today) is behind us.
    if (day >= horizon) {
      const balance = sum(bal);
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

  return { packs, days, lastRecordDate: fromDayNum(lastRecord), outcome };
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

/**
 * Each pack's balance at moment `m`, in `sim.packs` order ([] when the simulation was not given
 * packs; one pack's is the whole balance).
 */
export function packBalancesAt(sim: Simulation, m: Moment): number[] {
  if (sim.packs.length <= 1) return sim.packs.map(() => balanceAt(sim, m));
  if (sim.days.length === 0) return sim.packs.map(() => 0);
  const day = toDayNum(m.date);
  const first = sim.days[0];
  if (day < first.day) return sim.packs.map(() => 0);
  const last = sim.days[sim.days.length - 1];
  if (day > last.day) return last.byPack?.after[2] ?? sim.packs.map(() => 0);
  const snap = sim.days[day - first.day];
  if (!snap.byPack) return sim.packs.map(() => 0);
  return m.slotsDone === 0 ? snap.byPack.start : snap.byPack.after[m.slotsDone - 1];
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
  options: Pick<SimulateOptions, "pauses" | "counts" | "packs" | "skips"> = {},
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
