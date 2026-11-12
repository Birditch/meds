import type { ISODate } from "./dates";
import type { Slot } from "./simulate";

export const PACK_UNITS = ["盒", "瓶"] as const;
export type PackUnit = (typeof PACK_UNITS)[number];

export interface SupplyRecord {
  id: number;
  date: ISODate;
  quantity: number;
  /** The pack bought (which manufacturer), when recorded. */
  packId: number | null;
  /** When it was entered (ms since epoch): a supply entered after a same-day count comes on top of it. */
  recordedAt: number;
  /** Taken out of the reserve: deleting it puts the pills back there. */
  fromReserve: boolean;
  /** Where the pills came from (药品来源), when recorded. */
  source: string | null;
}

export const RESERVE_LOG_KINDS = ["restock", "draw", "count", "transfer", "use", "missed"] as const;
export type ReserveLogKind = (typeof RESERVE_LOG_KINDS)[number];

/** Why pills left the reserve without entering the stock (消耗储备), 已服用 first; labels in format.ts. */
export const RESERVE_USE_REASONS = ["taken", "carry", "discarded", "lost", "given", "other"] as const;
export type ReserveUseReason = (typeof RESERVE_USE_REASONS)[number];

/** One change to a pack's reserve. */
export interface ReserveLogRecord {
  id: number;
  date: ISODate;
  kind: ReserveLogKind;
  /** What it did to the reserve, in pills (negative for a draw or a use). */
  delta: number;
  packId: number;
  recordedAt: number;
  /** A draw: where the pills came from, when recorded. */
  source: string | null;
  /** A use for 已服用: the dose (早 / 中 / 晚) they were taken at. */
  timeOfDay: Slot | null;
  /** A use for 已服用: it was that dose of the regimen, so the stock does not lose it. */
  regular: boolean;
  /** A transfer: how many of that day's doses were behind it (it takes the pills out of the stock then). */
  slotsDone: 0 | 1 | 2 | 3 | null;
  /** A transfer recorded as a stock count of what stayed (before 2026-11-13): the count already holds it. */
  viaCount: boolean;
  /** A use: why the pills left the reserve. */
  reason: ReserveUseReason | null;
  /** A use: anything written down about it. */
  note: string | null;
  /** A missed dose put into the reserve (MissedDoseRecord.id). */
  missedDoseId: number | null;
}

/** Where the pills of a dose not taken went: still in the stock, into the reserve, or gone. */
export const MISSED_DOSE_KEPT = ["stock", "reserve", "none"] as const;
export type MissedDoseKept = (typeof MISSED_DOSE_KEPT)[number];

/** 漏服: (part of) one scheduled dose not taken. */
export interface MissedDoseRecord {
  id: number;
  date: ISODate;
  slot: Slot;
  /** Pills not taken, at most that slot's dose. */
  quantity: number;
  /** stock: the slot takes that much less from the stock; reserve / none: the stock goes down as if taken. */
  kept: MissedDoseKept;
  /** kept "reserve": the pack whose reserve got the pills. */
  packId: number | null;
  recordedAt: number;
}

/** A stock count: the pills actually at home after `slotsDone` (0–3) of that day's doses. */
export interface CountRecord {
  id: number;
  date: ISODate;
  slotsDone: 0 | 1 | 2 | 3;
  quantity: number;
  recordedAt: number;
  /** The pack counted, or null for all of the medication's packs together. */
  packId: number | null;
}

export interface RegimenRecord {
  id: number;
  effectiveFrom: ISODate;
  morning: number;
  noon: number;
  evening: number;
}

/** One way a medication comes: a manufacturer's / brand's pack. */
export interface PackRecord {
  id: number;
  /** Manufacturer or brand (厂家 / 品牌), or null. */
  brand: string | null;
  packUnit: PackUnit;
  /** Pills per pack, or null when not entered. */
  perBox: number | null;
  /** This pack's pills kept aside as a reserve. */
  reserve: number;
}

/**
 * One medication is one pill: a name and a strength. It can come from several manufacturers
 * (packs), each with its own stock and reserve, taken one after the other (the default first);
 * another strength of the same drug is another medication.
 */
export interface MedicationRecord {
  id: number;
  name: string;
  /** brand / packUnit / perBox are the default pack's (packs[0]). */
  brand: string | null;
  dosage: string;
  /** How it is packed: 盒 or 瓶. */
  packUnit: PackUnit;
  /** Pills per pack (box / bottle), or null when not entered. */
  perBox: number | null;
  /** Every pack, the default first. */
  packs: PackRecord[];
  /** Extra pills kept at home, outside the stock simulation: every pack's reserve added up. */
  reserve: number;
  /** Catalog tag codes (src/lib/meds/tags.ts) and the user's own tags, in display order. */
  tags: string[];
  supplies: SupplyRecord[];
  counts: CountRecord[];
  /** Every recorded change to the reserve, oldest first. */
  reserveLogs: ReserveLogRecord[];
  /** Doses not taken (漏服), oldest first. */
  misses: MissedDoseRecord[];
  regimens: RegimenRecord[];
  /** Pinyin of name and every brand (full and initials) and the tags' names, for fuzzy search. */
  searchKeys: string[];
}

export interface VisitRecord {
  id: number;
  date: ISODate;
}

/** A hospital stay, both ends included: nothing is taken from home stock. */
export interface StayRecord {
  id: number;
  startDate: ISODate;
  endDate: ISODate;
}

export type ActionResult = { ok: true } | { ok: false; error: string };
