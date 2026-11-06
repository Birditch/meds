/**
 * The printable lists (PDF): what to get at a visit, the current stock, and the reserve.
 * Pure: the same projection the board shows, put into rows and sentences.
 *
 * The visit list and the stock list count current stock only; the reserve never enters them.
 * Every supply log counts as a purchase.
 */

import { addDays, diffDays, fmtDate, type ISODate } from "./dates";
import {
  COUNT_MOMENT_LABEL,
  describeReserve,
  fmtPacks,
  fmtQty,
  formatRegimen,
  intakeAt,
  isTaking,
  medicationStatus,
  type Intake,
  type MedicationStatus,
} from "./format";
import { dailyTotal, type Moment } from "./simulate";
import { isSpecialRx, tagDef, tagLabel } from "./tags";
import type { MedicationRecord, PackRecord, StayRecord, VisitRecord } from "./types";
import { scheduleVisits, spanText, type VisitNeed } from "./visits";

export interface ReportInput {
  medications: readonly MedicationRecord[];
  visits: readonly VisitRecord[];
  stays: readonly StayRecord[];
  now: Moment;
}

export interface ReportItem {
  medication: MedicationRecord;
  status: MedicationStatus;
  intake: Intake;
  /** Being taken (or about to start): 在吃. */
  taking: boolean;
}

/** Every medication, the ones being taken first (otherwise in the given order). */
function evaluate(input: ReportInput) {
  const schedule = scheduleVisits(input.visits, input.now.date);
  const pauses = input.stays.map((s) => ({ start: s.startDate, end: s.endDate }));
  const items: ReportItem[] = input.medications.map((m) => {
    const intake = intakeAt(m.regimens, input.now.date);
    return {
      medication: m,
      status: medicationStatus(m.supplies, m.regimens, input.now, schedule, { pauses, perBox: m.perBox, counts: m.counts }),
      intake,
      taking: isTaking(intake),
    };
  });
  return { schedule, items: [...items.filter((it) => it.taking), ...items.filter((it) => !it.taking)] };
}

type Labelled = Pick<MedicationRecord, "name" | "brand" | "dosage"> & Partial<Pick<MedicationRecord, "packs">>;

const brandsOf = (m: Labelled) => [...new Set((m.packs ?? [{ brand: m.brand }]).map((p) => p.brand).filter(Boolean))];

/** "氯硝西泮片 2mg · 湖南洞庭 / 江苏恩华" */
export const medicationLabel = (m: Labelled) => [`${m.name} ${m.dosage}`, brandsOf(m).join(" / ")].filter(Boolean).join(" · ");

/** "7 颗/盒", or null when the pack size is unknown. */
export const packSize = (m: Pick<MedicationRecord, "perBox" | "packUnit">) =>
  m.perBox ? `${fmtQty(m.perBox)} 颗/${m.packUnit}` : null;

/** Every pack: "湖南洞庭 每盒 14 颗；江苏恩华 每盒 20 颗". */
export function packsText(m: MedicationRecord): string {
  return m.packs
    .map((p) => `${p.brand ? `${p.brand} ` : ""}${p.perBox ? `每${p.packUnit} ${fmtQty(p.perBox)} 颗` : `未写明每${p.packUnit}颗数`}`)
    .join("；");
}

/** "精二 · 处方药" */
export const tagsText = (m: Pick<MedicationRecord, "tags">) => m.tags.map((t) => tagLabel(t).short).join(" · ");

/** The tags' full names, then what the special ones mean for the prescription. */
export function tagLines(m: Pick<MedicationRecord, "tags">): string[] {
  if (!m.tags.length) return [];
  const notes = m.tags.flatMap((t) => (tagDef(t)?.note ? [`${tagLabel(t).label}：${tagDef(t)!.note}`] : []));
  return [m.tags.map((t) => tagLabel(t).label).join("、"), ...notes];
}

export const specialRx = (m: Pick<MedicationRecord, "tags">) => isSpecialRx(m.tags);

/** "精二": the special-prescription tags only. */
export const specialRxText = (m: Pick<MedicationRecord, "tags">) =>
  m.tags.filter((t) => isSpecialRx([t])).map((t) => tagLabel(t).short).join("、");

/** The pack a supply was bought in, when recorded. */
const packOf = (m: MedicationRecord, id: number | null): PackRecord | undefined => (id === null ? undefined : m.packs.find((p) => p.id === id));

/** "2026.11.05 周四 购买 28 颗（4 盒 · 江苏恩华）", newest last; packs only from one pack up. */
export function purchaseLines(m: MedicationRecord, today: ISODate): string[] {
  return [...m.supplies]
    .sort((a, b) => (a.date === b.date ? a.recordedAt - b.recordedAt : a.date < b.date ? -1 : 1))
    .map((s) => {
      const p = packOf(m, s.packId) ?? m;
      const parts = [
        p.perBox && s.quantity >= p.perBox ? fmtPacks(s.quantity, p.perBox, p.packUnit) : null,
        m.packs.length > 1 ? (packOf(m, s.packId)?.brand ?? null) : null,
      ].filter(Boolean);
      return `${fmtDate(s.date)} ${s.date > today ? "计划购买" : "购买"} ${fmtQty(s.quantity)} 颗${parts.length ? `（${parts.join(" · ")}）` : ""}`;
    });
}

/** The same need in the other manufacturers' packs: "或 江苏恩华 2 盒（40 颗）". */
export function otherPacksText(need: Pick<VisitNeed, "need">, m: MedicationRecord): string | null {
  if (need.need === 0) return null;
  const others = m.packs.slice(1).filter((p) => p.perBox);
  if (!others.length) return null;
  return others
    .map((p) => {
      const n = Math.ceil(need.need / p.perBox! - 1e-9);
      return `或 ${p.brand ?? "其他厂家"} ${n} ${p.packUnit}（${fmtQty(n * p.perBox!)} 颗）`;
    })
    .join("；");
}

/** "2026.11.07 周六 早上服药前盘点：剩 26 颗" */
export function countLines(m: MedicationRecord): string[] {
  return m.counts.map((c) => `${fmtDate(c.date)} ${COUNT_MOMENT_LABEL[c.slotsDone]}盘点：剩 ${fmtQty(c.quantity)} 颗`);
}

/** "4 盒（26 颗）": packs to get, the pills actually lacking in brackets; pills only without a pack size. */
export function needText(need: Pick<VisitNeed, "need" | "packs">, m: Pick<MedicationRecord, "packUnit">): string {
  if (need.need === 0) return "无需开药";
  return need.packs !== null ? `${need.packs} ${m.packUnit}（${fmtQty(need.need)} 颗）` : `${fmtQty(need.need)} 颗`;
}

/* ------------------------------------- visit list ------------------------------------- */

export interface VisitItem extends ReportItem {
  need: VisitNeed;
}

export interface VisitReport {
  date: ISODate;
  /** 0 = the next visit. */
  index: number;
  /** The evening whose leftover stock is counted: the day before the visit. */
  cutoff: ISODate;
  coverUntil: ISODate;
  days: number;
  /** The period end was assumed (4 weeks), no later visit being entered. */
  estimated: boolean;
  /** The visit after this one, if entered. */
  following: ISODate | null;
  needed: VisitItem[];
  /** Taken, and the stock already lasts. */
  covered: VisitItem[];
  /** Not being taken: nothing to get. */
  inactive: VisitItem[];
}

/** The list for one upcoming visit (the next one by default); null when there is no such visit. */
export function visitReport(input: ReportInput, date?: ISODate): VisitReport | null {
  const { schedule, items } = evaluate(input);
  const index = date ? schedule.findIndex((v) => v.date === date) : 0;
  const v = schedule[index];
  if (!v) return null;
  const all = items.map((it) => ({ ...it, need: it.status.plan.visits[index] }));
  const coverUntil = all[0]?.need.coverUntil ?? addDays(v.date, -1);
  return {
    date: v.date,
    index,
    cutoff: addDays(v.date, -1),
    coverUntil,
    days: diffDays(coverUntil, v.date) + 1,
    estimated: v.estimated,
    following: schedule[index + 1]?.date ?? null,
    needed: all.filter((it) => it.need.need > 0),
    covered: all.filter((it) => it.need.need === 0 && it.taking),
    inactive: all.filter((it) => it.need.need === 0 && !it.taking),
  };
}

/** Why this medication has to be got again, with the numbers. */
export function needReason(item: VisitItem, report: VisitReport, now: Moment): string {
  const { need } = item;
  const left = report.date === now.date ? `现在剩 ${fmtQty(need.stockBefore)} 颗` : `${fmtDate(report.cutoff)} 晚上吃完后剩 ${fmtQty(need.stockBefore)} 颗`;
  const supplied = need.supplied > 0 ? `，期间已记的补药 ${fmtQty(need.supplied)} 颗也算上了` : "";
  return (
    `不够了：${left}；从 ${fmtDate(report.date)} 吃到 ${fmtDate(report.coverUntil)} 晚上共 ${spanText(report.days)}，` +
    `按规律需 ${fmtQty(need.demand)} 颗${supplied}，缺 ${fmtQty(need.need)} 颗。`
  );
}

/** What to get: "2 盒，共 48 颗（缺 28 颗，多出的 20 颗留到下次）". */
export function prescriptionText(need: VisitNeed, m: Pick<MedicationRecord, "packUnit">): string {
  if (need.need === 0) return "无需开药";
  if (need.packs === null) return `${fmtQty(need.need)} 颗（未写明每${m.packUnit}颗数，按颗开）`;
  const extra = Math.round((need.prescribed - need.need) * 2) / 2;
  const total = `${need.packs} ${m.packUnit}，共 ${fmtQty(need.prescribed)} 颗`;
  return extra > 0 ? `${total}（缺 ${fmtQty(need.need)} 颗，多出的 ${fmtQty(extra)} 颗留到下次）` : total;
}

/** For the next visit only: the stock runs out before it. */
export function gapWarning(item: VisitItem, report: VisitReport): string | null {
  const gap = report.index === 0 ? item.status.plan.beforeFirst : null;
  if (!gap) return null;
  const latest = gap.latestVisit ? `最晚 ${fmtDate(gap.latestVisit)} 就诊才不会断药` : "需要提前加诊";
  return `等不到这次就诊：${fmtDate(gap.from.date)} 起就会断药，到就诊前还缺 ${fmtQty(gap.shortfall)} 颗（${latest}）。这部分不含在上面的开药量里。`;
}

/* ------------------------------------- stock list ------------------------------------- */

export interface StockReport {
  /** Being taken first, then the rest. */
  items: ReportItem[];
  /** The next visit, for the "需开" column. */
  nextVisit: ISODate | null;
}

export function stockReport(input: ReportInput): StockReport {
  const { schedule, items } = evaluate(input);
  return { items, nextVisit: schedule[0]?.date ?? null };
}

/** "早 0 · 中 0 · 晚 1（1颗/天）" or "未设置". */
export const regimenText = (it: ReportItem) => formatRegimen(it.status.current);

/** Daily pills, for compact columns. */
export const dailyText = (it: ReportItem) => (it.status.current ? `${fmtQty(dailyTotal(it.status.current))} 颗/天` : "未设规律");

/* ------------------------------------ reserve list ------------------------------------ */

export interface ReserveReport {
  /** Medications with something in reserve. */
  items: (ReportItem & { lasts: string })[];
  /** Medications with nothing in reserve. */
  empty: MedicationRecord[];
}

export function reserveReport(input: ReportInput): ReserveReport {
  const { items } = evaluate(input);
  return {
    items: items
      .filter((it) => it.medication.reserve > 0)
      .map((it) => ({ ...it, lasts: describeReserve(it.medication.reserve, it.status.current) })),
    empty: items.filter((it) => it.medication.reserve <= 0).map((it) => it.medication),
  };
}
