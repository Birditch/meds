import { describe, expect, it } from "vitest";
import { intakeAt, intakeLabel, isTaking } from "./format";

const reg = (effectiveFrom: string, morning: number, noon: number, evening: number) => ({ effectiveFrom, morning, noon, evening });
const TODAY = "2026-11-07";

describe("intake: 在吃 / 未在吃", () => {
  it("is taken while today's regimen has doses", () => {
    expect(intakeAt([reg("2026-11-01", 1, 0, 1)], TODAY)).toEqual({ kind: "taking" });
    // A stop that comes later does not matter yet.
    expect(intakeAt([reg("2026-11-01", 1, 0, 1), reg("2026-11-20", 0, 0, 0)], TODAY)).toEqual({ kind: "taking" });
  });

  it("counts a regimen that starts later as taken", () => {
    const later = intakeAt([reg("2026-11-20", 0, 0, 1)], TODAY);
    expect(later).toEqual({ kind: "starting", from: "2026-11-20" });
    expect(isTaking(later)).toBe(true);
    expect(intakeLabel(later)).toBe("2026.11.20 周五 起服用");
    // Stopped now, resumed later.
    expect(intakeAt([reg("2026-10-01", 1, 0, 0), reg("2026-11-01", 0, 0, 0), reg("2026-12-01", 1, 0, 0)], TODAY)).toEqual({
      kind: "starting",
      from: "2026-12-01",
    });
  });

  it("is not taken when stopped or never set", () => {
    const stopped = intakeAt([reg("2026-10-01", 1, 0, 0), reg("2026-11-01", 0, 0, 0)], TODAY);
    expect(stopped).toEqual({ kind: "stopped", since: "2026-11-01" });
    expect(isTaking(stopped)).toBe(false);
    expect(intakeLabel(stopped)).toBe("已停药");
    expect(intakeAt([], TODAY)).toEqual({ kind: "unset" });
    expect(intakeAt([reg("2026-12-01", 0, 0, 0)], TODAY)).toEqual({ kind: "unset" });
    expect(isTaking({ kind: "unset" })).toBe(false);
  });
});
