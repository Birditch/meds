import { describe, expect, it } from "vitest";
import { reserveDrawSchema, reserveDrawsSchema } from "./validation";

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
