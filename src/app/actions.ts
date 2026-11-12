"use server";

import { and, asc, eq, gte, lte, ne, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { headers } from "next/headers";
import type { z } from "zod";
import { getDb } from "@/db";
import { dosageRegimens, hospitalStays, medicationPacks, medications, missedDoses, reserveLogs, stockCounts, supplyLogs, visits } from "@/db/schema";
import { checkAccess } from "@/lib/access";
import { fmtDate, wallClock } from "@/lib/meds/dates";
import { intakeAt, isTaking } from "@/lib/meds/format";
import { SLOTS, SLOT_NAME, dailyTotal, momentAt, packBalancesAt, regimenAt, simulate, type Moment, type Slot } from "@/lib/meds/simulate";
import type { ActionResult, ReserveLogKind, ReserveUseReason } from "@/lib/meds/types";
import {
  catalogTagsSchema,
  createMedicationSchema,
  dateSchema,
  idSchema,
  importSchema,
  missedDoseSchema,
  medicationInfoSchema,
  packSchema,
  quantitySchema,
  regimenSchema,
  reserveDrawSchema,
  reserveUseSchema,
  reserveDrawsSchema,
  reserveEntrySchema,
  reserveSchema,
  staySchema,
  supplySchema,
  type CreateMedicationFields,
  type ImportFields,
  type MissedDoseFields,
  type CatalogTagsFields,
  type MedicationInfoFields,
  type PackFields,
  type RegimenFields,
  type ReserveDrawFields,
  type ReserveUseFields,
  type ReserveDrawsFields,
  type ReserveEntryFields,
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

/** Copies the default pack and the packs' total reserve onto the medication row (kept for older code and rollbacks). */
async function syncPacks(tx: Tx, medicationId: number) {
  const packs = await packsOf(tx, medicationId);
  const [first] = packs;
  if (!first) return;
  await tx
    .update(medications)
    .set({ brand: first.brand, packUnit: first.packUnit, perBox: first.perBox, reserve: packs.reduce((n, p) => n + p.reserve, 0) })
    .where(eq(medications.id, medicationId));
}

/** A pack, locked for the change, with its medication. */
async function lockPack(tx: Tx, packId: number) {
  const [row] = await tx.select().from(medicationPacks).where(eq(medicationPacks.id, packId)).for("update");
  if (!row) throw new UserError("这个厂家/包装不存在或已被删除，请刷新后重试");
  return row;
}

type Pack = typeof medicationPacks.$inferSelect;

/** Changes a locked pack's reserve and records why. */
async function changeReserve(
  tx: Tx,
  pack: Pack,
  entry: {
    kind: ReserveLogKind;
    delta: number;
    date: string;
    supplyLogId?: number;
    stockCountId?: number;
    missedDoseId?: number;
    timeOfDay?: Slot | null;
    regular?: boolean;
    slotsDone?: number;
    reason?: ReserveUseReason;
    note?: string | null;
  },
) {
  await tx.update(medicationPacks).set({ reserve: pack.reserve + entry.delta }).where(eq(medicationPacks.id, pack.id));
  await tx.insert(reserveLogs).values({ medicationId: pack.medicationId, packId: pack.id, ...entry });
  await syncPacks(tx, pack.medicationId);
}

/** Takes pills out of a locked pack's reserve into the current stock: one supply of that pack, linked to its log. */
async function draw(tx: Tx, pack: Pack, date: string, quantity: number, source: string) {
  if (pack.reserve < quantity) throw new UserError(`${pack.brand ?? "这个厂家"}的储备只剩 ${pack.reserve} 颗，不够取`);
  const [supply] = await tx
    .insert(supplyLogs)
    .values({ medicationId: pack.medicationId, packId: pack.id, date, quantity, source })
    .returning({ id: supplyLogs.id });
  await changeReserve(tx, pack, { kind: "draw", delta: -quantity, date, supplyLogId: supply.id });
}

async function drawAll(tx: Tx, medicationId: number, date: string, draws: ReserveDrawsFields) {
  for (const { packId, quantity, source } of draws) {
    const pack = await lockPack(tx, packId);
    if (pack.medicationId !== medicationId) throw new UserError("所选厂家/包装不属于这种药，请刷新后重试");
    await draw(tx, pack, date, quantity, source);
  }
}

/** Takes one reserve entry back, with the supply it became or the pills it took out of the stock. */
async function undoReserveLog(tx: Tx, log: typeof reserveLogs.$inferSelect) {
  const pack = await lockPack(tx, log.packId);
  const reserve = pack.reserve - log.delta;
  if (reserve < 0) throw new UserError(`储备现在只有 ${pack.reserve} 颗，不够撤销这条记录`);
  await tx.update(medicationPacks).set({ reserve }).where(eq(medicationPacks.id, pack.id));
  if (log.supplyLogId !== null) await tx.delete(supplyLogs).where(eq(supplyLogs.id, log.supplyLogId));
  await tx.delete(reserveLogs).where(eq(reserveLogs.id, log.id));
  if (log.stockCountId !== null) await giveBackToCount(tx, pack, log.stockCountId, log.delta);
  // A missed dose put into the reserve goes with it: that dose counts as taken again.
  if (log.missedDoseId !== null) await tx.delete(missedDoses).where(eq(missedDoses.id, log.missedDoseId));
  await syncPacks(tx, pack.medicationId);
}

/**
 * Undoes a 当前转入储备 made before withdrawals existed, which wrote the stock left as a count.
 * The pills go back onto that count; the count is then dropped when it says no more than the
 * projection would without it (the transfer made it), so the undo leaves no 盘点 behind. One that
 * still says something — a real count the transfer overwrote, or one another transfer shares — stays.
 */
async function giveBackToCount(tx: Tx, pack: Pack, countId: number, pills: number) {
  const [count] = await tx.select().from(stockCounts).where(eq(stockCounts.id, countId));
  if (!count) return;
  const quantity = count.quantity + pills;
  const shared = await tx.select({ id: reserveLogs.id }).from(reserveLogs).where(eq(reserveLogs.stockCountId, countId));
  if (shared.length === 0) {
    await tx.delete(stockCounts).where(eq(stockCounts.id, countId));
    const at = { date: count.date, slotsDone: count.slotsDone as Moment["slotsDone"] };
    if ((await stockOfPack(tx, pack, at)) === quantity) return;
    const { medicationId, packId, date, slotsDone, createdAt } = count;
    await tx.insert(stockCounts).values({ medicationId, packId, date, slotsDone, createdAt, quantity });
    return;
  }
  await tx.update(stockCounts).set({ quantity }).where(eq(stockCounts.id, countId));
}

/** Only a medication being taken has a current stock to add to; anything else goes to the reserve. */
async function assertTaking(tx: Tx, medicationId: number) {
  const regimens = await tx.select().from(dosageRegimens).where(eq(dosageRegimens.medicationId, medicationId));
  if (!isTaking(intakeAt(regimens, wallClock().date))) {
    throw new UserError("这种药现在没在吃：补的药请放进储备，开始吃时再选要拿多少到当前");
  }
}

/** A medication's stock simulation as the board shows it, with the records it came from. */
async function simulationOf(tx: Tx, medicationId: number, today: string) {
  const order = (await packsOf(tx, medicationId)).map((p) => p.id);
  const supplies = await tx.select().from(supplyLogs).where(eq(supplyLogs.medicationId, medicationId));
  const counts = await tx
    .select()
    .from(stockCounts)
    .where(eq(stockCounts.medicationId, medicationId))
    .orderBy(asc(stockCounts.date), asc(stockCounts.createdAt));
  const regimens = await tx.select().from(dosageRegimens).where(eq(dosageRegimens.medicationId, medicationId));
  const stays = await tx.select().from(hospitalStays);
  const misses = await tx.select().from(missedDoses).where(eq(missedDoses.medicationId, medicationId));
  const logs = await tx.select().from(reserveLogs).where(eq(reserveLogs.medicationId, medicationId));
  const sim = simulate(
    supplies.map((s) => ({ ...s, recordedAt: s.createdAt.getTime() })),
    regimens,
    {
      today,
      packs: order,
      counts: counts.map((c) => ({ ...c, slotsDone: c.slotsDone as Moment["slotsDone"], recordedAt: c.createdAt.getTime() })),
      pauses: stays.map((s) => ({ start: s.startDate, end: s.endDate })),
      skips: [
        ...misses.filter((x) => x.kept === "stock"),
        ...logs.flatMap((l) => (l.regular && l.timeOfDay ? [{ date: l.date, slot: l.timeOfDay, quantity: -l.delta, fromReserve: true }] : [])),
      ],
      withdrawals: logs.flatMap((l) =>
        l.kind === "transfer" && l.stockCountId === null && l.slotsDone !== null
          ? [{ date: l.date, slotsDone: l.slotsDone as Moment["slotsDone"], quantity: l.delta, recordedAt: l.createdAt.getTime(), packId: l.packId }]
          : [],
      ),
    },
  );
  return { sim, order, regimens };
}

/**
 * How much of one scheduled dose is still open: not recorded as missed (漏服) nor as taken from the
 * reserve in its place. Locks the medication, so two records cannot both claim the same pills.
 */
async function openDose(tx: Tx, medicationId: number, date: string, slot: Slot) {
  const [med] = await tx.select({ id: medications.id }).from(medications).where(eq(medications.id, medicationId)).for("update");
  if (!med) throw new UserError("药品不存在或已被删除");
  const { sim, order, regimens } = await simulationOf(tx, medicationId, wallClock().date);
  const at = `${fmtDate(date)} ${SLOT_NAME[slot]}`;
  const day = sim.days.find((d) => d.date === date);
  if (day?.paused) throw new UserError(`${fmtDate(date)}在住院，不吃家里的药`);
  const scheduled = regimenAt(regimens, date)?.[slot] ?? 0;
  if (scheduled <= 0) throw new UserError(`按规律${at}不用吃这种药`);
  const sameDose = and(eq(missedDoses.medicationId, medicationId), eq(missedDoses.date, date), eq(missedDoses.slot, slot));
  const missed = await tx.select({ quantity: missedDoses.quantity }).from(missedDoses).where(sameDose);
  const covered = await tx
    .select({ delta: reserveLogs.delta })
    .from(reserveLogs)
    .where(and(eq(reserveLogs.medicationId, medicationId), eq(reserveLogs.date, date), eq(reserveLogs.timeOfDay, slot), eq(reserveLogs.regular, true)));
  const claimed = missed.reduce((n, x) => n + x.quantity, 0) - covered.reduce((n, l) => n + l.delta, 0);
  /** Refuses more than is open, saying what the dose already has. */
  const assertRoom = (quantity: number) => {
    if (quantity <= scheduled - claimed) return;
    throw new UserError(
      claimed > 0
        ? `按规律${at}吃 ${scheduled} 颗，已经记了 ${claimed} 颗（漏服或吃的储备），最多还能记 ${scheduled - claimed} 颗`
        : `按规律${at}只吃 ${scheduled} 颗`,
    );
  };
  return { sim, order, day, at, assertRoom };
}

/** A pack's current stock, from the same simulation the board shows. */
async function stockOfPack(tx: Tx, pack: Pack, at: Moment) {
  const { sim, order } = await simulationOf(tx, pack.medicationId, at.date);
  return packBalancesAt(sim, at)[order.indexOf(pack.id)] ?? 0;
}

/** Brands compared loosely: "江苏 恩华" is "江苏恩华". */
const brandKey = (b: string | null) => (b ?? "").replace(/\s+/g, "").toLowerCase();

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
    const { initialSupply, initialRegimen, brand, packUnit, perBox, reserve: reserved, ...fields } = parse(createMedicationSchema, input);
    // With nothing to take there is no current stock: the pills go to the reserve.
    const stocked = initialRegimen !== null && dailyTotal(initialRegimen) > 0 ? initialSupply : null;
    const reserve = reserved + (stocked ? 0 : (initialSupply?.quantity ?? 0));
    await getDb().transaction(async (tx) => {
      const [med] = await tx.insert(medications).values({ ...fields, brand, packUnit, perBox, reserve }).returning({ id: medications.id });
      const [pack] = await tx
        .insert(medicationPacks)
        .values({ medicationId: med.id, brand, packUnit, perBox, reserve, position: 0 })
        .returning({ id: medicationPacks.id });
      if (stocked) await tx.insert(supplyLogs).values({ medicationId: med.id, packId: pack.id, ...stocked });
      if (reserve > 0) {
        const date = initialSupply?.date ?? wallClock().date;
        await tx.insert(reserveLogs).values({ medicationId: med.id, packId: pack.id, kind: "restock", delta: reserve, date });
      }
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

/** Tags accepted from the drug catalog, all or none. */
export async function applyCatalogTags(items: CatalogTagsFields): Promise<ActionResult> {
  return run(async () => {
    const list = parse(catalogTagsSchema, items);
    await getDb().transaction(async (tx) => {
      for (const { id, tags } of list) await tx.update(medications).set({ tags }).where(eq(medications.id, id));
    });
  });
}

/* ------------------------------ packs (manufacturers) ------------------------------ */

/** Another manufacturer's / brand's pack of the same pill, with its own stock and reserve. */
export async function addPack(medicationId: number, input: PackFields): Promise<ActionResult> {
  return run(async () => {
    const medId = parse(idSchema, medicationId);
    const fields = parse(packSchema, input);
    await assertMedication(medId);
    await getDb().transaction(async (tx) => {
      const packs = await packsOf(tx, medId);
      if (packs.some((p) => brandKey(p.brand) === brandKey(fields.brand))) {
        throw new UserError(fields.brand ? `已经有“${fields.brand}”这个厂家/品牌` : "已经有一个没写厂家的包装");
      }
      await tx.insert(medicationPacks).values({ medicationId: medId, ...fields, position: await nextPackPosition(tx, medId) });
      await syncPacks(tx, medId);
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
      await syncPacks(tx, row.medicationId);
    });
  });
}

/**
 * Removes a pack, folding it into the default one: supplies bought in it lose the pack (so
 * count as the default's) and its reserve moves over; counts of it alone go. The last one stays.
 */
export async function deletePack(id: number): Promise<ActionResult> {
  return run(async () => {
    const packId = parse(idSchema, id);
    await getDb().transaction(async (tx) => {
      const [row] = await tx.select().from(medicationPacks).where(eq(medicationPacks.id, packId)).for("update");
      if (!row) return;
      const rest = (await packsOf(tx, row.medicationId)).filter((p) => p.id !== packId);
      if (rest.length === 0) throw new UserError("每种药至少保留一个厂家/包装");
      if (row.reserve > 0) {
        await tx
          .update(medicationPacks)
          .set({ reserve: sql`${medicationPacks.reserve} + ${row.reserve}` })
          .where(eq(medicationPacks.id, rest[0].id));
      }
      await tx.update(reserveLogs).set({ packId: rest[0].id }).where(eq(reserveLogs.packId, packId));
      await tx.delete(medicationPacks).where(eq(medicationPacks.id, packId));
      await syncPacks(tx, row.medicationId);
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
      await syncPacks(tx, row.medicationId);
    });
  });
}

/* ------------------------------ reserve (per pack) ------------------------------- */

/** Sets how many pills of a pack are kept aside, as counted; they never enter the stock simulation. */
export async function setReserve(packId: number, reserve: number): Promise<ActionResult> {
  return run(async () => {
    const id = parse(idSchema, packId);
    const value = parse(reserveSchema, reserve);
    await getDb().transaction(async (tx) => {
      const pack = await lockPack(tx, id);
      if (value !== pack.reserve) await changeReserve(tx, pack, { kind: "count", delta: value - pack.reserve, date: wallClock().date });
    });
  });
}

/** 储备补药: pills of a pack bought or set aside on a day, on top of what is there. */
export async function addReserve(packId: number, input: ReserveEntryFields): Promise<ActionResult> {
  return run(async () => {
    const id = parse(idSchema, packId);
    const { date, quantity } = parse(reserveEntrySchema, input);
    if (date > wallClock().date) throw new UserError("补进储备的日期不能晚于今天");
    await getDb().transaction(async (tx) => {
      const pack = await lockPack(tx, id);
      if (pack.reserve + quantity > 100_000) throw new UserError("储备数量过大");
      await changeReserve(tx, pack, { kind: "restock", delta: quantity, date });
    });
  });
}

/** Takes pills of a pack out of the reserve into the current stock of a medication being taken. */
export async function drawFromReserve(packId: number, input: ReserveDrawFields): Promise<ActionResult> {
  return run(async () => {
    const id = parse(idSchema, packId);
    const { date, quantity, source } = parse(reserveDrawSchema, input);
    await getDb().transaction(async (tx) => {
      const pack = await lockPack(tx, id);
      await assertTaking(tx, pack.medicationId);
      await draw(tx, pack, date, quantity, source);
    });
  });
}

/** 消耗储备: pills of a pack that left the reserve straight, and why, 已服用 included (they never enter the current stock). */
export async function recordReserveUse(packId: number, input: ReserveUseFields): Promise<ActionResult> {
  return run(async () => {
    const id = parse(idSchema, packId);
    const { date, quantity, reason, timeOfDay, regular, note } = parse(reserveUseSchema, input);
    if (date > wallClock().date) throw new UserError("消耗日期不能晚于今天");
    await getDb().transaction(async (tx) => {
      // The regimen's dose taken from the reserve: that dose must still be open (medication first, then pack).
      if (regular && timeOfDay) {
        const [owner] = await tx.select({ medicationId: medicationPacks.medicationId }).from(medicationPacks).where(eq(medicationPacks.id, id));
        if (!owner) throw new UserError("这个厂家/包装不存在或已被删除，请刷新后重试");
        (await openDose(tx, owner.medicationId, date, timeOfDay)).assertRoom(quantity);
      }
      const pack = await lockPack(tx, id);
      if (pack.reserve < quantity) throw new UserError(`${pack.brand ?? "这个厂家"}的储备只剩 ${pack.reserve} 颗，不够扣`);
      await changeReserve(tx, pack, { kind: "use", delta: -quantity, date, reason, timeOfDay, regular, note });
    });
  });
}

/** Puts pills of a pack back from the current stock into the reserve: its stock is counted as what stays, as of now. */
export async function transferToReserve(packId: number, quantity: number): Promise<ActionResult> {
  return run(async () => {
    const id = parse(idSchema, packId);
    const amount = parse(quantitySchema, quantity);
    const clock = wallClock();
    const at = momentAt(clock.date, clock.minutes);
    await getDb().transaction(async (tx) => {
      const pack = await lockPack(tx, id);
      const have = await stockOfPack(tx, pack, at);
      if (amount > have) throw new UserError(`当前余量只有 ${have} 颗，不够转入`);
      // One entry that takes the pills out of the stock now: undoing it leaves nothing behind.
      await changeReserve(tx, pack, { kind: "transfer", delta: amount, date: at.date, slotsDone: at.slotsDone });
    });
  });
}

/** Undoes one reserve entry: a draw's pills go back and its supply goes, a transfer's pills return to the stock. */
export async function deleteReserveLog(id: number): Promise<ActionResult> {
  return run(async () => {
    const logId = parse(idSchema, id);
    await getDb().transaction(async (tx) => {
      const [log] = await tx.select().from(reserveLogs).where(eq(reserveLogs.id, logId)).for("update");
      if (log) await undoReserveLog(tx, log);
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
      await assertTaking(tx, medId);
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
      const [drawn] = await tx.select({ id: reserveLogs.id }).from(reserveLogs).where(eq(reserveLogs.supplyLogId, logId));
      if (drawn) throw new UserError("这笔药是从储备取的：要改请删除它（药会退回储备）再重新取用");
      await assertPack(tx, log.medicationId, fields.packId);
      await tx.update(supplyLogs).set(fields).where(eq(supplyLogs.id, logId));
    });
  });
}

/** A supply taken out of the reserve goes back there. */
export async function deleteSupply(id: number): Promise<ActionResult> {
  return run(async () => {
    const logId = parse(idSchema, id);
    await getDb().transaction(async (tx) => {
      const [drawn] = await tx.select().from(reserveLogs).where(eq(reserveLogs.supplyLogId, logId)).for("update");
      if (drawn) await undoReserveLog(tx, drawn);
      else await tx.delete(supplyLogs).where(eq(supplyLogs.id, logId));
    });
  });
}

/* ---------------------------------- missed doses ---------------------------------- */

/**
 * 漏服: (part of) a scheduled dose not taken. Its pills stay in the stock (that dose is not taken
 * from it), go into a pack's reserve (the stock goes down as if taken, the reserve up), or are gone.
 */
export async function recordMissedDose(medicationId: number, input: MissedDoseFields): Promise<ActionResult> {
  return run(async () => {
    const medId = parse(idSchema, medicationId);
    const { date, slot, quantity, kept, packId } = parse(missedDoseSchema, input);
    if (date > wallClock().date) throw new UserError("漏服日期不能晚于今天");
    await getDb().transaction(async (tx) => {
      const { day, order, at, assertRoom } = await openDose(tx, medId, date, slot);
      assertRoom(quantity);
      const [missed] = await tx
        .insert(missedDoses)
        .values({ medicationId: medId, date, slot, quantity, kept })
        .onConflictDoNothing()
        .returning({ id: missedDoses.id });
      if (!missed) throw new UserError(`${at}已经记过漏服：要改请先撤销那条`);
      if (kept !== "reserve") return;
      // Only pills the stock still had then can go into the reserve.
      const taken = day?.slots[SLOTS.indexOf(slot)].taken ?? 0;
      if (taken < quantity) throw new UserError(`按记录${at}当前余量只够扣 ${taken} 颗，放不进 ${quantity} 颗到储备`);
      const pack = await lockPack(tx, packId ?? order[0]);
      if (pack.medicationId !== medId) throw new UserError("所选厂家/包装不属于这种药，请刷新后重试");
      await changeReserve(tx, pack, { kind: "missed", delta: quantity, date, missedDoseId: missed.id });
    });
  });
}

/** Takes a missed dose back: it counts as taken, and pills it put into the reserve come out again. */
export async function deleteMissedDose(id: number): Promise<ActionResult> {
  return run(async () => {
    const missedId = parse(idSchema, id);
    await getDb().transaction(async (tx) => {
      const [log] = await tx.select().from(reserveLogs).where(eq(reserveLogs.missedDoseId, missedId)).for("update");
      if (log) await undoReserveLog(tx, log);
      else await tx.delete(missedDoses).where(eq(missedDoses.id, missedId));
    });
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
 * existing medications (a row per manufacturer), plus new medications.
 *
 * Existing stock is recorded as a count of that manufacturer's pills at `at`, so from then on
 * it is exactly what was counted. A new medication has no history to count against: its stock becomes a supply that
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
          // Each row is one pack (manufacturer) of the medication: its size, stock and reserve.
          const packs = await packsOf(tx, row.id);
          if (packs.length === 0) throw new UserError("有药品已被删除，请刷新后重新录入");
          const pack = { packUnit: row.packUnit, perBox: row.perBox };
          const wanted = row.pack;
          let target = !wanted
            ? packs[0]
            : "id" in wanted
              ? packs.find((p) => p.id === wanted.id)
              : packs.find((p) => brandKey(p.brand) === brandKey(wanted.brand));
          if (!target && wanted && "brand" in wanted) {
            [target] = await tx
              .insert(medicationPacks)
              .values({ medicationId: row.id, brand: wanted.brand, ...pack, position: await nextPackPosition(tx, row.id) })
              .returning();
          }
          if (!target) throw new UserError("有药品的厂家/包装已被删除，请刷新后重新录入");
          if (target.packUnit !== pack.packUnit || target.perBox !== pack.perBox) {
            await tx.update(medicationPacks).set(pack).where(eq(medicationPacks.id, target.id));
          }
          if (row.reserve !== null && row.reserve !== target.reserve) {
            await changeReserve(tx, target, { kind: "count", delta: row.reserve - target.reserve, date: at.date });
          }
          await syncPacks(tx, row.id);
          if (row.regimen) await setRegimen(row.id, row.regimen);
          if (row.stock !== null) {
            await tx
              .insert(stockCounts)
              .values({ medicationId: row.id, packId: target.id, date: at.date, slotsDone: at.slotsDone, quantity: row.stock })
              .onConflictDoUpdate({
                target: [stockCounts.medicationId, stockCounts.date, stockCounts.packId],
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
            .values({ medicationId: med.id, brand, packUnit, perBox, reserve: reserve ?? 0, position: 0 })
            .returning({ id: medicationPacks.id });
          if (reserve) await tx.insert(reserveLogs).values({ medicationId: med.id, packId: newPack.id, kind: "count", delta: reserve, date: at.date });
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

/**
 * Adds a regimen from `effectiveFrom` on; one already set for that same day is overwritten.
 * `draws` are pills to take out of the reserve into the stock that day, chosen when it starts being taken.
 */
export async function saveRegimen(medicationId: number, input: RegimenFields, draws: ReserveDrawsFields = []): Promise<ActionResult> {
  return run(async () => {
    const medId = parse(idSchema, medicationId);
    const { effectiveFrom, morning, noon, evening } = parse(regimenSchema, input);
    const fromReserve = parse(reserveDrawsSchema, draws);
    await assertMedication(medId);
    await getDb().transaction(async (tx) => {
      await tx
        .insert(dosageRegimens)
        .values({ medicationId: medId, effectiveFrom, morning, noon, evening })
        .onConflictDoUpdate({
          target: [dosageRegimens.medicationId, dosageRegimens.effectiveFrom],
          set: { morning, noon, evening },
        });
      await drawAll(tx, medId, effectiveFrom, fromReserve);
    });
  });
}

/** Edits one regimen. Moving it onto a day that already has one replaces that day's regimen. */
export async function updateRegimen(id: number, input: RegimenFields, draws: ReserveDrawsFields = []): Promise<ActionResult> {
  return run(async () => {
    const regimenId = parse(idSchema, id);
    const fields = parse(regimenSchema, input);
    const fromReserve = parse(reserveDrawsSchema, draws);
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
      await drawAll(tx, current.medicationId, fields.effectiveFrom, fromReserve);
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
