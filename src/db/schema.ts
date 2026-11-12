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
    /** The packs' reserves added up (medication_packs.reserve), kept for older code and rollbacks. */
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
 * pack, with its own unit and pills per pack, its own stock (from its supplies and counts) and
 * its own reserve. The first (lowest position) is the default: its pills are taken first and it
 * counts the whole packs to get at a visit.
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
    /** Extra pills of this pack kept at home for emergencies; not part of the stock simulation. */
    reserve: numeric({ precision: 10, scale: 1, mode: "number" }).notNull().default(0),
    createdAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("medication_packs_medication_idx").on(t.medicationId, t.position),
    check("medication_packs_pack_unit", sql`${t.packUnit} in ('盒', '瓶')`),
    check("medication_packs_per_box_positive", sql`${t.perBox} > 0`),
    check("medication_packs_per_box_half_step", halfStep("per_box")),
    check("medication_packs_reserve_non_negative", sql`${t.reserve} >= 0`),
    check("medication_packs_reserve_half_step", halfStep("reserve")),
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
    /** Where the pills came from (药品来源), written when they are taken out of the reserve; printed on the lists. */
    source: text(),
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
 * say. Supplies of the same day entered after the count come on top of it. With `packId` it
 * counts that pack's pills only; without, the medication's (all its packs together).
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
    /** The pack counted; null = the whole medication. */
    packId: integer().references(() => medicationPacks.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    // One count per medication (or pack) per day: counting again that day replaces it.
    unique("stock_counts_medication_date_pack_key").on(t.medicationId, t.date, t.packId).nullsNotDistinct(),
    check("stock_counts_slots_done", sql`${t.slotsDone} between 0 and 3`),
    check("stock_counts_quantity_non_negative", sql`${t.quantity} >= 0`),
    check("stock_counts_quantity_half_step", halfStep("quantity")),
  ],
);

/**
 * Every change to a pack's reserve since this table exists: the number itself stays on the pack.
 * `delta` is what the entry did to the reserve, so undoing one takes it back. A draw is linked
 * to the supply it became, a transfer to the stock count that took the pills out of the stock.
 */
export const reserveLogs = pgTable(
  "reserve_logs",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    medicationId: integer()
      .notNull()
      .references(() => medications.id, { onDelete: "cascade" }),
    packId: integer()
      .notNull()
      .references(() => medicationPacks.id, { onDelete: "cascade" }),
    date: date({ mode: "string" }).notNull(),
    /**
     * restock: bought into the reserve; draw: taken into the stock; count: corrected; transfer: moved
     * from the stock; take: taken (eaten) straight from the reserve; use: left the reserve otherwise
     * (never part of the stock); missed: the pills of a dose not taken, put into the reserve.
     */
    kind: text({ enum: ["restock", "draw", "count", "transfer", "take", "use", "missed"] }).notNull(),
    delta: numeric({ precision: 10, scale: 1, mode: "number" }).notNull(),
    supplyLogId: integer().references(() => supplyLogs.id, { onDelete: "set null" }),
    stockCountId: integer().references(() => stockCounts.id, { onDelete: "set null" }),
    missedDoseId: integer().references(() => missedDoses.id, { onDelete: "set null" }),
    /** A take: when in the day (RESERVE_TAKE_TIMES). */
    timeOfDay: text({ enum: ["morning", "noon", "evening", "bedtime"] }),
    /** A use: why the pills left the reserve (RESERVE_USE_REASONS). A take or a use: anything written down. */
    reason: text({ enum: ["carry", "expired", "damaged", "lost", "given", "returned", "other"] }),
    note: text(),
    createdAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("reserve_logs_medication_date_idx").on(t.medicationId, t.date),
    check("reserve_logs_kind", sql`${t.kind} in ('restock', 'draw', 'count', 'transfer', 'take', 'use', 'missed')`),
    check(
      "reserve_logs_reason",
      sql`${t.reason} is null or ${t.reason} in ('carry', 'expired', 'damaged', 'lost', 'given', 'returned', 'other')`,
    ),
    check("reserve_logs_time_of_day", sql`${t.timeOfDay} is null or ${t.timeOfDay} in ('morning', 'noon', 'evening', 'bedtime')`),
    check("reserve_logs_delta_non_zero", sql`${t.delta} <> 0`),
    check("reserve_logs_delta_half_step", halfStep("delta")),
  ],
);

/**
 * 漏服: (part of) a scheduled dose not taken. `kept` says where its pills went: still in the stock
 * (that slot takes `quantity` less), into the reserve (linked from a reserve log of kind "missed"),
 * or gone; in the last two the stock goes down as if the dose was taken.
 */
export const missedDoses = pgTable(
  "missed_doses",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    medicationId: integer()
      .notNull()
      .references(() => medications.id, { onDelete: "cascade" }),
    date: date({ mode: "string" }).notNull(),
    slot: text({ enum: ["morning", "noon", "evening"] }).notNull(),
    quantity: numeric({ precision: 6, scale: 1, mode: "number" }).notNull(),
    kept: text({ enum: ["stock", "reserve", "none"] }).notNull(),
    createdAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("missed_doses_medication_date_slot_key").on(t.medicationId, t.date, t.slot),
    check("missed_doses_slot", sql`${t.slot} in ('morning', 'noon', 'evening')`),
    check("missed_doses_kept", sql`${t.kept} in ('stock', 'reserve', 'none')`),
    check("missed_doses_quantity_positive", sql`${t.quantity} > 0`),
    check("missed_doses_quantity_half_step", halfStep("quantity")),
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
