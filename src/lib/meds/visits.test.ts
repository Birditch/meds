import { describe, expect, it } from "vitest";
import { medicationStatus } from "./format";
import { addDays } from "./dates";
import { balanceAt, simulate, type RegimenInput, type SupplyInput } from "./simulate";
import {
  isMonthStart,
  nearestMonthStart,
  planHorizon,
  planVisits,
  scheduleVisits,
  spanText,
  suggestNextVisit,
  usualNextVisit,
  visitOrdinal,
  weekdayCN,
} from "./visits";

const reg = (effectiveFrom: string, morning: number, noon: number, evening: number): RegimenInput => ({
  effectiveFrom,
  morning,
  noon,
  evening,
});
const sup = (date: string, quantity: number): SupplyInput => ({ date, quantity });
const visits = (...dates: string[]) => dates.map((date) => ({ date }));
// Before the morning dose, so every slot of "today" is still ahead.
const NOW = { date: "2026-11-06", slotsDone: 0 } as const;

describe("visit rhythm", () => {
  it("knows the start of a month is days 1–10", () => {
    expect(isMonthStart("2026-12-01")).toBe(true);
    expect(isMonthStart("2026-12-10")).toBe(true);
    expect(isMonthStart("2026-12-11")).toBe(false);
  });

  it("follows up 4 weeks later, pushed back whole weeks into a month start", () => {
    // Already at a month start.
    expect(usualNextVisit("2026-11-06")).toEqual({ fourWeeks: "2026-12-04", monthStart: "2026-12-04" });
    // A month-end follow-up, put off one week to the start of January.
    expect(usualNextVisit("2026-11-27")).toEqual({ fourWeeks: "2026-12-25", monthStart: "2027-01-01" });
    expect(usualNextVisit("2027-01-03")).toEqual({ fourWeeks: "2027-01-31", monthStart: "2027-02-07" });
  });
});

describe("suggestNextVisit", () => {
  it("offers 4 weeks after the last visit and, when that is not a month start, the delayed month-start date", () => {
    expect(suggestNextVisit("2026-11-06", "2026-11-06")).toEqual([{ label: "距上次 4 周（月初）", date: "2026-12-04" }]);
    expect(suggestNextVisit("2026-11-27", "2026-11-06")).toEqual([
      { label: "距上次 4 周", date: "2026-12-25" },
      { label: "顺延到月初（距上次 5 周）", date: "2027-01-01" },
    ]);
  });
  it("counts from today when there is no recent visit, and offers the nearest month start", () => {
    expect(suggestNextVisit(null, "2026-11-06")).toEqual([{ label: "4 周（月初）", date: "2026-12-04" }]);
    expect(suggestNextVisit("2026-09-01", "2026-11-20")).toEqual([
      { label: "最近的月初", date: "2026-12-01" },
      { label: "4 周", date: "2026-12-18" },
      { label: "顺延到月初（6 周）", date: "2027-01-01" },
    ]);
    expect(nearestMonthStart("2026-12-20")).toBe("2027-01-01");
  });
});

describe("scheduleVisits", () => {
  it("covers each visit up to the next one and assumes the usual rhythm after the last", () => {
    const s = scheduleVisits(visits("2026-12-06", "2026-11-20", "2026-10-01"), "2026-11-06");
    expect(s.map((v) => v.date)).toEqual(["2026-11-20", "2026-12-06"]); // past visits drop out
    expect(s[0]).toMatchObject({ estimated: false });
    expect(s[1]).toMatchObject({ estimated: true });
    expect(planHorizon(s)).toBe("2027-01-02"); // 12-06 + 4 weeks = 01-03 (a month start) − 1
  });

  it("plans a lone visit today as well", () => {
    const s = scheduleVisits(visits("2026-11-06"), "2026-11-06");
    expect(planVisits(simulate([], []), s, NOW).visits[0].coverUntil).toBe("2026-12-03");
  });
});

describe("planVisits", () => {
  // 2 pills a day, 50 in stock today.
  const supplies = [sup("2026-11-06", 50)];
  const regimens = [reg("2026-11-06", 1, 0, 1)];

  it("asks each visit for what the current timeline lacks until the next visit", () => {
    // Visits on day 14, 44, 74 from today.
    const status = medicationStatus(supplies, regimens, NOW, scheduleVisits(visits("2026-11-20", "2026-12-20", "2027-01-19"), NOW.date));
    expect(status.plan.beforeFirst).toBeNull();
    expect(status.plan.visits).toEqual([
      // 50 − 14 days × 2 = 22 on arrival; 30 days × 2 = 60 needed → 38.
      { date: "2026-11-20", coverUntil: "2026-12-19", estimated: false, stockBefore: 22, need: 38, packs: null, prescribed: 38 },
      // Out of stock by then on the current records: the full 60.
      { date: "2026-12-20", coverUntil: "2027-01-18", estimated: false, stockBefore: 0, need: 60, packs: null, prescribed: 60 },
      // Last visit: 4 weeks on is 02-16, pushed back to the 03-02 month start → 42 days × 2.
      { date: "2027-01-19", coverUntil: "2027-03-01", estimated: true, stockBefore: 0, need: 84, packs: null, prescribed: 84 },
    ]);
    // The conclusion is unaffected by planning further ahead.
    expect(status.conclusion.headline).toBe("能吃到：2026.11.30 周一");
  });

  it("gets whole boxes and carries the extra pills into the next period", () => {
    const schedule = scheduleVisits(visits("2026-11-20", "2026-12-20", "2027-01-19"), NOW.date);
    const plan = medicationStatus(supplies, regimens, NOW, schedule, { perBox: 28 }).plan.visits;
    expect(plan.map(({ stockBefore, need, packs, prescribed }) => ({ stockBefore, need, packs, prescribed }))).toEqual([
      { stockBefore: 22, need: 38, packs: 2, prescribed: 56 }, // 18 left over
      { stockBefore: 18, need: 42, packs: 2, prescribed: 56 }, // 60 − 18; 14 left over
      { stockBefore: 14, need: 70, packs: 3, prescribed: 84 }, // 84 − 14
    ]);
  });

  it.each([null, 28])("plans a chain that never runs short and never touches the reserve (per box: %s)", (perBox) => {
    const schedule = scheduleVisits(visits("2026-11-20", "2026-12-20", "2027-01-19", "2027-03-01"), NOW.date);
    const plan = medicationStatus(supplies, regimens, NOW, schedule, { perBox }).plan.visits;
    const filled = [...supplies, ...plan.filter((v) => v.prescribed > 0).map((v) => sup(v.date, v.prescribed))];
    const sim = simulate(filled, regimens, { today: NOW.date, until: planHorizon(schedule) });
    const last = schedule.at(-1)!.endDay;
    expect(sim.days.filter((d) => d.day < last).every((d) => d.slots.every((s) => s.taken === s.required))).toBe(true);
    // The stock on arrival is what that chain has left the evening before.
    for (const v of plan) expect(v.stockBefore).toBe(balanceAt(sim, { date: addDays(v.date, -1), slotsDone: 3 }));
    // Exact prescriptions are also the least: one pill fewer anywhere and a dose is missed.
    if (perBox === null) {
      const k = plan.findIndex((v) => v.need > 0);
      const less = filled.map((f) => (f.date === plan[k].date ? sup(f.date, f.quantity - 1) : f));
      const short = simulate(less, regimens, { today: NOW.date, until: planHorizon(schedule) });
      expect(short.days.filter((d) => d.day < last).some((d) => d.slots.some((s) => s.taken < s.required))).toBe(true);
    }
  });

  it("skips hospital days when working out what a period needs", () => {
    const schedule = scheduleVisits(visits("2026-11-20", "2026-12-20"), NOW.date);
    const s = medicationStatus(supplies, regimens, NOW, schedule, { pauses: [{ start: "2026-11-25", end: "2026-12-04" }] });
    // 30 days in the period, 10 of them in hospital: 20 × 2 − 22 on hand.
    expect(s.plan.visits[0]).toMatchObject({ stockBefore: 22, need: 18 });
  });

  it("needs nothing when stock already covers the period, and counts logged refills", () => {
    const s = medicationStatus(
      [sup("2026-11-06", 50), sup("2026-12-01", 100)],
      regimens,
      NOW,
      scheduleVisits(visits("2026-11-20", "2026-12-20"), NOW.date),
    );
    expect(s.plan.visits[0].need).toBe(0); // 22 + the 12-01 refill covers to 12-19
  });

  it("follows regimen changes inside a period", () => {
    // From 11-25 the dose doubles: 11-20..11-24 = 5 × 2, 11-25..12-19 = 25 × 4.
    const s = medicationStatus(
      supplies,
      [...regimens, reg("2026-11-25", 2, 0, 2)],
      NOW,
      scheduleVisits(visits("2026-11-20", "2026-12-20"), NOW.date),
    );
    expect(s.plan.visits[0]).toMatchObject({ stockBefore: 22, need: 10 + 100 - 22 });
  });

  it("warns when stock runs out before the first visit", () => {
    const s = medicationStatus(supplies, regimens, NOW, scheduleVisits(visits("2026-12-10", "2027-01-09"), NOW.date));
    // 50 pills last 25 days (to 11-30 晚); 12-01..12-09 = 9 days × 2 short.
    expect(s.plan.beforeFirst).toEqual({ shortfall: 18, from: { date: "2026-12-01", slot: "morning" } });
    expect(s.plan.visits[0]).toMatchObject({ stockBefore: 0, need: 60 });
  });

  it("only counts what is still ahead for a visit today", () => {
    const evening = { date: "2026-11-06", slotsDone: 3 } as const;
    const s = medicationStatus([], regimens, evening, scheduleVisits(visits("2026-11-06", "2026-11-08"), evening.date));
    // Today's doses are past; 11-07 needs 2.
    expect(s.plan.visits[0]).toMatchObject({ stockBefore: 0, need: 2 });
  });

  it("asks nothing of a stopped medication", () => {
    const s = medicationStatus(supplies, [reg("2026-11-06", 0, 0, 0)], NOW, scheduleVisits(visits("2026-11-20", "2026-12-20"), NOW.date));
    expect(s.plan.visits[0].need).toBe(0);
  });
});

describe("labels", () => {
  it("names visits and weekdays", () => {
    expect([0, 1, 2].map(visitOrdinal)).toEqual(["下次", "下下次", "第 3 次"]);
    expect(weekdayCN("2026-11-06")).toBe("周五");
    expect(weekdayCN("1970-01-01")).toBe("周四");
    expect(spanText(28)).toBe("28 天（4 周）");
    expect(spanText(38)).toBe("38 天（5 周 3 天）");
    expect(spanText(5)).toBe("5 天");
  });
});
