import "server-only";

import { asc } from "drizzle-orm";
import { getDb } from "@/db";
import { dosageRegimens, hospitalStays, medicationPacks, medications, reserveLogs, stockCounts, supplyLogs, visits } from "@/db/schema";
import { pinyinKeys } from "./pinyin";
import { sortTags, tagSearchWords } from "./tags";
import type { CountRecord, MedicationRecord, PackRecord, StayRecord, VisitRecord } from "./types";

/** Every medication with its full history. The data set is one household's, so load it whole. */
export async function listMedications(): Promise<MedicationRecord[]> {
  const db = getDb();
  const [meds, packs, supplies, counts, regimens, logs] = await Promise.all([
    db.select().from(medications).orderBy(asc(medications.id)),
    db.select().from(medicationPacks).orderBy(asc(medicationPacks.position), asc(medicationPacks.id)),
    db.select().from(supplyLogs).orderBy(asc(supplyLogs.date), asc(supplyLogs.id)),
    db.select().from(stockCounts).orderBy(asc(stockCounts.date), asc(stockCounts.createdAt)),
    db.select().from(dosageRegimens).orderBy(asc(dosageRegimens.effectiveFrom)),
    db.select().from(reserveLogs).orderBy(asc(reserveLogs.date), asc(reserveLogs.id)),
  ]);
  const drawn = new Set(logs.map((l) => l.supplyLogId));

  const packsOf = new Map<number, PackRecord[]>();
  for (const p of packs) {
    const list = packsOf.get(p.medicationId) ?? [];
    list.push({ id: p.id, brand: p.brand, packUnit: p.packUnit, perBox: p.perBox, reserve: p.reserve });
    packsOf.set(p.medicationId, list);
  }

  const byId = new Map<number, MedicationRecord>(
    meds.map((m) => {
      // Every medication has a pack since migration 0004; the columns are the fallback.
      const own = packsOf.get(m.id) ?? [];
      const list = own.length ? own : [{ id: 0, brand: m.brand, packUnit: m.packUnit, perBox: m.perBox, reserve: m.reserve }];
      const brands = [...new Set(list.map((p) => p.brand).filter((b): b is string => !!b))];
      const tags = sortTags(m.tags);
      return [
        m.id,
        {
          id: m.id,
          name: m.name,
          brand: list[0].brand,
          dosage: m.dosage,
          packUnit: list[0].packUnit,
          perBox: list[0].perBox,
          packs: list,
          reserve: list.reduce((n, p) => n + p.reserve, 0),
          tags,
          supplies: [],
          counts: [],
          reserveLogs: [],
          regimens: [],
          searchKeys: [
            ...pinyinKeys(m.name),
            ...brands,
            ...brands.flatMap((b) => pinyinKeys(b)),
            ...tagSearchWords(tags),
          ],
        },
      ];
    }),
  );
  for (const s of supplies) {
    byId.get(s.medicationId)?.supplies.push({
      id: s.id,
      date: s.date,
      quantity: s.quantity,
      packId: s.packId,
      recordedAt: s.createdAt.getTime(),
      fromReserve: drawn.has(s.id),
    });
  }
  for (const l of logs) {
    byId.get(l.medicationId)?.reserveLogs.push({ id: l.id, date: l.date, kind: l.kind, delta: l.delta, packId: l.packId, recordedAt: l.createdAt.getTime() });
  }
  for (const c of counts) {
    byId.get(c.medicationId)?.counts.push({
      id: c.id,
      date: c.date,
      slotsDone: c.slotsDone as CountRecord["slotsDone"],
      quantity: c.quantity,
      recordedAt: c.createdAt.getTime(),
      packId: c.packId,
    });
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
