"use server";

import { and, asc, eq, gte, lte, ne, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { headers } from "next/headers";
import type { z } from "zod";
import { getDb } from "@/db";
import { dosageRegimens, hospitalStays, medicationPacks, medications, stockCounts, supplyLogs, visits } from "@/db/schema";
import { checkAccess } from "@/lib/access";
import { fmtDate, wallClock } from "@/lib/meds/dates";
import { momentAt } from "@/lib/meds/simulate";
import type { ActionResult } from "@/lib/meds/types";
import {
  createMedicationSchema,
  dateSchema,
  drawSchema,
  idSchema,
  importSchema,
  medicationInfoSchema,
  packSchema,
  regimenSchema,
  reserveSchema,
  staySchema,
  supplySchema,
  type CreateMedicationFields,
  type DrawFields,
  type ImportFields,
  type MedicationInfoFields,
  type PackFields,
  type RegimenFields,
  type StayFields,
  type SupplyFields,
} from "@/lib/meds/validation";

class UserError extends Error {}

function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const r = schema.safeParse(value);
  if (!r.success) throw new UserError(r.error.issues[0]?.message ?? "输入无效");
  return r.data;
}

/**
 * Server Functions are reachable by a direct POST, so each one re-checks Access itself,
 * validates its input, and refreshes the page so the board re-renders with the new data.
 */
async function run(mutate: () => Promise<void>): Promise<ActionResult> {
  const access = await checkAccess(await headers());
  if (!access.ok) return { ok: false, error: "未通过 Cloudflare Access 验证" };
  try {
    await mutate();
  } catch (err) {
    if (err instanceof UserError) return { ok: false, error: err.message };
    console.error("[meds] action failed", err);
    return { ok: false, error: "保存失败，请稍后重试" };
  }
  refresh();
  return { ok: true };
}

async function assertMedication(id: number) {
  const [row] = await getDb().select({ id: medications.id }).from(medications).where(eq(medications.id, id));
  if (!row) throw new UserError("药品不存在或已被删除");
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/** The packs of a medication, the default first. */
const packsOf = (tx: Tx, medicationId: number) =>
  tx
    .select()
    .from(medicationPacks)
    .where(eq(medicationPacks.medicationId, medicationId))
    .orderBy(asc(medicationPacks.position), asc(medicationPacks.id));

/** Copies the default pack onto the medication row (kept for older code and rollbacks). */
async function syncDefaultPack(tx: Tx, medicationId: number) {
  const [first] = await packsOf(tx, medicationId);
  if (!first) return;
  await tx
    .update(medications)
    .set({ brand: first.brand, packUnit: first.packUnit, perBox: first.perBox })
    .where(eq(medications.id, medicationId));
}

async function nextPackPosition(tx: Tx, medicationId: number) {
  const packs = await packsOf(tx, medicationId);
  return packs.length ? Math.max(...packs.map((p) => p.position)) + 1 : 0;
}

/** A supply's pack must be one of its medication's. */
async function assertPack(tx: Tx, medicationId: number, packId: number | null) {
  if (packId === null) return;
  const [row] = await tx
    .select({ id: medicationPacks.id })
    .from(medicationPacks)
    .where(and(eq(medicationPacks.id, packId), eq(medicationPacks.medicationId, medicationId)));
  if (!row) throw new UserError("所选厂家/包装不属于这种药，请刷新后重试");
}

/* ---------------------------------- medications ---------------------------------- */

export async function createMedication(input: CreateMedicationFields): Promise<ActionResult> {
  return run(async () => {
    const { initialSupply, initialRegimen, brand, packUnit, perBox, ...fields } = parse(createMedicationSchema, input);
    await getDb().transaction(async (tx) => {
      const [med] = await tx.insert(medications).values({ ...fields, brand, packUnit, perBox }).returning({ id: medications.id });
      const [pack] = await tx
        .insert(medicationPacks)
        .values({ medicationId: med.id, brand, packUnit, perBox, position: 0 })
        .returning({ id: medicationPacks.id });
      if (initialSupply) await tx.insert(supplyLogs).values({ medicationId: med.id, packId: pack.id, ...initialSupply });
      if (initialRegimen) await tx.insert(dosageRegimens).values({ medicationId: med.id, ...initialRegimen });
    });
  });
}

/** Name, strength and tags; the packs are edited one by one. */
export async function updateMedication(id: number, input: MedicationInfoFields): Promise<ActionResult> {
  return run(async () => {
    const medId = parse(idSchema, id);
    const fields = parse(medicationInfoSchema, input);
    const rows = await getDb().update(medications).set(fields).where(eq(medications.id, medId)).returning({ id: medications.id });
    if (rows.length === 0) throw new UserError("药品不存在或已被删除");
  });
}

/* ------------------------------ packs (manufacturers) ------------------------------ */

/** Another manufacturer's / brand's pack of the same pill; it shares the stock. */
export async function addPack(medicationId: number, input: PackFields): Promise<ActionResult> {
  return run(async () => {
    const medId = parse(idSchema, medicationId);
    const fields = parse(packSchema, input);
    await assertMedication(medId);
    await getDb().transaction(async (tx) => {
      const packs = await packsOf(tx, medId);
      const key = (b: string | null) => (b ?? "").replace(/\s+/g, "").toLowerCase();
      if (packs.some((p) => key(p.brand) === key(fields.brand))) {
        throw new UserError(fields.brand ? `已经有“${fields.brand}”这个厂家/品牌` : "已经有一个没写厂家的包装");
      }
      await tx.insert(medicationPacks).values({ medicationId: medId, ...fields, position: await nextPackPosition(tx, medId) });
      await syncDefaultPack(tx, medId);
    });
  });
}

export async function updatePack(id: number, input: PackFields): Promise<ActionResult> {
  return run(async () => {
    const packId = parse(idSchema, id);
    const fields = parse(packSchema, input);
    await getDb().transaction(async (tx) => {
      const [row] = await tx.update(medicationPacks).set(fields).where(eq(medicationPacks.id, packId)).returning();
      if (!row) throw new UserError("这个厂家/包装不存在或已被删除");
      await syncDefaultPack(tx, row.medicationId);
    });
  });
}

/** Removes a pack; supplies bought in it keep their pills (they lose the pack). The last one stays. */
export async function deletePack(id: number): Promise<ActionResult> {
  return run(async () => {
    const packId = parse(idSchema, id);
    await getDb().transaction(async (tx) => {
      const [row] = await tx.select().from(medicationPacks).where(eq(medicationPacks.id, packId)).for("update");
      if (!row) return;
      if ((await packsOf(tx, row.medicationId)).length <= 1) throw new UserError("每种药至少保留一个厂家/包装");
      await tx.delete(medicationPacks).where(eq(medicationPacks.id, packId));
      await syncDefaultPack(tx, row.medicationId);
    });
  });
}

/** Makes a pack the default: visits count whole packs of it. */
export async function setDefaultPack(id: number): Promise<ActionResult> {
  return run(async () => {
    const packId = parse(idSchema, id);
    await getDb().transaction(async (tx) => {
      const [row] = await tx.select().from(medicationPacks).where(eq(medicationPacks.id, packId));
      if (!row) throw new UserError("这个厂家/包装不存在或已被删除");
      const order = [row, ...(await packsOf(tx, row.medicationId)).filter((p) => p.id !== packId)];
      for (const [position, p] of order.entries()) {
        if (p.position !== position) await tx.update(medicationPacks).set({ position }).where(eq(medicationPacks.id, p.id));
      }
      await syncDefaultPack(tx, row.medicationId);
    });
  });
}

/** Sets how many extra pills are kept at home; they never enter the stock simulation. */
export async function setReserve(id: number, reserve: number): Promise<ActionResult> {
  return run(async () => {
    const medId = parse(idSchema, id);
    const value = parse(reserveSchema, reserve);
    const rows = await getDb()
      .update(medications)
      .set({ reserve: value })
      .where(eq(medications.id, medId))
      .returning({ id: medications.id });
    if (rows.length === 0) throw new UserError("药品不存在或已被删除");
  });
}

/** Takes pills out of the reserve into the current stock: one supply log, reserve reduced. */
export async function drawFromReserve(id: number, input: DrawFields): Promise<ActionResult> {
  return run(async () => {
    const medId = parse(idSchema, id);
    const { date, quantity } = parse(drawSchema, input);
    await getDb().transaction(async (tx) => {
      const rows = await tx
        .update(medications)
        .set({ reserve: sql`${medications.reserve} - ${quantity}` })
        .where(and(eq(medications.id, medId), gte(medications.reserve, quantity)))
        .returning({ id: medications.id });
      if (rows.length === 0) {
        const [med] = await tx.select({ reserve: medications.reserve }).from(medications).where(eq(medications.id, medId));
        throw new UserError(med ? `储备只剩 ${med.reserve} 颗，不够取` : "药品不存在或已被删除");
      }
      await tx.insert(supplyLogs).values({ medicationId: medId, date, quantity });
    });
  });
}

export async function deleteMedication(id: number): Promise<ActionResult> {
  return run(async () => {
    await getDb().delete(medications).where(eq(medications.id, parse(idSchema, id)));
  });
}

/* ---------------------------------- supply logs ---------------------------------- */

export async function addSupply(medicationId: number, input: SupplyFields): Promise<ActionResult> {
  return run(async () => {
    const medId = parse(idSchema, medicationId);
    const fields = parse(supplySchema, input);
    await assertMedication(medId);
    await getDb().transaction(async (tx) => {
      await assertPack(tx, medId, fields.packId);
      await tx.insert(supplyLogs).values({ medicationId: medId, ...fields });
    });
  });
}

export async function updateSupply(id: number, input: SupplyFields): Promise<ActionResult> {
  return run(async () => {
    const logId = parse(idSchema, id);
    const fields = parse(supplySchema, input);
    await getDb().transaction(async (tx) => {
      const [log] = await tx.select({ medicationId: supplyLogs.medicationId }).from(supplyLogs).where(eq(supplyLogs.id, logId));
      if (!log) throw new UserError("记录不存在或已被删除");
      await assertPack(tx, log.medicationId, fields.packId);
      await tx.update(supplyLogs).set(fields).where(eq(supplyLogs.id, logId));
    });
  });
}

export async function deleteSupply(id: number): Promise<ActionResult> {
  return run(async () => {
    await getDb().delete(supplyLogs).where(eq(supplyLogs.id, parse(idSchema, id)));
  });
}

/* ---------------------------------- stock counts ---------------------------------- */

export async function deleteCount(id: number): Promise<ActionResult> {
  return run(async () => {
    await getDb().delete(stockCounts).where(eq(stockCounts.id, parse(idSchema, id)));
  });
}

/**
 * One-click import, all or nothing: stock counts, reserves, pack sizes and regimens of
 * existing medications, plus new medications.
 *
 * Existing stock is recorded as a count at `at`, so from then on it is exactly what was
 * counted. A new medication has no history to count against: its stock becomes a supply that
 * day, plus the doses already taken by then, so that after them exactly the counted pills remain.
 */
export async function importStock(input: ImportFields): Promise<ActionResult> {
  return run(async () => {
    const { at, rows } = parse(importSchema, input);
    const clock = wallClock();
    const now = momentAt(clock.date, clock.minutes);
    if (at.date > now.date || (at.date === now.date && at.slotsDone > now.slotsDone)) {
      throw new UserError("清点时间不能晚于现在");
    }

    await getDb().transaction(async (tx) => {
      const inHospital =
        (
          await tx
            .select({ id: hospitalStays.id })
            .from(hospitalStays)
            .where(and(lte(hospitalStays.startDate, at.date), gte(hospitalStays.endDate, at.date)))
        ).length > 0;
      const setRegimen = (medicationId: number, d: { morning: number; noon: number; evening: number }) =>
        tx
          .insert(dosageRegimens)
          .values({ medicationId, effectiveFrom: at.date, ...d })
          .onConflictDoUpdate({ target: [dosageRegimens.medicationId, dosageRegimens.effectiveFrom], set: d });

      for (const row of rows) {
        if (row.kind === "existing") {
          const packs = await packsOf(tx, row.id);
          if (packs.length === 0) throw new UserError("有药品已被删除，请刷新后重新录入");
          const pack = { packUnit: row.packUnit, perBox: row.perBox };
          if (row.pack && "brand" in row.pack) {
            await tx.insert(medicationPacks).values({ medicationId: row.id, brand: row.pack.brand, ...pack, position: await nextPackPosition(tx, row.id) });
          } else {
            const target = row.pack ? packs.find((p) => p.id === (row.pack as { id: number }).id) : packs[0];
            if (!target) throw new UserError("有药品的厂家/包装已被删除，请刷新后重新录入");
            if (target.packUnit !== pack.packUnit || target.perBox !== pack.perBox) {
              await tx.update(medicationPacks).set(pack).where(eq(medicationPacks.id, target.id));
            }
          }
          await syncDefaultPack(tx, row.id);
          if (row.reserve !== null) await tx.update(medications).set({ reserve: row.reserve }).where(eq(medications.id, row.id));
          if (row.regimen) await setRegimen(row.id, row.regimen);
          if (row.stock !== null) {
            await tx
              .insert(stockCounts)
              .values({ medicationId: row.id, date: at.date, slotsDone: at.slotsDone, quantity: row.stock })
              .onConflictDoUpdate({
                target: [stockCounts.medicationId, stockCounts.date],
                set: { slotsDone: at.slotsDone, quantity: row.stock, createdAt: sql`now()` },
              });
          }
        } else {
          const { stock, reserve, regimen, name, brand, dosage, packUnit, perBox, tags } = row;
          const [med] = await tx
            .insert(medications)
            .values({ name, brand, dosage, packUnit, perBox, tags, reserve: reserve ?? 0 })
            .returning({ id: medications.id });
          const [newPack] = await tx
            .insert(medicationPacks)
            .values({ medicationId: med.id, brand, packUnit, perBox, position: 0 })
            .returning({ id: medicationPacks.id });
          if (regimen) await setRegimen(med.id, regimen);
          if (stock !== null) {
            const doses = regimen && !inHospital ? [regimen.morning, regimen.noon, regimen.evening] : [];
            const takenBefore = doses.slice(0, at.slotsDone).reduce((a, b) => a + b, 0);
            const quantity = stock + takenBefore;
            if (quantity > 0) await tx.insert(supplyLogs).values({ medicationId: med.id, packId: newPack.id, date: at.date, quantity });
          }
        }
      }
    });
  });
}

/* -------------------------------- dosage regimens -------------------------------- */

/** Adds a regimen from `effectiveFrom` on; one already set for that same day is overwritten. */
export async function saveRegimen(medicationId: number, input: RegimenFields): Promise<ActionResult> {
  return run(async () => {
    const medId = parse(idSchema, medicationId);
    const { effectiveFrom, morning, noon, evening } = parse(regimenSchema, input);
    await assertMedication(medId);
    await getDb()
      .insert(dosageRegimens)
      .values({ medicationId: medId, effectiveFrom, morning, noon, evening })
      .onConflictDoUpdate({
        target: [dosageRegimens.medicationId, dosageRegimens.effectiveFrom],
        set: { morning, noon, evening },
      });
  });
}

/** Edits one regimen. Moving it onto a day that already has one replaces that day's regimen. */
export async function updateRegimen(id: number, input: RegimenFields): Promise<ActionResult> {
  return run(async () => {
    const regimenId = parse(idSchema, id);
    const fields = parse(regimenSchema, input);
    await getDb().transaction(async (tx) => {
      const [current] = await tx
        .select({ medicationId: dosageRegimens.medicationId })
        .from(dosageRegimens)
        .where(eq(dosageRegimens.id, regimenId))
        .for("update");
      if (!current) throw new UserError("规律不存在或已被删除");
      await tx
        .delete(dosageRegimens)
        .where(
          and(
            eq(dosageRegimens.medicationId, current.medicationId),
            eq(dosageRegimens.effectiveFrom, fields.effectiveFrom),
            ne(dosageRegimens.id, regimenId),
          ),
        );
      await tx.update(dosageRegimens).set(fields).where(eq(dosageRegimens.id, regimenId));
    });
  });
}

export async function deleteRegimen(id: number): Promise<ActionResult> {
  return run(async () => {
    await getDb().delete(dosageRegimens).where(eq(dosageRegimens.id, parse(idSchema, id)));
  });
}

/* ------------------------------------ visits ------------------------------------- */

const isUniqueViolation = (err: unknown) =>
  typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505";

export async function addVisit(date: string): Promise<ActionResult> {
  return run(async () => {
    const day = parse(dateSchema, date);
    const rows = await getDb().insert(visits).values({ date: day }).onConflictDoNothing().returning({ id: visits.id });
    if (rows.length === 0) throw new UserError(`${fmtDate(day)} 已经有就诊安排`);
  });
}

export async function updateVisit(id: number, date: string): Promise<ActionResult> {
  return run(async () => {
    const visitId = parse(idSchema, id);
    const day = parse(dateSchema, date);
    try {
      const rows = await getDb().update(visits).set({ date: day }).where(eq(visits.id, visitId)).returning({ id: visits.id });
      if (rows.length === 0) throw new UserError("就诊记录不存在或已被删除");
    } catch (err) {
      if (isUniqueViolation(err)) throw new UserError(`${fmtDate(day)} 已经有就诊安排`);
      throw err;
    }
  });
}

export async function deleteVisit(id: number): Promise<ActionResult> {
  return run(async () => {
    await getDb().delete(visits).where(eq(visits.id, parse(idSchema, id)));
  });
}

/* -------------------------------- hospital stays --------------------------------- */

export async function addStay(input: StayFields): Promise<ActionResult> {
  return run(async () => {
    await getDb().insert(hospitalStays).values(parse(staySchema, input));
  });
}

export async function updateStay(id: number, input: StayFields): Promise<ActionResult> {
  return run(async () => {
    const stayId = parse(idSchema, id);
    const fields = parse(staySchema, input);
    const rows = await getDb().update(hospitalStays).set(fields).where(eq(hospitalStays.id, stayId)).returning({ id: hospitalStays.id });
    if (rows.length === 0) throw new UserError("住院记录不存在或已被删除");
  });
}

export async function deleteStay(id: number): Promise<ActionResult> {
  return run(async () => {
    await getDb().delete(hospitalStays).where(eq(hospitalStays.id, parse(idSchema, id)));
  });
}
