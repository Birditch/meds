import type { ISODate } from "./dates";

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
