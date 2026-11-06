import type { ISODate } from "./dates";

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
  supplies: SupplyRecord[];
  regimens: RegimenRecord[];
}

export type ActionResult = { ok: true } | { ok: false; error: string };
