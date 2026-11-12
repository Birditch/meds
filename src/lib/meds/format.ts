import { diffDays, fmtDate, type ISODate } from "./dates";
import {
  SLOT_LABEL,
  balanceAt,
  dailyTotal,
  finalDose,
  fullDays,
  isExhaustedAt,
  nextShortfall,
  packBalancesAt,
  regimenAt,
  simulate,
  type CountInput,
  type DateRange,
  type DaySnapshot,
  type Dose,
  type Moment,
  type Outcome,
  type RegimenInput,
  type Shortfall,
  type Simulation,
  type SkipInput,
  type Slot,
  type SupplyInput,
} from "./simulate";
import type { MedicationRecord, MissedDoseKept, PackRecord, ReserveTakeTime, ReserveUseReason } from "./types";
import { planHorizon, planVisits, type VisitPlan, type VisitSchedule } from "./visits";

/** When a stock count was taken, by how many of the day's doses were behind it. */
export const COUNT_MOMENT_LABEL = ["早上服药前", "早上服药后", "中午服药后", "晚上服药后"] as const;

/** 服用: when in the day pills were taken from the reserve. */
export const RESERVE_TAKE_TIME_LABEL: Record<ReserveTakeTime, string> = { morning: "早上", noon: "中午", evening: "晚上", bedtime: "睡前" };

/** The time of day a minute of the (Beijing) day most likely means: 早上 until 11:00, 中午 until 16:00, 晚上 until 21:00, then 睡前. */
export const takeTimeAt = (minutes: number): ReserveTakeTime =>
  minutes < 11 * 60 ? "morning" : minutes < 16 * 60 ? "noon" : minutes < 21 * 60 ? "evening" : "bedtime";

/** 消耗储备: why the pills left the reserve without being taken, in the order offered, with what each one covers. */
export const RESERVE_USE_REASON: Record<ReserveUseReason, { label: string; hint: string }> = {
  carry: { label: "带走备用", hint: "随身带走或放到别处：出差旅行、住院自带、放在单位或另一个家" },
  expired: { label: "过期处理", hint: "过期或快过期了，丢弃或交到药品回收点" },
  damaged: { label: "损坏丢弃", hint: "受潮、变色、碎裂、掉在地上或被污染，不能再吃" },
  lost: { label: "遗失", hint: "丢了或找不到了" },
  given: { label: "给了别人", hint: "给家人、朋友或其他病友用了" },
  returned: { label: "退药", hint: "退回医院或药店" },
  other: { label: "其他", hint: "以上都不是：请在备注里写明" },
};

/** 早上 / 中午 / 晚上 */
export const SLOT_NAME: Record<Slot, string> = { morning: "早上", noon: "中午", evening: "晚上" };

/** 漏服: where the pills not taken went, in the order offered, with what it does. */
export const MISSED_DOSE_KEPT_LABEL: Record<MissedDoseKept, { label: string; hint: string }> = {
  stock: { label: "留在当前余量", hint: "药还在，这一顿不扣当前余量，能吃到的日期往后顺延" },
  reserve: { label: "放进储备", hint: "当前余量照常扣掉这一顿，这些药加进储备" },
  none: { label: "不补回", hint: "药已经丢了或扔了：当前余量照常扣，只记一笔漏服" },
};

/** The doses not taken whose pills stayed in the stock, for the simulation. */
export const skipsOf = (m: Pick<MedicationRecord, "misses">) => m.misses.filter((x) => x.kept === "stock");

/** 100 → "100", 1.5 → "1.5" */
export const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** "早 1 · 中 0 · 晚 1（2颗/天）" */
export function formatRegimen(d: Dose | null): string {
  if (!d) return "未设置";
  return `早 ${fmtQty(d.morning)} · 中 ${fmtQty(d.noon)} · 晚 ${fmtQty(d.evening)}（${fmtQty(dailyTotal(d))}颗/天）`;
}

/**
 * Whether a medication is being taken on `date`, which splits the board into 在吃 / 未在吃.
 * A regimen with doses that starts later counts as taken (its stock still needs planning);
 * a regimen of all zeros is a stop.
 */
export type Intake =
  | { kind: "taking" }
  | { kind: "starting"; from: ISODate }
  | { kind: "stopped"; since: ISODate }
  | { kind: "unset" };

export function intakeAt(regimens: readonly RegimenInput[], date: ISODate): Intake {
  const current = regimenAt(regimens, date);
  if (current && dailyTotal(current) > 0) return { kind: "taking" };
  const start = regimens
    .filter((r) => r.effectiveFrom > date && dailyTotal(r) > 0)
    .reduce<RegimenInput | null>((a, r) => (!a || r.effectiveFrom < a.effectiveFrom ? r : a), null);
  if (start) return { kind: "starting", from: start.effectiveFrom };
  return current ? { kind: "stopped", since: current.effectiveFrom } : { kind: "unset" };
}

export const isTaking = (i: Intake) => i.kind === "taking" || i.kind === "starting";

/**
 * Whether saving `next` puts a medication that is not being taken on the 在吃 list. It replaces
 * the regimen being edited and any other on its day.
 */
export function startsTaking<R extends RegimenInput & { id: number }>(regimens: readonly R[], next: RegimenInput, date: ISODate, editingId?: number): boolean {
  if (isTaking(intakeAt(regimens, date))) return false;
  const after = [...regimens.filter((r) => r.id !== editingId && r.effectiveFrom !== next.effectiveFrom), next];
  return isTaking(intakeAt(after, date));
}

/** "2026.11.20 周五 起服用", "已停药", "未设服用规律"; null while taken. */
export function intakeLabel(i: Intake): string | null {
  switch (i.kind) {
    case "taking":
      return null;
    case "starting":
      return `${fmtDate(i.from)} 起服用`;
    case "stopped":
      return "已停药";
    case "unset":
      return "未设服用规律";
  }
}

/** "早1/中1/晚2" */
export const formatRegimenShort = (d: Dose) =>
  `早${fmtQty(d.morning)}/中${fmtQty(d.noon)}/晚${fmtQty(d.evening)}`;

export type Tone = "ok" | "warn" | "danger" | "muted";

export interface Conclusion {
  /** Short badge text, e.g. "2027.02.14" or "已停药". */
  badge: string;
  tone: Tone;
  /** The full sentence, e.g. "能吃到：2027.02.14". */
  headline: string;
  /** Days left, or how long ago it ran out. */
  detail: string | null;
  /** Pills left over for the first day that cannot be taken in full, e.g. "额外多 2 颗：够 2027.02.15 早、中". */
  extraNote?: string;
}

/** What the leftover pills cover on a day that cannot be taken in full. */
function extraNote(day: DaySnapshot): string {
  const full = day.slots.filter((s) => s.status === "full").map((s) => SLOT_LABEL[s.slot]);
  const partial = day.slots.find((s) => s.status === "partial");
  const parts: string[] = [];
  if (full.length) parts.push(`够 ${fmtDate(day.date)} ${full.join("、")}`);
  if (partial) {
    const where = full.length ? "" : `${fmtDate(day.date)} `;
    parts.push(`${where}${SLOT_LABEL[partial.slot]}只够 ${fmtQty(partial.taken)}/${fmtQty(partial.required)} 颗`);
  }
  return `额外多 ${fmtQty(day.taken)} 颗：${parts.join("，")}`;
}

/**
 * The verdict for one medication at moment `now`. "能吃到" is the last day whose doses are
 * all covered; pills that only cover part of the next day are reported as extra.
 * Amber within 7 days of that day, red within 2 days or once it has run out.
 */
export function conclude(sim: Simulation, now: Moment): Conclusion {
  const o: Outcome = sim.outcome;
  switch (o.kind) {
    case "empty":
      return { badge: "暂无记录", tone: "muted", headline: "暂无补药或服用规律记录", detail: null };
    case "stopped": {
      const left = fmtQty(balanceAt(sim, now));
      if (o.reason === "no-regimen") {
        return { badge: "未设规律", tone: "muted", headline: `未设置服用规律（当前剩余 ${left} 颗）`, detail: null };
      }
      if (o.since && o.since > now.date) {
        return {
          badge: `${fmtDate(o.since)} 起停药`,
          tone: "muted",
          headline: `${fmtDate(o.since)} 起停药（届时剩余 ${fmtQty(o.balance)} 颗）`,
          detail: null,
        };
      }
      return { badge: "已停药", tone: "muted", headline: `已停药（当前剩余 ${left} 颗）`, detail: null };
    }
    case "capped":
      return {
        badge: "10 年以上",
        tone: "ok",
        headline: `按当前规律 10 年内吃不完（至 ${fmtDate(o.until)} 仍余 ${fmtQty(o.balance)} 颗）`,
        detail: null,
      };
    case "depleted": {
      const last = finalDose(o);
      const span = fullDays(sim);
      if (!last || !span) {
        return { badge: "无药", tone: "danger", headline: "没有可用药量", detail: "请先添加补药记录" };
      }
      const note = span.shortDay ? { extraNote: extraNote(span.shortDay) } : {};

      if (isExhaustedAt(sim, now)) {
        const ago = diffDays(now.date, last.date);
        return {
          badge: "已吃完",
          tone: "danger",
          headline: span.lastFullDay ? `已吃完（最后吃满的一天：${fmtDate(span.lastFullDay)}）` : "已吃完",
          detail: ago === 0 ? "今天已吃完" : `已于 ${ago} 天前吃完`,
        };
      }
      if (!span.lastFullDay || span.lastFullDay < now.date) {
        const short = span.shortDay?.date ?? now.date;
        return {
          badge: "不足一天",
          tone: "danger",
          headline: short === now.date ? "今天的药已不够吃全" : `${fmtDate(short)} 起就不够吃全`,
          detail: "请尽快补药",
          ...note,
        };
      }

      const days = diffDays(span.lastFullDay, now.date);
      return {
        badge: fmtDate(span.lastFullDay),
        tone: days <= 2 ? "danger" : days <= 7 ? "warn" : "ok",
        headline: `能吃到：${fmtDate(span.lastFullDay)}`,
        detail: days === 0 ? "今天是最后吃满的一天" : `距今 ${days} 天`,
        ...note,
      };
    }
  }
}

export function describeShortfall(s: Shortfall): string {
  const when = `${fmtDate(s.date)} ${SLOT_LABEL[s.slot]}`;
  const tail = s.resumesOn ? `，${fmtDate(s.resumesOn)} 补药后恢复` : "";
  return `${when}起药量不足${tail}`;
}

export interface ReserveEstimate {
  /** Whole days the reserve lasts at the regimen in force today; null when nothing is taken daily. */
  days: number | null;
  /** Pills left after those days: not enough for one more full day. */
  remainder: number;
}

/** The reserve is kept apart from the stock: only how long it would last on today's regimen. */
export function reserveEstimate(reserve: number, regimen: Dose | null): ReserveEstimate {
  const daily = regimen ? Math.round(dailyTotal(regimen) * 2) : 0;
  if (daily === 0) return { days: null, remainder: reserve };
  const halves = Math.round(reserve * 2);
  const days = Math.floor(halves / daily);
  return { days, remainder: (halves - days * daily) / 2 };
}

/** "可用 12 天，另余 1 颗" */
export function describeReserve(reserve: number, regimen: Dose | null): string {
  if (reserve <= 0) return "暂无储备";
  if (!regimen) return "未设服用规律，无法估算";
  const { days, remainder } = reserveEstimate(reserve, regimen);
  if (days === null) return "当前停药，不消耗";
  const tail = remainder > 0 ? `，另余 ${fmtQty(remainder)} 颗` : "";
  return days === 0 ? `不够吃满一天${tail}` : `可用 ${days} 天${tail}`;
}

/** Everything the list card and the detail header need, computed once. */
export interface MedicationStatus<R extends RegimenInput = RegimenInput> {
  sim: Simulation;
  current: R | null;
  balanceNow: number;
  /** Each pack's share of `balanceNow`, in the `packs` order given ([] without). */
  byPack: number[];
  conclusion: Conclusion;
  shortfall: Shortfall | null;
  plan: VisitPlan;
}

/** False with no supply, regimen or count recorded (e.g. kept only in the reserve): nothing to say about 能吃到. */
export const hasRecords = (s: Pick<MedicationStatus, "sim">) => s.sim.outcome.kind !== "empty";

export interface StatusOptions {
  /** Hospital stays: nothing is taken from home stock. */
  pauses?: readonly DateRange[];
  /** Pills per box, so visits get whole boxes. */
  perBox?: number | null;
  /** Stock counts: the stock is what was counted, from that moment on. */
  counts?: readonly CountInput[];
  /** Pack ids, default first: each keeps its own balance (see simulate). */
  packs?: readonly number[];
  /** Doses not taken whose pills stayed in the stock. */
  skips?: readonly SkipInput[];
}

export function medicationStatus<R extends RegimenInput>(
  supplies: readonly SupplyInput[],
  regimens: readonly R[],
  now: Moment,
  schedule: readonly VisitSchedule[] = [],
  { pauses = [], perBox = null, counts = [], packs = [], skips = [] }: StatusOptions = {},
): MedicationStatus<R> {
  const sim = simulate(supplies, regimens, { today: now.date, until: planHorizon(schedule), pauses, counts, packs, skips });
  return {
    sim,
    current: regimenAt(regimens, now.date),
    balanceNow: balanceAt(sim, now),
    byPack: packBalancesAt(sim, now),
    conclusion: conclude(sim, now),
    shortfall: nextShortfall(sim, now),
    plan: planVisits(sim, schedule, now, perBox),
  };
}

/** medicationStatus of a stored medication: its supplies, counts and packs. */
export function statusOf(
  m: Pick<MedicationRecord, "supplies" | "regimens" | "counts" | "packs" | "perBox" | "misses">,
  now: Moment,
  schedule: readonly VisitSchedule[],
  pauses: readonly DateRange[],
): MedicationStatus<MedicationRecord["regimens"][number]> {
  return medicationStatus(m.supplies, m.regimens, now, schedule, {
    pauses,
    perBox: m.perBox,
    counts: m.counts,
    packs: m.packs.map((p) => p.id),
    skips: skipsOf(m),
  });
}

/** Each pack with its stock now and its reserve, default first. */
export function packShares(m: Pick<MedicationRecord, "packs">, status: Pick<MedicationStatus, "byPack" | "balanceNow">) {
  return m.packs.map((pack, i) => ({
    pack,
    stock: m.packs.length === 1 ? status.balanceNow : (status.byPack[i] ?? 0),
    reserve: pack.reserve,
  }));
}
export type PackShare = { pack: PackRecord; stock: number; reserve: number };

/** 84 → "3 盒", 94 → "3 盒 10 颗", 10 → "10 颗" (28 a box); plain pills when the pack size is unknown. */
export function fmtPacks(pills: number, perBox: number | null | undefined, unit: string = "盒"): string {
  if (!perBox) return `${fmtQty(pills)} 颗`;
  const packs = Math.floor((pills + 1e-9) / perBox);
  const rest = Math.round((pills - packs * perBox) * 2) / 2;
  if (packs === 0) return `${fmtQty(rest)} 颗`;
  return rest > 0 ? `${packs} ${unit} ${fmtQty(rest)} 颗` : `${packs} ${unit}`;
}

/** The line under a pill count: "合 3 瓶 10 颗", "不足 1 瓶", or null when the pack size is unknown. */
export function packNote(pills: number, m: { perBox: number | null; packUnit: string }): string | null {
  if (!m.perBox || pills <= 0) return null;
  return pills < m.perBox ? `不足 1 ${m.packUnit}` : `合 ${fmtPacks(pills, m.perBox, m.packUnit)}`;
}
