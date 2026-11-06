import "server-only";

import { asc } from "drizzle-orm";
import { getDb } from "@/db";
import { dosageRegimens, hospitalStays, medications, supplyLogs, visits } from "@/db/schema";
import { pinyinKeys } from "./pinyin";
import type { MedicationRecord, StayRecord, VisitRecord } from "./types";

/** Every medication with its full history. The data set is one household's, so load it whole. */
export async function listMedications(): Promise<MedicationRecord[]> {
  const db = getDb();
  const [meds, supplies, regimens] = await Promise.all([
    db.select().from(medications).orderBy(asc(medications.id)),
    db.select().from(supplyLogs).orderBy(asc(supplyLogs.date), asc(supplyLogs.id)),
    db.select().from(dosageRegimens).orderBy(asc(dosageRegimens.effectiveFrom)),
  ]);

  const byId = new Map<number, MedicationRecord>(
    meds.map((m) => [
      m.id,
      {
        id: m.id,
        name: m.name,
        brand: m.brand,
        dosage: m.dosage,
        packUnit: m.packUnit,
        perBox: m.perBox,
        reserve: m.reserve,
        supplies: [],
        regimens: [],
        searchKeys: [...pinyinKeys(m.name), ...pinyinKeys(m.brand ?? "")],
      },
    ]),
  );
  for (const s of supplies) {
    byId.get(s.medicationId)?.supplies.push({ id: s.id, date: s.date, quantity: s.quantity });
  }
  for (const r of regimens) {
    byId.get(r.medicationId)?.regimens.push({
      id: r.id,
      effectiveFrom: r.effectiveFrom,
      morning: r.morning,
      noon: r.noon,
      evening: r.evening,
    });
  }
  return [...byId.values()];
}

export async function listVisits(): Promise<VisitRecord[]> {
  return getDb().select().from(visits).orderBy(asc(visits.date));
}

export async function listStays(): Promise<StayRecord[]> {
  return getDb().select().from(hospitalStays).orderBy(asc(hospitalStays.startDate));
}
