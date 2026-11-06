import { sql } from "drizzle-orm";
import { check, date, index, integer, numeric, pgTable, text, unique } from "drizzle-orm/pg-core";

/** Quantities are 0.5-pill granular: q * 2 must be a whole number. */
const halfStep = (column: string) => sql.raw(`${column} * 2 = trunc(${column} * 2)`);

export const medications = pgTable("medications", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: text().notNull(),
  brand: text(),
  dosage: text().notNull(),
});

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
