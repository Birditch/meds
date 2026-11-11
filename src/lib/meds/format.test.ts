import { describe, expect, it } from "vitest";
import { hasRecords, intakeAt, intakeLabel, isTaking, medicationStatus, startsTaking } from "./format";

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

describe("startsTaking: the moment to offer pills from the reserve", () => {
  const stored = (id: number, ...r: Parameters<typeof reg>) => ({ id, ...reg(...r) });
  const stop = stored(2, "2026-11-01", 0, 0, 0);

  it("is true when a medication not being taken gets doses", () => {
    expect(startsTaking([], reg("2026-11-07", 1, 0, 1), TODAY)).toBe(true);
    expect(startsTaking([stored(1, "2026-10-01", 1, 0, 0), stop], reg("2026-11-07", 0, 0, 1), TODAY)).toBe(true);
    // Starting later still puts it on the list.
    expect(startsTaking([], reg("2026-11-20", 1, 0, 0), TODAY)).toBe(true);
  });

  it("is false while it stays off the list", () => {
    expect(startsTaking([], reg("2026-11-07", 0, 0, 0), TODAY)).toBe(false);
    expect(startsTaking([stop], reg("2026-11-07", 0, 0, 0), TODAY)).toBe(false);
  });

  it("is false for a medication already being taken", () => {
    expect(startsTaking([stored(1, "2026-10-01", 1, 0, 0)], reg("2026-11-07", 2, 0, 0), TODAY)).toBe(false);
  });

  it("reads an edit or a same-day overwrite as replacing that regimen", () => {
    expect(startsTaking([stop], reg("2026-11-01", 1, 0, 0), TODAY, stop.id)).toBe(true);
    expect(startsTaking([stop], reg("2026-11-01", 1, 0, 0), TODAY)).toBe(true);
  });
});

describe("hasRecords: whether 能吃到 is shown", () => {
  const now = { date: TODAY, slotsDone: 0 as const };

  it("is false with nothing recorded, e.g. a medication kept only in the reserve", () => {
    const s = medicationStatus([], [], now);
    expect(s.conclusion.badge).toBe("暂无记录");
    expect(hasRecords(s)).toBe(false);
  });

  it("is true once there is a supply, a regimen or a count", () => {
    expect(hasRecords(medicationStatus([{ date: TODAY, quantity: 10 }], [], now))).toBe(true);
    expect(hasRecords(medicationStatus([], [reg("2026-11-01", 1, 0, 0)], now))).toBe(true);
    expect(hasRecords(medicationStatus([], [], now, [], { counts: [{ date: TODAY, slotsDone: 0, quantity: 5 }] }))).toBe(true);
  });
});
