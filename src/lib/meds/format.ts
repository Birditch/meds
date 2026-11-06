import { diffDays, formatDateCN, formatMonthDay, type ISODate } from "./dates";
import {
  SLOT_LABEL,
  balanceAt,
  dailyTotal,
  dosesLeft,
  finalDose,
  isExhaustedAt,
  nextShortfall,
  regimenAt,
  simulate,
  type Dose,
  type Moment,
  type Outcome,
  type RegimenInput,
  type Shortfall,
  type Simulation,
  type SupplyInput,
} from "./simulate";

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
  /** Short badge text, e.g. "2027-02-14 晚" or "已停药". */
  badge: string;
  tone: Tone;
  /** The full sentence, e.g. "能吃到：2027年02月14日 · 晚". */
  headline: string;
  /** Days / doses left, or how long ago it ran out. */
  detail: string | null;
  /** Set when the final dose is short, e.g. "仅余 1/2 颗，最后完整一顿为当日中". */
  partialNote?: string;
}

/**
 * The verdict for one medication at moment `now`.
 * Amber within 7 days of the final dose, red within 2 days or once it has run out.
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
          badge: `${o.since} 起停药`,
          tone: "muted",
          headline: `${o.since} 起停药（届时剩余 ${fmtQty(o.balance)} 颗）`,
          detail: null,
        };
      }
      return { badge: "已停药", tone: "muted", headline: `已停药（当前剩余 ${left} 颗）`, detail: null };
    }
    case "capped":
      return {
        badge: "10 年以上",
        tone: "ok",
        headline: `按当前规律 10 年内吃不完（至 ${o.until} 仍余 ${fmtQty(o.balance)} 颗）`,
        detail: null,
      };
    case "depleted": {
      const last = finalDose(o);
      if (!last) {
        return { badge: "无药", tone: "danger", headline: "没有可用药量", detail: "请先添加补药记录" };
      }
      const slot = SLOT_LABEL[last.slot];
      const days = diffDays(last.date, now.date);
      const exhausted = isExhaustedAt(sim, now);

      let partialNote: string | null = null;
      if (o.partial) {
        const full = o.lastFull;
        const fullText = !full
          ? "此前没有完整一顿"
          : full.date === o.partial.date
            ? `最后完整一顿为当日${SLOT_LABEL[full.slot]}`
            : `最后完整一顿为 ${full.date} ${SLOT_LABEL[full.slot]}`;
        partialNote = `仅余 ${fmtQty(o.partial.partialRemaining)}/${fmtQty(o.partial.required)} 颗，${fullText}`;
      }

      const headline = o.partial
        ? `能吃到 ${last.date} ${slot}（${partialNote}）`
        : `能吃到：${formatDateCN(last.date)} · ${slot}`;

      let detail: string;
      if (exhausted) detail = days === 0 ? "今天已吃完" : `已于 ${-days} 天前吃完`;
      else if (days === 0) detail = `今天${slot}是最后一顿（还剩 ${dosesLeft(sim, now)} 顿）`;
      else detail = `距今 ${days} 天，还剩 ${dosesLeft(sim, now)} 顿`;

      const tone: Tone = exhausted || days <= 2 ? "danger" : days <= 7 ? "warn" : "ok";
      return {
        badge: exhausted ? `已吃完 ${formatMonthDay(last.date)}` : `${last.date} ${slot}`,
        tone,
        headline,
        detail,
        ...(partialNote ? { partialNote } : {}),
      };
    }
  }
}

export function describeShortfall(s: Shortfall): string {
  const when = `${s.date} ${SLOT_LABEL[s.slot]}`;
  const tail = s.resumesOn ? `，${s.resumesOn} 补药后恢复` : "";
  return `${when}起药量不足${tail}`;
}

/** Everything the list card and the detail header need, computed once. */
export interface MedicationStatus<R extends RegimenInput = RegimenInput> {
  sim: Simulation;
  current: R | null;
  balanceNow: number;
  conclusion: Conclusion;
  shortfall: Shortfall | null;
}

export function medicationStatus<R extends RegimenInput>(
  supplies: readonly SupplyInput[],
  regimens: readonly R[],
  now: Moment,
): MedicationStatus<R> {
  const sim = simulate(supplies, regimens, { today: now.date });
  return {
    sim,
    current: regimenAt(regimens, now.date),
    balanceNow: balanceAt(sim, now),
    conclusion: conclude(sim, now),
    shortfall: nextShortfall(sim, now),
  };
}

export type { ISODate };
