import { describe, expect, it } from "vitest";
import { amountInPacks, amountState, resolveAmount } from "./amount";
import { wallClock } from "./dates";
import {
  conclude,
  describeReserve,
  describeShortfall,
  fmtPacks,
  fmtQty,
  formatRegimen,
  medicationStatus,
  packNote,
  reserveEstimate,
} from "./format";
import {
  balanceAt,
  dosesLeft,
  isExhaustedAt,
  momentAt,
  fullDays,
  nextShortfall,
  packBalancesAt,
  regimenAt,
  settleTotal,
  simulate,
  supplyToLast,
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
    // 01-07 only gets 早 and 中, so the stock lasts whole days through 01-06; the 2 pills are extra.
    expect(conclude(sim, momentAt("2026-11-06", 0))).toMatchObject({
      badge: "2027.01.06 周三",
      headline: "能吃到：2027.01.06 周三",
      detail: "距今 61 天",
      extraNote: "额外多 2 颗：够 2027.01.07 周四 早、中",
    });
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
    expect(conclude(sim, momentAt("2026-11-06", 0))).toMatchObject({
      headline: "能吃到：2026.11.06 周五",
      extraNote: "额外多 3 颗：够 2026.11.07 周六 早、中，晚只够 1/2 颗",
    });
  });

  it("counts a day only when all of its doses are covered", () => {
    // 晚 2 only, 3 pills: day 1 晚 full (1 left), day 2 晚 partial 1/2.
    const sim = simulate([sup("2026-11-06", 3)], [reg("2026-11-06", 0, 0, 2)]);
    expect(fullDays(sim)).toMatchObject({ lastFullDay: "2026-11-06", shortDay: { date: "2026-11-07" } });
    expect(conclude(sim, momentAt("2026-11-06", 0))).toMatchObject({
      headline: "能吃到：2026.11.06 周五",
      extraNote: "额外多 1 颗：2026.11.07 周六 晚只够 1/2 颗",
    });
    // Ending exactly on a day boundary leaves nothing extra.
    const even = simulate([sup("2026-11-06", 4)], [reg("2026-11-06", 1, 0, 1)]);
    expect(fullDays(even)).toEqual({ lastFullDay: "2026-11-07", shortDay: null });
    expect(conclude(even, momentAt("2026-11-06", 0))).not.toHaveProperty("extraNote");
  });

  it("says so when today itself cannot be taken in full", () => {
    // 1 pill, 早1 晚1: today 早 is covered, 晚 is not.
    const sim = simulate([sup("2026-11-06", 1)], [reg("2026-11-06", 1, 0, 1)]);
    expect(fullDays(sim)).toMatchObject({ lastFullDay: null, shortDay: { date: "2026-11-06" } });
    expect(conclude(sim, momentAt("2026-11-06", 0))).toMatchObject({
      badge: "不足一天",
      tone: "danger",
      headline: "今天的药已不够吃全",
      extraNote: "额外多 1 颗：够 2026.11.06 周五 早",
    });
    expect(conclude(sim, momentAt("2026-11-06", 20 * 60))).toMatchObject({ badge: "已吃完", detail: "今天已吃完" });
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
    expect(conclude(sim, momentAt("2026-11-03", 600)).headline).toBe("2026.11.06 周五 起停药（届时剩余 20 颗）");
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
    // 11-09 only gets 早, so whole days end on 11-08.
    expect(conclude(sim, { date: "2026-11-05", slotsDone: 0 })).toMatchObject({
      badge: "2026.11.08 周日",
      tone: "warn",
      detail: "距今 3 天",
      extraNote: "额外多 1 颗：够 2026.11.09 周一 早",
    });
    expect(conclude(sim, { date: "2026-11-06", slotsDone: 0 }).tone).toBe("danger");
    expect(conclude(sim, { date: "2026-11-08", slotsDone: 2 }).detail).toBe("今天是最后吃满的一天");
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

describe("reserve", () => {
  const r = reg("2026-11-01", 1, 0, 1);
  it("counts whole days at today's regimen and reports the rest", () => {
    expect(reserveEstimate(25, r)).toEqual({ days: 12, remainder: 1 });
    expect(reserveEstimate(24, r)).toEqual({ days: 12, remainder: 0 });
    expect(reserveEstimate(2.5, reg("2026-11-01", 0.5, 0, 0.5))).toEqual({ days: 2, remainder: 0.5 });
    expect(describeReserve(25, r)).toBe("可用 12 天，另余 1 颗");
    expect(describeReserve(24, r)).toBe("可用 12 天");
    expect(describeReserve(1, r)).toBe("不够吃满一天，另余 1 颗");
  });
  it("cannot estimate without a daily dose", () => {
    expect(describeReserve(0, r)).toBe("暂无储备");
    expect(describeReserve(30, null)).toBe("未设服用规律，无法估算");
    expect(describeReserve(30, reg("2026-11-01", 0, 0, 0))).toBe("当前停药，不消耗");
  });
});

describe("format", () => {
  it("writes pills as packs when the pack size is known", () => {
    expect(fmtPacks(84, 28)).toBe("3 盒");
    expect(fmtPacks(94, 28, "瓶")).toBe("3 瓶 10 颗");
    expect(fmtPacks(10.5, 28)).toBe("10.5 颗");
    expect(fmtPacks(30, null)).toBe("30 颗");
    expect(packNote(68, { perBox: 30, packUnit: "瓶" })).toBe("合 2 瓶 8 颗");
    expect(packNote(68, { perBox: null, packUnit: "瓶" })).toBeNull();
    expect(packNote(26, { perBox: 30, packUnit: "瓶" })).toBe("不足 1 瓶");
    expect(packNote(0, { perBox: 30, packUnit: "瓶" })).toBeNull();
  });

  it("writes every date as yyyy.mm.dd with the weekday", () => {
    expect(describeShortfall({ date: "2026-11-02", slot: "morning", status: "missed", resumesOn: "2026-11-04" })).toBe(
      "2026.11.02 周一 早起药量不足，2026.11.04 周三 补药后恢复",
    );
  });

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
  const boxes = (b: string, p: string, loose = "") => ({ mode: "boxes" as const, pills: "", boxes: b, perBox: p, loose });
  it("multiplies boxes by pills per box and adds loose pills", () => {
    expect(resolveAmount(boxes("3", "28"))).toEqual({ value: 84 });
    expect(resolveAmount(boxes("2", "10.5"))).toEqual({ value: 21 });
    // An opened box: 2 sealed boxes and 12 pills left in the third.
    expect(resolveAmount(boxes("2", "28", "12"))).toEqual({ value: 68 });
    expect(resolveAmount(boxes("", "28", "12"))).toEqual({ value: 12 });
  });
  it("treats an empty field as no supply and rejects half-filled or invalid boxes", () => {
    expect(resolveAmount(amountState())).toEqual({ value: null });
    expect(resolveAmount(boxes("", ""))).toEqual({ value: null });
    expect(resolveAmount(boxes("2", ""))).toEqual({ error: "请填写每盒颗数" });
    expect(resolveAmount(boxes("", "30"))).toEqual({ error: "请填写盒数" });
    expect(resolveAmount(boxes("1.5", "30"))).toEqual({ error: "盒数必须是整数" });
    expect(resolveAmount(boxes("1", "0.3"))).toEqual({ error: "每盒颗数只能是整数或 0.5 的倍数" });
    expect(resolveAmount(boxes("1", "28", "0.3"))).toEqual({ error: "散装颗数只能是整数或 0.5 的倍数" });
  });
  it("shows an existing count as whole packs plus loose pills", () => {
    expect(amountInPacks(72, 30)).toEqual({ mode: "boxes", pills: "", boxes: "2", perBox: "30", loose: "12" });
    expect(resolveAmount(amountInPacks(72, 30))).toEqual({ value: 72 });
    expect(amountInPacks(10, 30)).toMatchObject({ boxes: "", loose: "10" });
    expect(amountInPacks(72, null)).toMatchObject({ mode: "pills", pills: "72" });
  });
  it("passes a plain pill count through and starts in boxes when the box size is known", () => {
    expect(resolveAmount(amountState("100"))).toEqual({ value: 100 });
    expect(amountState("", 28)).toMatchObject({ mode: "boxes", perBox: "28" });
    expect(amountState("56", 28)).toMatchObject({ mode: "pills", pills: "56" });
  });
});

describe("hospital stays", () => {
  it("takes nothing from home stock on hospital days, both ends included", () => {
    // 50 pills at 2/day last 25 days; 10 days in hospital push the end back by 10.
    const sim = simulate([sup("2026-11-06", 50)], [reg("2026-11-06", 1, 0, 1)], {
      pauses: [{ start: "2026-11-10", end: "2026-11-19" }],
    });
    expect(day(sim, "2026-11-09").endOfDayBalance).toBe(42);
    expect(day(sim, "2026-11-10")).toMatchObject({ paused: true, taken: 0, endOfDayBalance: 42 });
    expect(day(sim, "2026-11-19")).toMatchObject({ paused: true, endOfDayBalance: 42 });
    expect(day(sim, "2026-11-20")).toMatchObject({ paused: false, endOfDayBalance: 40 });
    expect(conclude(sim, momentAt("2026-11-06", 0)).headline).toBe("能吃到：2026.12.10 周四");
  });
});

describe("missed doses kept in the stock", () => {
  it("takes that slot's pills off nobody: the stock lasts that much longer", () => {
    // 50 pills at 2/day last through 11-30; the 11-10 morning pill left over covers 12-01 morning.
    const sim = simulate([sup("2026-11-06", 50)], [reg("2026-11-06", 1, 0, 1)], {
      skips: [{ date: "2026-11-10", slot: "morning", quantity: 1 }],
    });
    expect(day(sim, "2026-11-10")).toMatchObject({ taken: 1, endOfDayBalance: 41 });
    expect(day(sim, "2026-11-10").slots[0]).toMatchObject({ status: "none", required: 0, taken: 0, skipped: 1 });
    expect(day(sim, "2026-11-10").slots[2]).not.toHaveProperty("skipped");
    expect(fullDays(sim)).toMatchObject({ lastFullDay: "2026-11-30", shortDay: { date: "2026-12-01" } });
  });

  it("skips part of a dose, never more than the dose, and nothing on a hospital day", () => {
    const sim = simulate([sup("2026-11-06", 50)], [reg("2026-11-06", 2, 0, 0)], {
      pauses: [{ start: "2026-11-08", end: "2026-11-08" }],
      skips: [
        { date: "2026-11-06", slot: "morning", quantity: 0.5 },
        { date: "2026-11-07", slot: "morning", quantity: 5 },
        { date: "2026-11-08", slot: "morning", quantity: 2 },
      ],
    });
    expect(day(sim, "2026-11-06").slots[0]).toMatchObject({ status: "full", required: 1.5, taken: 1.5, skipped: 0.5 });
    expect(day(sim, "2026-11-07").slots[0]).toMatchObject({ status: "none", taken: 0, skipped: 2 });
    expect(day(sim, "2026-11-08").slots[0]).not.toHaveProperty("skipped");
    expect(day(sim, "2026-11-09").endOfDayBalance).toBe(46.5);
  });

  it("is what a later count already includes", () => {
    const sim = simulate([sup("2026-11-06", 50)], [reg("2026-11-06", 1, 0, 1)], {
      skips: [{ date: "2026-11-07", slot: "morning", quantity: 1 }],
      counts: [{ date: "2026-11-07", slotsDone: 3, quantity: 40 }],
    });
    expect(day(sim, "2026-11-07").endOfDayBalance).toBe(40);
  });
});

describe("a dose taken from the reserve instead", () => {
  it("takes that dose off nobody's stock, and says so apart from a missed one", () => {
    const sim = simulate([sup("2026-11-06", 50)], [reg("2026-11-06", 2, 0, 1)], {
      skips: [
        { date: "2026-11-07", slot: "morning", quantity: 1, fromReserve: true },
        { date: "2026-11-07", slot: "morning", quantity: 1 },
        { date: "2026-11-07", slot: "evening", quantity: 1, fromReserve: true },
      ],
    });
    expect(day(sim, "2026-11-07").slots[0]).toMatchObject({ status: "none", skipped: 2, fromReserve: 1 });
    expect(day(sim, "2026-11-07").slots[2]).toMatchObject({ status: "none", skipped: 1, fromReserve: 1 });
    expect(day(sim, "2026-11-07").endOfDayBalance).toBe(47);
  });
});

describe("pills moved from the stock into the reserve", () => {
  it("leave the stock at their moment, and only then", () => {
    const sim = simulate([sup("2026-11-06", 50)], [reg("2026-11-06", 1, 0, 1)], {
      withdrawals: [{ date: "2026-11-07", slotsDone: 1, quantity: 10 }],
    });
    // 48 after 11-06; 47 after 11-07 morning, 10 go, 36 after the evening.
    expect(day(sim, "2026-11-07").slots[0].after).toBe(37);
    expect(day(sim, "2026-11-07")).toMatchObject({ withdrawn: 10, endOfDayBalance: 36, count: null });
    expect(day(sim, "2026-11-06")).not.toHaveProperty("withdrawn");
  });

  it("never takes more than the pack has, and comes after a count entered before it", () => {
    const sim = simulate([sup("2026-11-06", 10)], [reg("2026-11-06", 1, 0, 0)], {
      counts: [{ date: "2026-11-07", slotsDone: 1, quantity: 5, recordedAt: 1 }],
      withdrawals: [{ date: "2026-11-07", slotsDone: 1, quantity: 8, recordedAt: 2 }],
    });
    expect(day(sim, "2026-11-07")).toMatchObject({ withdrawn: 5, endOfDayBalance: 0 });
  });
});

describe("stock counts", () => {
  const count = (date: string, slotsDone: 0 | 1 | 2 | 3, quantity: number, recordedAt?: number) => ({
    date,
    slotsDone,
    quantity,
    recordedAt,
  });

  it("replaces the stock at the counted moment, whatever the records say", () => {
    const supplies = [sup("2026-11-01", 100)];
    const regimens = [reg("2026-11-01", 1, 0, 1)];
    // 11-01..11-05 eat 10 → 90; 11-06 早 → 89, then the count says 50; 晚 → 49.
    const sim = simulate(supplies, regimens, { counts: [count("2026-11-06", 1, 50)] });
    const d = day(sim, "2026-11-06");
    expect(d.count).toEqual({ slotsDone: 1, before: 89, quantity: 50, late: 0 });
    expect(d.slots.map((s) => s.after)).toEqual([50, 50, 49]);
    expect(d.endOfDayBalance).toBe(49);
    expect(balanceAt(sim, momentAt("2026-11-06", 9 * 60))).toBe(50);
    // 49 from 11-07: 24 full days (11-07..11-30) eat 48, 12-01 gets only 早.
    expect(conclude(sim, momentAt("2026-11-06", 20 * 60))).toMatchObject({
      headline: "能吃到：2026.11.30 周一",
      extraNote: "额外多 1 颗：够 2026.12.01 周二 早",
    });
    const status = medicationStatus(supplies, regimens, momentAt("2026-11-06", 9 * 60), [], {
      counts: [count("2026-11-06", 1, 50)],
    });
    expect(status.balanceNow).toBe(50);
  });

  it("keeps same-day supplies entered before the count in it and adds later ones on top", () => {
    const regimens = [reg("2026-11-01", 0, 0, 1)];
    const supplies: SupplyInput[] = [
      { date: "2026-11-01", quantity: 10, recordedAt: 1 },
      { date: "2026-11-06", quantity: 28, recordedAt: 5 },
      { date: "2026-11-06", quantity: 30, recordedAt: 20 },
    ];
    // 11-01..11-05 eat 5 → 5; 11-06 +28 → 33; counted 40 (the 28 already in it), +30 after → 70.
    const sim = simulate(supplies, regimens, { counts: [count("2026-11-06", 0, 40, 10)] });
    const d = day(sim, "2026-11-06");
    expect(d.count).toEqual({ slotsDone: 0, before: 33, quantity: 40, late: 30 });
    expect(d.supplied).toBe(58);
    expect(d.startBalance).toBe(70);
    expect(d.endOfDayBalance).toBe(69);
    // Without entry times every same-day supply is taken as already counted.
    const plain = simulate(
      supplies.map(({ date, quantity }) => ({ date, quantity })),
      regimens,
      { counts: [count("2026-11-06", 0, 40)] },
    );
    expect(day(plain, "2026-11-06").startBalance).toBe(40);
  });

  it("brings stock back after a run-out, or empties it when the count is 0", () => {
    const regimens = [reg("2026-11-01", 1, 0, 1)];
    const back = simulate([sup("2026-11-01", 2)], regimens, { counts: [count("2026-11-04", 0, 4)] });
    expect(day(back, "2026-11-02").slots.map((s) => s.status)).toEqual(["missed", "none", "missed"]);
    expect(day(back, "2026-11-04").startBalance).toBe(4);
    expect(back.outcome).toEqual({
      kind: "depleted",
      lastFull: { date: "2026-11-05", slot: "evening", remainingAfter: 0 },
      partial: null,
    });

    // 11-01, 11-02 eat 4 → 96; 11-03 早 → 95, then counted 0 after 中: 晚 is missed.
    const empty = simulate([sup("2026-11-01", 100)], regimens, { counts: [count("2026-11-03", 2, 0)] });
    expect(day(empty, "2026-11-03").count).toEqual({ slotsDone: 2, before: 95, quantity: 0, late: 0 });
    expect(day(empty, "2026-11-03").slots.map((s) => s.status)).toEqual(["full", "none", "missed"]);
    expect(fullDays(empty)).toMatchObject({ lastFullDay: "2026-11-02" });
  });

  it("starts the timeline at a count when there is no supply", () => {
    const sim = simulate([], [reg("2026-11-07", 1, 0, 1)], { counts: [count("2026-11-06", 3, 10)] });
    expect(sim.days[0].date).toBe("2026-11-06");
    expect(balanceAt(sim, momentAt("2026-11-06", 20 * 60))).toBe(10);
    // 10 pills at 2 a day: 11-07..11-11.
    expect(sim.outcome).toMatchObject({ kind: "depleted", lastFull: { date: "2026-11-11", slot: "evening" } });
  });
});

describe("packs (manufacturers)", () => {
  const A = 11; // the default pack
  const B = 12;
  const regimens = [reg("2026-11-01", 1, 0, 1)];
  const at = (date: string, minutes: number) => momentAt(date, minutes);

  it("keeps each pack's pills and takes doses from the default pack first", () => {
    const supplies: SupplyInput[] = [
      { date: "2026-11-01", quantity: 4, packId: A },
      { date: "2026-11-01", quantity: 20, packId: B },
    ];
    const sim = simulate(supplies, regimens, { packs: [A, B], today: "2026-11-05" });
    // 11-01, 11-02 eat A's 4; from 11-03 the doses come out of B.
    expect(packBalancesAt(sim, at("2026-11-01", 0))).toEqual([4, 20]);
    expect(packBalancesAt(sim, at("2026-11-02", 23 * 60))).toEqual([0, 20]);
    expect(packBalancesAt(sim, at("2026-11-03", 9 * 60))).toEqual([0, 19]);
    // The total is what one balance would give.
    const one = simulate(supplies.map(({ date, quantity }) => ({ date, quantity })), regimens, { today: "2026-11-05" });
    expect(sim.days.map((d) => d.endOfDayBalance)).toEqual(one.days.map((d) => d.endOfDayBalance));
    expect(sim.outcome).toEqual(one.outcome);
  });

  it("splits a dose across packs when the first runs out mid-dose", () => {
    const sim = simulate(
      [
        { date: "2026-11-01", quantity: 1, packId: A },
        { date: "2026-11-01", quantity: 5, packId: B },
      ],
      [reg("2026-11-01", 2, 0, 0)],
      { packs: [A, B] },
    );
    expect(day(sim, "2026-11-01").slots[0]).toMatchObject({ status: "full", taken: 2, after: 4 });
    expect(day(sim, "2026-11-01").byPack?.after[0]).toEqual([0, 4]);
  });

  it("puts supplies without a pack (or of an unknown one) into the default pack", () => {
    const sim = simulate(
      [
        { date: "2026-11-01", quantity: 10 },
        { date: "2026-11-01", quantity: 6, packId: 99 },
        { date: "2026-11-01", quantity: 3, packId: B },
      ],
      [],
      { packs: [A, B] },
    );
    expect(packBalancesAt(sim, at("2026-11-01", 0))).toEqual([16, 3]);
  });

  it("counts one pack without touching the other", () => {
    const supplies: SupplyInput[] = [
      { date: "2026-11-01", quantity: 10, packId: A },
      { date: "2026-11-01", quantity: 20, packId: B },
    ];
    // 11-01..11-02 eat 4 of A → A 6; 11-03 before 早 B is counted at 15.
    const sim = simulate(supplies, regimens, {
      packs: [A, B],
      counts: [{ date: "2026-11-03", slotsDone: 0, quantity: 15, packId: B }],
    });
    expect(day(sim, "2026-11-03").count).toEqual({ slotsDone: 0, before: 26, quantity: 21, late: 0 });
    expect(packBalancesAt(sim, at("2026-11-03", 0))).toEqual([6, 15]);
    expect(packBalancesAt(sim, at("2026-11-03", 23 * 60))).toEqual([4, 15]);
  });

  it("settles a count of all packs: extra pills go to the default, missing ones come off in the order taken", () => {
    expect(settleTotal([4, 20], 30)).toEqual([10, 20]);
    expect(settleTotal([4, 20], 10)).toEqual([0, 10]);
    expect(settleTotal([4, 20], 0)).toEqual([0, 0]);
    expect(settleTotal([], 5)).toEqual([]);
    const sim = simulate(
      [
        { date: "2026-11-01", quantity: 4, packId: A },
        { date: "2026-11-01", quantity: 20, packId: B },
      ],
      [],
      { packs: [A, B], counts: [{ date: "2026-11-02", slotsDone: 0, quantity: 18 }] },
    );
    expect(packBalancesAt(sim, at("2026-11-02", 0))).toEqual([0, 18]);
  });

  it("adds a same-day supply entered after a pack's count on top of it, but not one of another pack", () => {
    const sim = simulate(
      [
        { date: "2026-11-01", quantity: 10, packId: A, recordedAt: 1 },
        { date: "2026-11-02", quantity: 7, packId: B, recordedAt: 30 },
        { date: "2026-11-02", quantity: 5, packId: A, recordedAt: 40 },
      ],
      [],
      { packs: [A, B], counts: [{ date: "2026-11-02", slotsDone: 0, quantity: 3, packId: B, recordedAt: 20 }] },
    );
    // B: counted 3, +7 after; A: 10 + 5 (no count of A that day).
    expect(packBalancesAt(sim, at("2026-11-02", 0))).toEqual([15, 10]);
    expect(day(sim, "2026-11-02").count).toEqual({ slotsDone: 0, before: 15, quantity: 18, late: 7 });
  });

  it("gives the whole balance for one pack and nothing without packs", () => {
    const sim = simulate([sup("2026-11-01", 8)], regimens, { packs: [A] });
    expect(packBalancesAt(sim, at("2026-11-01", 0))).toEqual([8]);
    expect(packBalancesAt(simulate([sup("2026-11-01", 8)], regimens), at("2026-11-01", 0))).toEqual([]);
  });
});

describe("supplyToLast", () => {
  const regimens = [reg("2026-11-01", 1, 0, 1)];

  it("gives exactly the pills to last through the evening of the chosen day", () => {
    // Empty stock: 11-07 早 through 12-02 晚 is 26 days × 2.
    expect(supplyToLast([], regimens, { date: "2026-11-07" }, "2026-12-02")).toBe(52);
    // 10 already there: 42 more.
    expect(supplyToLast([sup("2026-11-07", 10)], regimens, { date: "2026-11-07" }, "2026-12-02")).toBe(42);
    // Already enough: nothing.
    expect(supplyToLast([sup("2026-11-01", 200)], regimens, { date: "2026-11-07" }, "2026-12-02")).toBe(0);
  });

  it("skips hospital days and works in half pills", () => {
    const stays = [{ start: "2026-11-10", end: "2026-11-12" }];
    // 11-07..11-16 is 10 days, 3 of them in hospital: 7 × 2.
    expect(supplyToLast([], regimens, { date: "2026-11-07" }, "2026-11-16", { pauses: stays })).toBe(14);
    expect(supplyToLast([], [reg("2026-11-01", 0.5, 0, 0)], { date: "2026-11-07" }, "2026-11-09")).toBe(1.5);
  });

  it("starts at a same-day count when entered after it, and gives up across a later count", () => {
    const counts = [{ date: "2026-11-07", slotsDone: 1 as const, quantity: 0, recordedAt: 5 }];
    // After the count (早 done, 0 left): 11-07 晚 + 11-08 早晚 = 3.
    expect(supplyToLast([], regimens, { date: "2026-11-07", recordedAt: 9 }, "2026-11-08", { counts })).toBe(3);
    const later = [{ date: "2026-11-09", slotsDone: 0 as const, quantity: 0 }];
    expect(supplyToLast([], regimens, { date: "2026-11-07" }, "2026-11-10", { counts: later })).toBeNull();
  });
});
