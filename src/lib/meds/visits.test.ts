import { describe, expect, it } from "vitest";
import { medicationStatus } from "./format";
import { addDays } from "./dates";
import { balanceAt, simulate, type RegimenInput, type SupplyInput } from "./simulate";
import {
  clinicDayOnOrAfter,
  clinicDayOnOrBefore,
  isClinicDay,
  isMonthStart,
  nearestClinicDay,
  nearestMonthStartVisit,
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
// Friday 2026-11-06, before the morning dose, so every slot of "today" is still ahead.
const NOW = { date: "2026-11-06", slotsDone: 0 } as const;
// Thursdays used below: 11-19, 11-26, 12-03, 12-10, 12-17, 12-24, 12-31, 2027-01-07, 01-14, 02-04.

describe("visit rhythm", () => {
  it("knows the start of a month is days 1–10", () => {
    expect(isMonthStart("2026-12-01")).toBe(true);
    expect(isMonthStart("2026-12-10")).toBe(true);
    expect(isMonthStart("2026-12-11")).toBe(false);
  });

  it("finds Thursdays, the clinic day", () => {
    expect(isClinicDay("2026-11-19")).toBe(true);
    expect(isClinicDay("2026-11-20")).toBe(false);
    expect(clinicDayOnOrAfter("2026-11-20")).toBe("2026-11-26");
    expect(clinicDayOnOrAfter("2026-11-19")).toBe("2026-11-19");
    expect(clinicDayOnOrBefore("2026-12-01")).toBe("2026-11-26");
    expect(clinicDayOnOrBefore("2026-11-19")).toBe("2026-11-19");
    // Closest Thursday: Fri → the day before, Mon → 3 days on, Sun → 3 days back.
    expect(nearestClinicDay("2026-12-04")).toBe("2026-12-03");
    expect(nearestClinicDay("2026-11-30")).toBe("2026-12-03");
    expect(nearestClinicDay("2026-11-29")).toBe("2026-11-26");
    expect(nearestClinicDay("2026-11-26")).toBe("2026-11-26");
  });

  it("follows up on the Thursday 4 weeks later, pushed back whole weeks into a month start", () => {
    // Already at a month start.
    expect(usualNextVisit("2026-11-05")).toEqual({ fourWeeks: "2026-12-03", monthStart: "2026-12-03" });
    // A month-end follow-up, put off two weeks to the start of January.
    expect(usualNextVisit("2026-11-26")).toEqual({ fourWeeks: "2026-12-24", monthStart: "2027-01-07" });
    // A visit that was not on a Thursday is followed by the Thursday closest to 4 weeks later.
    expect(usualNextVisit("2026-11-27")).toEqual({ fourWeeks: "2026-12-24", monthStart: "2027-01-07" });
    expect(usualNextVisit("2027-01-07")).toEqual({ fourWeeks: "2027-02-04", monthStart: "2027-02-04" });
  });
});

describe("suggestNextVisit", () => {
  it("offers 4 weeks after the last visit and, when that is not a month start, the delayed month-start Thursday", () => {
    expect(suggestNextVisit("2026-11-05", "2026-11-06")).toEqual({
      options: [{ label: "距上次 4 周（月初）", date: "2026-12-03" }],
      preferred: "2026-12-03",
    });
    expect(suggestNextVisit("2026-11-26", "2026-11-06")).toEqual({
      options: [
        { label: "距上次 4 周", date: "2026-12-24" },
        { label: "顺延到月初（距上次 6 周）", date: "2027-01-07" },
      ],
      preferred: "2027-01-07",
    });
  });

  it("counts from today when there is no recent visit, and offers the nearest month-start Thursday", () => {
    expect(nearestMonthStartVisit("2026-11-06")).toBe("2026-12-03");
    // Friday 11-06 + 4 weeks = Friday 12-04 → Thursday 12-03, already a month start.
    expect(suggestNextVisit(null, "2026-11-06")).toEqual({
      options: [{ label: "4 周后（月初）", date: "2026-12-03" }],
      preferred: "2026-12-03",
    });
    expect(suggestNextVisit("2026-09-03", "2026-11-20")).toEqual({
      options: [
        { label: "最近的月初", date: "2026-12-03" },
        { label: "4 周后", date: "2026-12-17" },
        { label: "顺延到月初", date: "2027-01-07" },
      ],
      preferred: "2027-01-07",
    });
  });
});

describe("scheduleVisits", () => {
  it("covers each visit up to the Wednesday before the next one, and assumes the usual rhythm after the last", () => {
    const s = scheduleVisits(visits("2026-12-03", "2026-11-19", "2026-10-01"), "2026-11-06");
    expect(s.map((v) => v.date)).toEqual(["2026-11-19", "2026-12-03"]); // past visits drop out
    expect(s[0]).toMatchObject({ estimated: false });
    expect(s[1]).toMatchObject({ estimated: true });
    // The usual 4 weeks after the last one: Thursday 12-31, so covered through Wednesday 12-30.
    expect(planHorizon(s)).toBe("2026-12-30");
  });

  it("plans a lone visit as well", () => {
    const s = scheduleVisits(visits("2026-11-12"), "2026-11-06");
    expect(planVisits(simulate([], []), s, NOW).visits[0].coverUntil).toBe("2026-12-09"); // to Wednesday
  });
});

describe("planVisits", () => {
  // 2 pills a day, 50 in stock today (Friday 11-06): it lasts through 11-30.
  const supplies = [sup("2026-11-06", 50)];
  const regimens = [reg("2026-11-06", 1, 0, 1)];
  const thursdays = (...dates: string[]) => scheduleVisits(visits(...dates), NOW.date);

  it("counts the stock left on Wednesday evening and covers through the next Wednesday evening", () => {
    const status = medicationStatus(supplies, regimens, NOW, thursdays("2026-11-19", "2026-12-17", "2027-01-14"));
    expect(status.plan.beforeFirst).toBeNull();
    expect(status.plan.visits).toEqual([
      // Wed 11-18 evening: 50 − 13 days × 2 = 24 left. Thu 11-19 .. Wed 12-16 = 28 days × 2 = 56 → 32.
      { date: "2026-11-19", coverUntil: "2026-12-16", estimated: false, demand: 56, supplied: 0, stockBefore: 24, need: 32, packs: null, prescribed: 32 },
      // Nothing left on the current records by then: 28 days × 2.
      { date: "2026-12-17", coverUntil: "2027-01-13", estimated: false, demand: 56, supplied: 0, stockBefore: 0, need: 56, packs: null, prescribed: 56 },
      // Last visit: the usual 4 weeks, to Wednesday 02-10 (not pushed to a month start).
      { date: "2027-01-14", coverUntil: "2027-02-10", estimated: true, demand: 56, supplied: 0, stockBefore: 0, need: 56, packs: null, prescribed: 56 },
    ]);
    // The conclusion is unaffected by planning further ahead.
    expect(status.conclusion.headline).toBe("能吃到：2026.11.30 周一");
  });

  it("gets whole packs and carries the extra pills into the next period", () => {
    const plan = medicationStatus(supplies, regimens, NOW, thursdays("2026-11-19", "2026-12-17", "2027-01-14"), {
      perBox: 28,
    }).plan.visits;
    expect(plan.map(({ stockBefore, need, packs, prescribed }) => ({ stockBefore, need, packs, prescribed }))).toEqual([
      { stockBefore: 24, need: 32, packs: 2, prescribed: 56 }, // 24 left over
      { stockBefore: 24, need: 32, packs: 2, prescribed: 56 }, // 56 − 24; 24 left over
      { stockBefore: 24, need: 32, packs: 2, prescribed: 56 }, // 56 − 24
    ]);
  });

  it.each([null, 28])("plans a chain that never runs short and never touches the reserve (per pack: %s)", (perBox) => {
    const schedule = thursdays("2026-11-19", "2026-12-17", "2027-01-14", "2027-02-04");
    const plan = medicationStatus(supplies, regimens, NOW, schedule, { perBox }).plan.visits;
    const filled = [...supplies, ...plan.filter((v) => v.prescribed > 0).map((v) => sup(v.date, v.prescribed))];
    const sim = simulate(filled, regimens, { today: NOW.date, until: planHorizon(schedule) });
    const last = schedule.at(-1)!.endDay;
    expect(sim.days.filter((d) => d.day < last).every((d) => d.slots.every((s) => s.taken === s.required))).toBe(true);
    // The stock on arrival is what that chain has left on Wednesday evening.
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
    const s = medicationStatus(supplies, regimens, NOW, thursdays("2026-11-19", "2026-12-17"), {
      pauses: [{ start: "2026-11-25", end: "2026-12-04" }],
    });
    // 28 days in the period, 10 of them in hospital: 18 × 2 − 24 on hand.
    expect(s.plan.visits[0]).toMatchObject({ stockBefore: 24, need: 12 });
  });

  it("needs nothing when stock already covers the period, and counts logged refills", () => {
    const s = medicationStatus([sup("2026-11-06", 50), sup("2026-12-01", 100)], regimens, NOW, thursdays("2026-11-19", "2026-12-17"));
    expect(s.plan.visits[0]).toMatchObject({ need: 0, supplied: 100 }); // 24 + the 12-01 refill covers through 12-16
  });

  it("follows regimen changes inside a period", () => {
    // From 11-25 the dose doubles: 11-19..11-24 = 6 × 2, 11-25..12-16 = 22 × 4.
    const s = medicationStatus(supplies, [...regimens, reg("2026-11-25", 2, 0, 2)], NOW, thursdays("2026-11-19", "2026-12-17"));
    expect(s.plan.visits[0]).toMatchObject({ stockBefore: 24, need: 12 + 88 - 24 });
  });

  it("warns when stock runs out before the first visit, with the last Thursday that still helps", () => {
    const s = medicationStatus(supplies, regimens, NOW, thursdays("2026-12-10", "2027-01-07"));
    // Out after 11-30 晚; 12-01..12-09 = 9 days × 2 short. 12-01 is a Tuesday → Thursday 11-26.
    expect(s.plan.beforeFirst).toEqual({
      shortfall: 18,
      from: { date: "2026-12-01", slot: "morning" },
      latestVisit: "2026-11-26",
    });
    expect(s.plan.visits[0]).toMatchObject({ stockBefore: 0, need: 56 });
    // Seen too late for any Thursday before the gap.
    const late = { date: "2026-11-27", slotsDone: 0 } as const;
    const t = medicationStatus(supplies, regimens, late, scheduleVisits(visits("2026-12-10"), late.date));
    expect(t.plan.beforeFirst).toMatchObject({ shortfall: 18, latestVisit: null });
  });

  it("only counts what is still ahead for a visit today", () => {
    const evening = { date: "2026-11-06", slotsDone: 3 } as const;
    const s = medicationStatus([], regimens, evening, scheduleVisits(visits("2026-11-06", "2026-11-08"), evening.date));
    // Today's doses are past; 11-07 needs 2.
    expect(s.plan.visits[0]).toMatchObject({ stockBefore: 0, need: 2 });
  });

  it("asks nothing of a stopped medication", () => {
    const s = medicationStatus(supplies, [reg("2026-11-06", 0, 0, 0)], NOW, thursdays("2026-11-19", "2026-12-17"));
    expect(s.plan.visits[0].need).toBe(0);
  });
});

describe("labels", () => {
  it("names visits, weekdays and spans", () => {
    expect([0, 1, 2].map(visitOrdinal)).toEqual(["下次", "下下次", "第 3 次"]);
    expect(weekdayCN("2026-11-06")).toBe("周五");
    expect(weekdayCN("1970-01-01")).toBe("周四");
    expect(spanText(28)).toBe("28 天（4 周）");
    expect(spanText(38)).toBe("38 天（5 周 3 天）");
    expect(spanText(5)).toBe("5 天");
  });
});
