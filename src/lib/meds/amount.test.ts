import { describe, expect, it } from "vitest";
import { amountIsEmpty, amountState, resolveAmount } from "./amount";

describe("amountIsEmpty: an optional amount left alone", () => {
  it("is empty in the box form even though the box form alone asks for a number", () => {
    const untouched = amountState("", 20);
    expect(untouched.mode).toBe("boxes");
    expect(resolveAmount(untouched)).toEqual({ error: "请填写盒数" });
    expect(amountIsEmpty(untouched)).toBe(true);
  });

  it("is empty with nothing but spaces typed as pills", () => {
    expect(amountIsEmpty(amountState("  "))).toBe(true);
  });

  it("is not empty once anything is typed", () => {
    expect(amountIsEmpty({ ...amountState("", 20), boxes: "1" })).toBe(false);
    expect(amountIsEmpty({ ...amountState("", 20), loose: "3.5" })).toBe(false);
    expect(amountIsEmpty(amountState("7.5"))).toBe(false);
  });
});
