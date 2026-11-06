import { describe, expect, it } from "vitest";
import { amountState, resolveAmount } from "./amount";
import { wallClock } from "./dates";
import { conclude, fmtQty, formatRegimen } from "./format";
import {
  balanceAt,
  dosesLeft,
  isExhaustedAt,
  momentAt,
  nextShortfall,
  regimenAt,
  simulate,
  type RegimenInput,
  type SupplyInput,
} from "./simulate";

const reg = (effectiveFrom: string, morning: number, noon: number, evening: number): RegimenInput => ({
  effectiveFrom,
  morning,
  noon,
  evening,
});
const sup = (date: string, quantity: number): SupplyInput => ({ date, quantity });
const day = (sim: ReturnType<typeof simulate>, date: string) => sim.days.find((d) => d.date === date)!;

describe("simulate", () => {
  it("returns empty without records", () => {
    expect(simulate([], []).outcome).toEqual({ kind: "empty" });
  });

  it("never applies a regimen before its effective date (the spec example)", () => {
    const sim = simulate(
      [sup("2026-11-06", 100), sup("2026-12-06", 100)],
      [reg("2026-11-06", 1, 0, 1), reg("2026-12-01", 1, 1, 2)],
    );
    // 11-06..11-30: 25 days x 2 = 50 → 50 left.
    expect(day(sim, "2026-11-30").endOfDayBalance).toBe(50);
    expect(day(sim, "2026-11-30").taken).toBe(2);
    // 12-01..12-05: 5 days x 4 = 20 → 30 left.
    expect(day(sim, "2026-12-01").regimenChanged).toBe(true);
    expect(day(sim, "2026-12-01").taken).toBe(4);
    expect(day(sim, "2026-12-05").endOfDayBalance).toBe(30);
    // 12-06: +100 before the morning dose → 130 - 4 = 126.
    expect(day(sim, "2026-12-06").startBalance).toBe(130);
    expect(day(sim, "2026-12-06").endOfDayBalance).toBe(126);
    // 32 full days (12-06..01-06) eat 128 → 2 left; 01-07: 早 1, 中 1, then 晚 has nothing.
    expect(day(sim, "2027-01-06").endOfDayBalance).toBe(2);
    const last = day(sim, "2027-01-07");
    expect(last.slots.map((s) => s.status)).toEqual(["full", "full", "missed"]);
    expect(sim.outcome).toEqual({
      kind: "depleted",
      lastFull: { date: "2027-01-07", slot: "noon", remainingAfter: 0 },
      partial: null,
    });
    expect(sim.days.at(-1)!.date).toBe("2027-01-07");
    expect(conclude(sim, momentAt("2026-11-06", 0)).headline).toBe("能吃到：2027年01月07日 · 中");
  });

  it("records a partial last dose and the last full one before it", () => {
    // 早1 中1 晚2 with 7 pills: day 1 eats 4 (3 left), day 2: 早→2, 中→1, 晚 needs 2 but only 1.
    const sim = simulate([sup("2026-11-06", 7)], [reg("2026-11-06", 1, 1, 2)]);
    expect(sim.outcome).toEqual({
      kind: "depleted",
      lastFull: { date: "2026-11-07", slot: "noon", remainingAfter: 1 },
      partial: { date: "2026-11-07", slot: "evening", partialRemaining: 1, required: 2 },
    });
    expect(day(sim, "2026-11-07").slots[2]).toEqual({ slot: "evening", required: 2, taken: 1, after: 0, status: "partial" });
    expect(conclude(sim, momentAt("2026-11-06", 0)).headline).toBe(
      "能吃到 2026-11-07 晚（仅余 1/2 颗，最后完整一顿为当日中）",
    );
  });

  it("names the day of the last full dose when it is not the partial day", () => {
    // 晚 2 only, 3 pills: day 1 晚 full (1 left), day 2 晚 partial 1/2.
    const sim = simulate([sup("2026-11-06", 3)], [reg("2026-11-06", 0, 0, 2)]);
    expect(conclude(sim, momentAt("2026-11-06", 0)).headline).toBe(
      "能吃到 2026-11-07 晚（仅余 1/2 颗，最后完整一顿为 2026-11-06 晚）",
    );
  });

  it("keeps the balance at 0 through a historical gap and resumes on resupply", () => {
    const sim = simulate([sup("2026-11-01", 2), sup("2026-11-04", 4)], [reg("2026-11-01", 1, 0, 1)]);
    expect(day(sim, "2026-11-01").endOfDayBalance).toBe(0);
    expect(day(sim, "2026-11-02").slots.map((s) => s.status)).toEqual(["missed", "none", "missed"]);
    expect(day(sim, "2026-11-03").endOfDayBalance).toBe(0);
    expect(sim.days.every((d) => d.endOfDayBalance >= 0 && d.slots.every((s) => s.after >= 0))).toBe(true);
    expect(day(sim, "2026-11-04").startBalance).toBe(4);
    expect(sim.outcome).toMatchObject({ kind: "depleted", lastFull: { date: "2026-11-05", slot: "evening" } });
    // The gap is in the past relative to 11-04, so nothing is flagged from then on.
    expect(nextShortfall(sim, momentAt("2026-11-04", 0))).toBeNull();
    // Seen from 11-01 evening, the gap starts the next morning and ends with the 11-04 refill.
    expect(nextShortfall(sim, momentAt("2026-11-01", 20 * 60))).toEqual({
      date: "2026-11-02",
      slot: "morning",
      status: "missed",
      resumesOn: "2026-11-04",
    });
  });

  it("stops at the last record when the latest regimen is all zeros", () => {
    const sim = simulate([sup("2026-11-01", 30)], [reg("2026-11-01", 1, 0, 1), reg("2026-11-06", 0, 0, 0)]);
    expect(sim.outcome).toEqual({ kind: "stopped", reason: "zero-dose", balance: 20, since: "2026-11-06" });
    expect(sim.days.at(-1)!.date).toBe("2026-11-06");
    expect(conclude(sim, momentAt("2026-11-06", 600)).headline).toBe("已停药（当前剩余 20 颗）");
    // Seen before the stop date, it is announced rather than reported as done.
    expect(conclude(sim, momentAt("2026-11-03", 600)).headline).toBe("2026-11-06 起停药（届时剩余 20 颗）");
  });

  it("reports supplies without any regimen as not-yet-scheduled", () => {
    const sim = simulate([sup("2026-11-01", 30)], []);
    expect(sim.outcome).toEqual({ kind: "stopped", reason: "no-regimen", balance: 30, since: null });
  });

  it("extends the timeline through today", () => {
    const sim = simulate([sup("2026-10-01", 10)], [reg("2026-10-01", 0, 0, 0)], { today: "2026-11-06" });
    expect(sim.days.at(-1)!.date).toBe("2026-11-06");
    expect(sim.outcome).toEqual({ kind: "stopped", reason: "zero-dose", balance: 10, since: "2026-10-01" });
  });

  it("supports half pills exactly", () => {
    const sim = simulate([sup("2026-11-01", 2.5)], [reg("2026-11-01", 0.5, 0, 0.5)]);
    // 2.5 / 1 per day → 2 days full, day 3: 早 0.5 → 0, 晚 missed.
    expect(sim.outcome).toEqual({
      kind: "depleted",
      lastFull: { date: "2026-11-03", slot: "morning", remainingAfter: 0 },
      partial: null,
    });
  });

  it("applies a future regimen only from its date", () => {
    const sim = simulate([sup("2026-11-01", 100)], [reg("2026-11-01", 1, 0, 0), reg("2026-11-11", 2, 0, 0)]);
    expect(day(sim, "2026-11-10").endOfDayBalance).toBe(90);
    expect(day(sim, "2026-11-11").endOfDayBalance).toBe(88);
    expect(sim.outcome).toMatchObject({ kind: "depleted", lastFull: { date: "2026-12-25", slot: "morning" } });
  });

  it("caps runaway projections at 10 years", () => {
    const sim = simulate([sup("2026-11-01", 100000)], [reg("2026-11-01", 0.5, 0, 0)]);
    expect(sim.outcome.kind).toBe("capped");
    expect(sim.days.length).toBeLessThan(3700);
  });

  it("ignores supplies dated before the first regimen for dosing but counts them in stock", () => {
    const sim = simulate([sup("2026-11-01", 10)], [reg("2026-11-05", 1, 0, 0)]);
    expect(day(sim, "2026-11-04").endOfDayBalance).toBe(10);
    expect(day(sim, "2026-11-04").regimen).toBeNull();
    expect(sim.outcome).toMatchObject({ kind: "depleted", lastFull: { date: "2026-11-14", slot: "morning" } });
  });
});

describe("reading the simulation at a moment", () => {
  const sim = simulate([sup("2026-11-06", 10)], [reg("2026-11-06", 1, 1, 1)]);

  it("maps the clock to finished slots", () => {
    expect(momentAt("2026-11-06", 7 * 60 + 59).slotsDone).toBe(0);
    expect(momentAt("2026-11-06", 8 * 60).slotsDone).toBe(1);
    expect(momentAt("2026-11-06", 12 * 60).slotsDone).toBe(2);
    expect(momentAt("2026-11-06", 23 * 60).slotsDone).toBe(3);
  });

  it("gives the balance after the slots already taken", () => {
    expect(balanceAt(sim, { date: "2026-11-05", slotsDone: 3 })).toBe(0);
    expect(balanceAt(sim, { date: "2026-11-06", slotsDone: 0 })).toBe(10);
    expect(balanceAt(sim, { date: "2026-11-06", slotsDone: 2 })).toBe(8);
    expect(balanceAt(sim, { date: "2030-01-01", slotsDone: 0 })).toBe(0);
  });

  it("counts remaining doses and detects run-out", () => {
    // 10 pills at 3/day: 11-06..11-08 full (9), 11-09 早 → last.
    expect(dosesLeft(sim, { date: "2026-11-06", slotsDone: 0 })).toBe(10);
    expect(dosesLeft(sim, { date: "2026-11-08", slotsDone: 3 })).toBe(1);
    expect(isExhaustedAt(sim, { date: "2026-11-09", slotsDone: 0 })).toBe(false);
    expect(isExhaustedAt(sim, { date: "2026-11-09", slotsDone: 1 })).toBe(true);
    expect(conclude(sim, { date: "2026-11-06", slotsDone: 0 })).toMatchObject({
      badge: "2026-11-09 早",
      tone: "warn",
      detail: "距今 3 天，还剩 10 顿",
    });
    expect(conclude(sim, { date: "2026-11-07", slotsDone: 0 }).tone).toBe("danger");
    expect(conclude(sim, { date: "2026-11-09", slotsDone: 1 })).toMatchObject({ tone: "danger", detail: "今天已吃完" });
  });

  it("warns amber within a week", () => {
    const s = simulate([sup("2026-11-06", 7)], [reg("2026-11-06", 1, 0, 0)]);
    expect(conclude(s, { date: "2026-11-06", slotsDone: 0 }).tone).toBe("warn");
    const far = simulate([sup("2026-11-06", 30)], [reg("2026-11-06", 1, 0, 0)]);
    expect(conclude(far, { date: "2026-11-06", slotsDone: 0 }).tone).toBe("ok");
  });

  it("picks the regimen in force", () => {
    const regs = [reg("2026-11-01", 1, 0, 1), reg("2026-12-01", 1, 1, 2)];
    expect(regimenAt(regs, "2026-10-31")).toBeNull();
    expect(regimenAt(regs, "2026-11-30")!.effectiveFrom).toBe("2026-11-01");
    expect(regimenAt(regs, "2026-12-01")!.effectiveFrom).toBe("2026-12-01");
  });
});

describe("format", () => {
  it("formats regimens and quantities", () => {
    expect(formatRegimen(reg("2026-11-01", 1, 0, 1))).toBe("早 1 · 中 0 · 晚 1（2颗/天）");
    expect(fmtQty(0.5)).toBe("0.5");
    expect(fmtQty(100)).toBe("100");
  });
});

describe("Beijing clock", () => {
  it("reads the date and minute in Asia/Shanghai whatever the runtime zone", () => {
    // 2026-11-06 16:30 UTC is 2026-11-07 00:30 in Beijing.
    expect(wallClock(new Date("2026-11-06T16:30:00Z"))).toEqual({ date: "2026-11-07", minutes: 30 });
    expect(wallClock(new Date("2026-11-06T00:05:00Z"))).toEqual({ date: "2026-11-06", minutes: 8 * 60 + 5 });
  });
});

describe("supply amount", () => {
  const boxes = (b: string, p: string) => ({ mode: "boxes" as const, pills: "", boxes: b, perBox: p });
  it("multiplies boxes by pills per box", () => {
    expect(resolveAmount(boxes("3", "28"))).toEqual({ value: 84 });
    expect(resolveAmount(boxes("2", "10.5"))).toEqual({ value: 21 });
  });
  it("treats an empty field as no supply and rejects half-filled or invalid boxes", () => {
    expect(resolveAmount(amountState())).toEqual({ value: null });
    expect(resolveAmount(boxes("", ""))).toEqual({ value: null });
    expect(resolveAmount(boxes("2", ""))).toEqual({ error: "请填写每盒颗数" });
    expect(resolveAmount(boxes("", "30"))).toEqual({ error: "盒数必须是正整数" });
    expect(resolveAmount(boxes("0", "30"))).toEqual({ error: "盒数必须是正整数" });
    expect(resolveAmount(boxes("1", "0.3"))).toEqual({ error: "每盒颗数只能是整数或 0.5 的倍数" });
  });
  it("passes a plain pill count through", () => {
    expect(resolveAmount(amountState("100"))).toEqual({ value: 100 });
  });
});
