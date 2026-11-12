import { describe, expect, it } from "vitest";
import { RESERVE_USE_REASONS } from "./types";
import { takeTimeAt } from "./format";
import { missedDoseSchema, reserveDrawSchema, reserveDrawsSchema, reserveTakeSchema, reserveUseSchema } from "./validation";

const message = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0]?.message;

describe("taking pills out of the reserve needs a source", () => {
  const draw = { date: "2026-11-10", quantity: 14 };

  it("keeps the source, trimmed", () => {
    expect(reserveDrawSchema.parse({ ...draw, source: "  从京东大药房购买了一盒 " }).source).toBe("从京东大药房购买了一盒");
  });

  it("refuses a missing or blank one", () => {
    expect(message(reserveDrawSchema.safeParse({ ...draw, source: "   " }))).toBe("请填写药品来源");
    expect(reserveDrawSchema.safeParse(draw).success).toBe(false);
    expect(message(reserveDrawsSchema.safeParse([{ packId: 1, quantity: 14, source: "" }]))).toBe("请填写药品来源");
  });

  it("refuses one too long to print", () => {
    expect(message(reserveDrawSchema.safeParse({ ...draw, source: "药".repeat(201) }))).toBe("药品来源最多 200 个字");
  });
});

describe("taking pills straight from the reserve", () => {
  const take = { date: "2026-11-12", quantity: 1, timeOfDay: "bedtime" };

  it("needs when in the day, takes an optional note", () => {
    expect(reserveTakeSchema.parse(take)).toEqual({ ...take, note: null });
    expect(reserveTakeSchema.parse({ ...take, note: " 睡不着 " }).note).toBe("睡不着");
    expect(message(reserveTakeSchema.safeParse({ ...take, timeOfDay: undefined }))).toBe("请选择什么时候吃的");
    expect(message(reserveTakeSchema.safeParse({ ...take, quantity: 0 }))).toBe("数量必须大于 0");
  });

  it("guesses the time of day from the clock", () => {
    expect([7 * 60, 11 * 60, 15 * 60 + 59, 18 * 60, 21 * 60, 23 * 60 + 59].map(takeTimeAt)).toEqual([
      "morning",
      "noon",
      "noon",
      "evening",
      "bedtime",
      "bedtime",
    ]);
  });
});

describe("using pills up straight from the reserve", () => {
  const use = { date: "2026-11-10", quantity: 2, reason: "expired" };

  it("needs a reason from the list", () => {
    expect(message(reserveUseSchema.safeParse({ date: use.date, quantity: 2 }))).toBe("请选择消耗原因");
    expect(message(reserveUseSchema.safeParse({ ...use, reason: "eaten" }))).toBe("请选择消耗原因");
    // Taking pills is 服用, not a reason to use them up.
    expect(message(reserveUseSchema.safeParse({ ...use, reason: "extra" }))).toBe("请选择消耗原因");
    for (const reason of RESERVE_USE_REASONS.filter((r) => r !== "other")) expect(reserveUseSchema.safeParse({ ...use, reason }).success).toBe(true);
  });

  it("needs a note for 其他", () => {
    expect(message(reserveUseSchema.safeParse({ ...use, reason: "other" }))).toBe("选了“其他”，请在备注里写明原因");
    expect(message(reserveUseSchema.safeParse({ ...use, reason: "other", note: "  " }))).toBe("选了“其他”，请在备注里写明原因");
    expect(reserveUseSchema.parse({ ...use, reason: "other", note: "送去做药检" }).note).toBe("送去做药检");
  });

  it("takes an optional note, trimmed, blank meaning none", () => {
    expect(reserveUseSchema.parse({ ...use, note: "  出差带走 " }).note).toBe("出差带走");
    expect(reserveUseSchema.parse({ ...use, note: "   " }).note).toBeNull();
    expect(reserveUseSchema.parse(use).note).toBeNull();
    // What the form sends after parsing is accepted again by the action.
    expect(reserveUseSchema.parse(reserveUseSchema.parse(use))).toEqual({ ...use, note: null });
  });

  it("is written as a positive amount, half pills allowed", () => {
    expect(reserveUseSchema.parse({ ...use, quantity: 0.5 }).quantity).toBe(0.5);
    expect(message(reserveUseSchema.safeParse({ ...use, quantity: -2 }))).toBe("数量必须大于 0");
    expect(message(reserveUseSchema.safeParse({ ...use, note: "药".repeat(201) }))).toBe("备注最多 200 个字");
  });
});

describe("a missed dose", () => {
  const missed = { date: "2026-11-10", slot: "evening", quantity: 1, kept: "stock" };

  it("names the slot and where the pills went", () => {
    expect(missedDoseSchema.parse(missed)).toEqual({ ...missed, packId: null });
    expect(missedDoseSchema.parse({ ...missed, kept: "reserve", packId: 3 }).packId).toBe(3);
    expect(message(missedDoseSchema.safeParse({ ...missed, slot: "night" }))).toBe("请选择哪一顿没吃");
    expect(message(missedDoseSchema.safeParse({ ...missed, kept: undefined }))).toBe("请选择没吃的药放到哪里");
  });

  it("is a positive amount in half pills", () => {
    expect(message(missedDoseSchema.safeParse({ ...missed, quantity: 0 }))).toBe("数量必须大于 0");
    expect(message(missedDoseSchema.safeParse({ ...missed, quantity: 0.3 }))).toBe("数量只能是整数或 0.5 的倍数");
  });
});
