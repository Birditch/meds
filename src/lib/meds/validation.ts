import { z } from "zod";
import { isValidISODate } from "./dates";
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

export const medicationSchema = z.object({
  name: text("药品名称").min(1, "请填写药品名称"),
  brand: text("品牌").transform((v) => v || null),
  dosage: text("含量/规格").min(1, "请填写含量/规格"),
  packUnit: z.enum(PACK_UNITS).default("盒"),
  perBox: perBoxSchema.default(null),
});

export const supplySchema = z.object({ date: dateSchema, quantity: quantitySchema });

export const regimenSchema = z.object({
  effectiveFrom: dateSchema,
  morning: doseSchema,
  noon: doseSchema,
  evening: doseSchema,
});

export const createMedicationSchema = medicationSchema.extend({
  reserve: reserveSchema.default(0),
  initialSupply: supplySchema.nullable(),
  initialRegimen: regimenSchema.nullable(),
});

export const staySchema = z
  .object({ startDate: dateSchema, endDate: dateSchema })
  .refine((s) => s.endDate >= s.startDate, "出院日期不能早于入院日期");

export const drawSchema = z.object({ date: dateSchema, quantity: quantitySchema });

export const idSchema = z.number().int().positive();

export type MedicationFields = z.input<typeof medicationSchema>;
export type SupplyFields = z.infer<typeof supplySchema>;
export type RegimenFields = z.infer<typeof regimenSchema>;
export type StayFields = z.infer<typeof staySchema>;
export type DrawFields = z.infer<typeof drawSchema>;
export type CreateMedicationFields = z.input<typeof createMedicationSchema>;
