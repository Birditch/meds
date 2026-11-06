import { sql } from "drizzle-orm";
import { check, date, index, integer, numeric, pgTable, smallint, text, timestamp, unique } from "drizzle-orm/pg-core";

/** Quantities are 0.5-pill granular: q * 2 must be a whole number. */
const halfStep = (column: string) => sql.raw(`${column} * 2 = trunc(${column} * 2)`);

export const medications = pgTable(
  "medications",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    name: text().notNull(),
    /** brand / packUnit / perBox mirror the default pack (medication_packs, position 0). */
    brand: text(),
    dosage: text().notNull(),
    /** How it is packed: 盒 (box) or 瓶 (bottle). */
    packUnit: text({ enum: ["盒", "瓶"] }).notNull().default("盒"),
    /** Pills per box / bottle, to turn a prescription into whole packs. Unknown when null. */
    perBox: numeric({ precision: 7, scale: 1, mode: "number" }),
    /** Extra pills kept at home for emergencies; not part of the stock simulation. */
    reserve: numeric({ precision: 10, scale: 1, mode: "number" }).notNull().default(0),
    /** Tags: codes from src/lib/meds/tags.ts (精二, 处方药, 医保乙类…) or the user's own words. */
    tags: text().array().notNull().default(sql`'{}'::text[]`),
  },
  (t) => [
    check("medications_pack_unit", sql`${t.packUnit} in ('盒', '瓶')`),
    check("medications_per_box_positive", sql`${t.perBox} > 0`),
    check("medications_per_box_half_step", halfStep("per_box")),
    check("medications_reserve_non_negative", sql`${t.reserve} >= 0`),
    check("medications_reserve_half_step", halfStep("reserve")),
  ],
);

/**
 * The ways one medication (one pill: name + strength) comes: each manufacturer's or brand's
 * pack, with its own unit and pills per pack. They share the medication's stock. The first
 * (lowest position) is the default, used to count whole packs for a visit.
 */
export const medicationPacks = pgTable(
  "medication_packs",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    medicationId: integer()
      .notNull()
      .references(() => medications.id, { onDelete: "cascade" }),
    /** Manufacturer or brand (厂家 / 品牌); null when not known. */
    brand: text(),
    packUnit: text({ enum: ["盒", "瓶"] }).notNull().default("盒"),
    perBox: numeric({ precision: 7, scale: 1, mode: "number" }),
    position: smallint().notNull().default(0),
    createdAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("medication_packs_medication_idx").on(t.medicationId, t.position),
    check("medication_packs_pack_unit", sql`${t.packUnit} in ('盒', '瓶')`),
    check("medication_packs_per_box_positive", sql`${t.perBox} > 0`),
    check("medication_packs_per_box_half_step", halfStep("per_box")),
  ],
);

export const supplyLogs = pgTable(
  "supply_logs",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    medicationId: integer()
      .notNull()
      .references(() => medications.id, { onDelete: "cascade" }),
    date: date({ mode: "string" }).notNull(),
    quantity: numeric({ precision: 10, scale: 1, mode: "number" }).notNull(),
    /** The pack bought (which manufacturer), when known. */
    packId: integer().references(() => medicationPacks.id, { onDelete: "set null" }),
    /** When the entry was made: orders it against a stock count on the same day. */
    createdAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("supply_logs_medication_date_idx").on(t.medicationId, t.date),
    check("supply_logs_quantity_positive", sql`${t.quantity} > 0`),
    check("supply_logs_quantity_half_step", halfStep("quantity")),
  ],
);

/**
 * A stock count: the pills actually at home at one moment of a day, after `slotsDone` (0–3)
 * of that day's doses. From then on the stock is that number, whatever the records before it
 * say. Supplies of the same day entered after the count come on top of it.
 */
export const stockCounts = pgTable(
  "stock_counts",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    medicationId: integer()
      .notNull()
      .references(() => medications.id, { onDelete: "cascade" }),
    date: date({ mode: "string" }).notNull(),
    slotsDone: smallint().notNull(),
    quantity: numeric({ precision: 10, scale: 1, mode: "number" }).notNull(),
    createdAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    // One count per medication per day: counting again that day replaces it.
    unique("stock_counts_medication_date_key").on(t.medicationId, t.date),
    check("stock_counts_slots_done", sql`${t.slotsDone} between 0 and 3`),
    check("stock_counts_quantity_non_negative", sql`${t.quantity} >= 0`),
    check("stock_counts_quantity_half_step", halfStep("quantity")),
  ],
);

export const dosageRegimens = pgTable(
  "dosage_regimens",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    medicationId: integer()
      .notNull()
      .references(() => medications.id, { onDelete: "cascade" }),
    effectiveFrom: date({ mode: "string" }).notNull(),
    morning: numeric({ precision: 6, scale: 1, mode: "number" }).notNull().default(0),
    noon: numeric({ precision: 6, scale: 1, mode: "number" }).notNull().default(0),
    evening: numeric({ precision: 6, scale: 1, mode: "number" }).notNull().default(0),
  },
  (t) => [
    // One regimen per medication per day: setting it again overwrites that day.
    unique("dosage_regimens_medication_effective_from_key").on(t.medicationId, t.effectiveFrom),
    check("dosage_regimens_non_negative", sql`${t.morning} >= 0 and ${t.noon} >= 0 and ${t.evening} >= 0`),
    check(
      "dosage_regimens_half_step",
      sql`${halfStep("morning")} and ${halfStep("noon")} and ${halfStep("evening")}`,
    ),
  ],
);

/** Upcoming doctor visits, shared by all medications. Only the date matters. */
export const visits = pgTable("visits", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  date: date({ mode: "string" }).notNull().unique("visits_date_key"),
});

/** Hospital stays, start and end day included: no medication is taken from home stock. */
export const hospitalStays = pgTable(
  "hospital_stays",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    startDate: date({ mode: "string" }).notNull(),
    endDate: date({ mode: "string" }).notNull(),
  },
  (t) => [check("hospital_stays_order", sql`${t.endDate} >= ${t.startDate}`)],
);
