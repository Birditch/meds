import { sql } from "drizzle-orm";
import { check, date, index, integer, numeric, pgTable, text, unique } from "drizzle-orm/pg-core";

/** Quantities are 0.5-pill granular: q * 2 must be a whole number. */
const halfStep = (column: string) => sql.raw(`${column} * 2 = trunc(${column} * 2)`);

export const medications = pgTable(
  "medications",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    name: text().notNull(),
    brand: text(),
    dosage: text().notNull(),
    /** How it is packed: 盒 (box) or 瓶 (bottle). */
    packUnit: text({ enum: ["盒", "瓶"] }).notNull().default("盒"),
    /** Pills per box / bottle, to turn a prescription into whole packs. Unknown when null. */
    perBox: numeric({ precision: 7, scale: 1, mode: "number" }),
    /** Extra pills kept at home for emergencies; not part of the stock simulation. */
    reserve: numeric({ precision: 10, scale: 1, mode: "number" }).notNull().default(0),
  },
  (t) => [
    check("medications_pack_unit", sql`${t.packUnit} in ('盒', '瓶')`),
    check("medications_per_box_positive", sql`${t.perBox} > 0`),
    check("medications_per_box_half_step", halfStep("per_box")),
    check("medications_reserve_non_negative", sql`${t.reserve} >= 0`),
    check("medications_reserve_half_step", halfStep("reserve")),
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
  },
  (t) => [
    index("supply_logs_medication_date_idx").on(t.medicationId, t.date),
    check("supply_logs_quantity_positive", sql`${t.quantity} > 0`),
    check("supply_logs_quantity_half_step", halfStep("quantity")),
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
