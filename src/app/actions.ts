"use server";

import { and, eq, gte, lte, ne, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { headers } from "next/headers";
import type { z } from "zod";
import { getDb } from "@/db";
import { dosageRegimens, hospitalStays, medications, stockCounts, supplyLogs, visits } from "@/db/schema";
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
  medicationSchema,
  regimenSchema,
  reserveSchema,
  staySchema,
  supplySchema,
  type CreateMedicationFields,
  type DrawFields,
  type ImportFields,
  type MedicationFields,
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

/* ---------------------------------- medications ---------------------------------- */

export async function createMedication(input: CreateMedicationFields): Promise<ActionResult> {
  return run(async () => {
    const { initialSupply, initialRegimen, ...fields } = parse(createMedicationSchema, input);
    await getDb().transaction(async (tx) => {
      const [med] = await tx.insert(medications).values(fields).returning({ id: medications.id });
      if (initialSupply) await tx.insert(supplyLogs).values({ medicationId: med.id, ...initialSupply });
      if (initialRegimen) await tx.insert(dosageRegimens).values({ medicationId: med.id, ...initialRegimen });
    });
  });
}

export async function updateMedication(id: number, input: MedicationFields): Promise<ActionResult> {
  return run(async () => {
    const medId = parse(idSchema, id);
    const fields = parse(medicationSchema, input);
    const rows = await getDb().update(medications).set(fields).where(eq(medications.id, medId)).returning({ id: medications.id });
    if (rows.length === 0) throw new UserError("药品不存在或已被删除");
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
    await getDb().insert(supplyLogs).values({ medicationId: medId, ...fields });
  });
}

export async function updateSupply(id: number, input: SupplyFields): Promise<ActionResult> {
  return run(async () => {
    const logId = parse(idSchema, id);
    const fields = parse(supplySchema, input);
    const rows = await getDb().update(supplyLogs).set(fields).where(eq(supplyLogs.id, logId)).returning({ id: supplyLogs.id });
    if (rows.length === 0) throw new UserError("记录不存在或已被删除");
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
          const updated = await tx
            .update(medications)
            .set({ packUnit: row.packUnit, perBox: row.perBox, ...(row.reserve !== null ? { reserve: row.reserve } : {}) })
            .where(eq(medications.id, row.id))
            .returning({ id: medications.id });
          if (updated.length === 0) throw new UserError("有药品已被删除，请刷新后重新录入");
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
          const { stock, reserve, regimen, name, brand, dosage, packUnit, perBox } = row;
          const [med] = await tx
            .insert(medications)
            .values({ name, brand, dosage, packUnit, perBox, reserve: reserve ?? 0 })
            .returning({ id: medications.id });
          if (regimen) await setRegimen(med.id, regimen);
          if (stock !== null) {
            const doses = regimen && !inHospital ? [regimen.morning, regimen.noon, regimen.evening] : [];
            const takenBefore = doses.slice(0, at.slotsDone).reduce((a, b) => a + b, 0);
            const quantity = stock + takenBefore;
            if (quantity > 0) await tx.insert(supplyLogs).values({ medicationId: med.id, date: at.date, quantity });
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
