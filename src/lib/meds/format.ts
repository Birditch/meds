import { diffDays, fmtDate } from "./dates";
import {
  SLOT_LABEL,
  balanceAt,
  dailyTotal,
  finalDose,
  fullDays,
  isExhaustedAt,
  nextShortfall,
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
  type SupplyInput,
} from "./simulate";
import { planHorizon, planVisits, type VisitPlan, type VisitSchedule } from "./visits";

/** When a stock count was taken, by how many of the day's doses were behind it. */
export const COUNT_MOMENT_LABEL = ["早上服药前", "早上服药后", "中午服药后", "晚上服药后"] as const;

/** 100 → "100", 1.5 → "1.5" */
export const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** "早 1 · 中 0 · 晚 1（2颗/天）" */
export function formatRegimen(d: Dose | null): string {
  if (!d) return "未设置";
  return `早 ${fmtQty(d.morning)} · 中 ${fmtQty(d.noon)} · 晚 ${fmtQty(d.evening)}（${fmtQty(dailyTotal(d))}颗/天）`;
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
  conclusion: Conclusion;
  shortfall: Shortfall | null;
  plan: VisitPlan;
}

export interface StatusOptions {
  /** Hospital stays: nothing is taken from home stock. */
  pauses?: readonly DateRange[];
  /** Pills per box, so visits get whole boxes. */
  perBox?: number | null;
  /** Stock counts: the stock is what was counted, from that moment on. */
  counts?: readonly CountInput[];
}

export function medicationStatus<R extends RegimenInput>(
  supplies: readonly SupplyInput[],
  regimens: readonly R[],
  now: Moment,
  schedule: readonly VisitSchedule[] = [],
  { pauses = [], perBox = null, counts = [] }: StatusOptions = {},
): MedicationStatus<R> {
  const sim = simulate(supplies, regimens, { today: now.date, until: planHorizon(schedule), pauses, counts });
  return {
    sim,
    current: regimenAt(regimens, now.date),
    balanceNow: balanceAt(sim, now),
    conclusion: conclude(sim, now),
    shortfall: nextShortfall(sim, now),
    plan: planVisits(sim, schedule, now, perBox),
  };
}

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
