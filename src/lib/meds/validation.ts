import { z } from "zod";
import { isValidISODate } from "./dates";
import { normalizeTags } from "./tags";
import { PACK_UNITS } from "./types";

const isHalfStep = (n: number) => Number.isInteger(n * 2);

export const dateSchema = z
  .string()
  .refine(isValidISODate, "日期无效")
  .refine((d) => d >= "2000-01-01" && d <= "2100-12-31", "日期超出范围");

export const quantitySchema = z
  .number({ error: "请输入数量" })
  .finite()
  .positive("数量必须大于 0")
  .max(100_000, "数量过大")
  .refine(isHalfStep, "数量只能是整数或 0.5 的倍数");

export const reserveSchema = z
  .number({ error: "请输入数量" })
  .finite()
  .min(0, "数量不能为负")
  .max(100_000, "数量过大")
  .refine(isHalfStep, "数量只能是整数或 0.5 的倍数");

export const doseSchema = z
  .number({ error: "请输入颗数" })
  .finite()
  .min(0, "颗数不能为负")
  .max(100, "单次颗数过大")
  .refine(isHalfStep, "颗数只能是整数或 0.5 的倍数");

const text = (label: string, max = 100) => z.string().trim().max(max, `${label}最多 ${max} 个字`);

export const perBoxSchema = z
  .number({ error: "请输入每盒/瓶颗数" })
  .finite()
  .positive("每盒/瓶颗数必须大于 0")
  .max(10_000, "每盒/瓶颗数过大")
  .refine(isHalfStep, "每盒/瓶颗数只能是整数或 0.5 的倍数")
  .nullable();

export const tagsSchema = z
  .array(z.string().max(40, "标签太长"))
  .max(30, "标签太多")
  .transform((tags) => normalizeTags(tags));

/** One manufacturer's / brand's pack of a medication. */
export const packSchema = z.object({
  brand: text("厂家/品牌").transform((v) => v || null),
  packUnit: z.enum(PACK_UNITS).default("盒"),
  perBox: perBoxSchema.default(null),
});

/** A medication with its default pack (brand / packUnit / perBox). */
export const medicationSchema = packSchema.extend({
  name: text("药品名称").min(1, "请填写药品名称"),
  dosage: text("含量/规格").min(1, "请填写含量/规格"),
  tags: tagsSchema.default([]),
});

/** What the edit form changes: the packs are edited one by one. */
export const medicationInfoSchema = z.object({
  name: text("药品名称").min(1, "请填写药品名称"),
  dosage: text("含量/规格").min(1, "请填写含量/规格"),
  tags: tagsSchema.default([]),
});

export const supplySchema = z.object({
  date: dateSchema,
  quantity: quantitySchema,
  /** Which pack was bought; null = not recorded. */
  packId: z.number().int().positive().nullable().default(null),
});

export const regimenSchema = z.object({
  effectiveFrom: dateSchema,
  morning: doseSchema,
  noon: doseSchema,
  evening: doseSchema,
});

export const createMedicationSchema = medicationSchema.extend({
  reserve: reserveSchema.default(0),
  initialSupply: supplySchema.omit({ packId: true }).nullable(),
  initialRegimen: regimenSchema.nullable(),
});

export const staySchema = z
  .object({ startDate: dateSchema, endDate: dateSchema })
  .refine((s) => s.endDate >= s.startDate, "出院日期不能早于入院日期");

export const drawSchema = z.object({ date: dateSchema, quantity: quantitySchema });

export const idSchema = z.number().int().positive();

const slotsDoneSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)], { error: "清点时间无效" });
const dosesSchema = z.object({ morning: doseSchema, noon: doseSchema, evening: doseSchema });
const countedSchema = reserveSchema.nullable();

/**
 * One-click import. `stock` / `reserve` null = leave unchanged; `regimen` null = keep the
 * current one. Stock is counted at `at`: after `slotsDone` of that day's doses. An existing
 * medication's row is about one of its packs (manufacturers): stock and reserve are that pack's.
 */
export const importSchema = z
  .object({
    at: z.object({ date: dateSchema, slotsDone: slotsDoneSchema }),
    rows: z
      .array(
        z.discriminatedUnion("kind", [
          z.object({
            kind: z.literal("existing"),
            id: idSchema,
            /** The pack the line is about (its unit / pills per pack are set), or a new one by brand. */
            pack: z.union([z.object({ id: idSchema }), z.object({ brand: text("厂家/品牌").min(1, "请填写厂家/品牌") })]).nullable().default(null),
            packUnit: z.enum(PACK_UNITS),
            perBox: perBoxSchema,
            stock: countedSchema,
            reserve: countedSchema,
            regimen: dosesSchema.nullable(),
          }),
          medicationSchema.extend({
            kind: z.literal("new"),
            stock: countedSchema,
            reserve: countedSchema,
            regimen: dosesSchema.nullable(),
          }),
        ]),
      )
      .min(1, "没有要录入的内容")
      .max(300, "一次最多录入 300 种药"),
  })
  .refine((v) => {
    const keys = v.rows.flatMap((r) =>
      r.kind === "existing" ? [`${r.id}|${!r.pack ? "" : "id" in r.pack ? r.pack.id : r.pack.brand.replace(/\s+/g, "").toLowerCase()}`] : [],
    );
    return new Set(keys).size === keys.length;
  }, "同一种药的同一个厂家出现了两次");

export type MedicationFields = z.input<typeof medicationSchema>;
export type MedicationInfoFields = z.input<typeof medicationInfoSchema>;
export type PackFields = z.input<typeof packSchema>;
export type SupplyFields = z.input<typeof supplySchema>;
export type RegimenFields = z.infer<typeof regimenSchema>;
export type StayFields = z.infer<typeof staySchema>;
export type DrawFields = z.infer<typeof drawSchema>;
export type CreateMedicationFields = z.input<typeof createMedicationSchema>;
export type ImportFields = z.input<typeof importSchema>;
