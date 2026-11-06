import type { ISODate } from "./dates";

export const PACK_UNITS = ["盒", "瓶"] as const;
export type PackUnit = (typeof PACK_UNITS)[number];

export interface SupplyRecord {
  id: number;
  date: ISODate;
  quantity: number;
}

export interface RegimenRecord {
  id: number;
  effectiveFrom: ISODate;
  morning: number;
  noon: number;
  evening: number;
}

export interface MedicationRecord {
  id: number;
  name: string;
  brand: string | null;
  dosage: string;
  /** How it is packed: 盒 or 瓶. */
  packUnit: PackUnit;
  /** Pills per pack (box / bottle), or null when not entered. */
  perBox: number | null;
  /** Extra pills kept at home, outside the stock simulation. */
  reserve: number;
  supplies: SupplyRecord[];
  regimens: RegimenRecord[];
  /** Pinyin of name and brand (full and initials), computed on the server for fuzzy search. */
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
