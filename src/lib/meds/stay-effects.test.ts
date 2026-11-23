import { describe, expect, it, vi } from "vitest";
import { reserveReport, stockReport, visitReport, type ReportInput } from "./reports";
import { stockStayLines, visitStayLines } from "./stay-effects";
import type { CountRecord, MedicationRecord } from "./types";

vi.mock("server-only", () => ({}));

let nextId = 1;
const med = (
  name: string,
  { perBox, supply, from = "2026-11-05", dose = [0, 0, 1], counts = [] }: { perBox: number; supply: number; from?: string; dose?: number[]; counts?: CountRecord[] },
): MedicationRecord => ({
  id: nextId++,
  name,
  brand: null,
  dosage: "10mg",
  packUnit: "盒",
  perBox,
  packs: [{ id: 1, brand: null, packUnit: "盒", perBox, reserve: 0 }],
  reserve: 0,
  tags: [],
  supplies: [{ id: nextId++, date: from, quantity: supply, packId: null, recordedAt: 0, fromReserve: false, source: null }],
  counts,
  reserveLogs: [],
  misses: [],
  regimens: [{ id: nextId++, effectiveFrom: from, morning: dose[0], noon: dose[1], evening: dose[2] }],
  searchKeys: [],
});

const stay = (startDate: string, endDate: string) => ({ id: nextId++, startDate, endDate });

// Monday 2026-11-23 after the evening dose, in hospital 11-16 to 11-27; the visit is Thursday 12-03.
const NOW = { date: "2026-11-23", slotsDone: 3 } as const;
const X = med("药品X", { perBox: 7, supply: 28 });
const input = (over: Partial<ReportInput> = {}): ReportInput => ({
  medications: [X],
  visits: [{ id: 1, date: "2026-12-03" }],
  stays: [stay("2026-11-16", "2026-11-27")],
  now: NOW,
  ...over,
});

describe("a stay before the visit", () => {
  const r = visitReport(input())!;
  const x = r.needed[0];

  it("says which hospital days fall where, what they would have taken, and the figures without them", () => {
    expect(x.stay).toMatchObject({
      past: { runs: [{ start: "2026-11-16", end: "2026-11-23" }], days: 8, doses: 8 },
      beforeVisit: { runs: [{ start: "2026-11-24", end: "2026-11-27" }], days: 4, doses: 4 },
      homeBeforeVisit: { days: 5, taken: 5, supplied: 0 },
      period: { days: 0, doses: 0 },
      balanceNow: { with: 17, without: 9 },
      stockBefore: { with: 12, without: 0 },
      demand: { with: 28, without: 28 },
    });
    expect(x.stay!.need.with).toMatchObject({ need: 16, packs: 3, prescribed: 21 });
    expect(x.stay!.need.without).toMatchObject({ need: 28, packs: 4, prescribed: 28 });
  });

  it("explains every step for the medication", () => {
    expect(visitStayLines(x.stay!, { ...x.need, index: 0 }, NOW, "盒")).toEqual([
      "到现在：住院 11.16–11.23（8 天），按规律本应吃 8 颗，都由医院配发，没从家里扣 → 现在剩 17 颗（不算住院为 9 颗）",
      "复诊前：住院 11.24–11.27（4 天），按规律本应吃 4 颗，也不从家里扣；其余 5 天在家，共扣 5 颗：17 − 5 = 12 颗",
      "→ 12.02 周三晚上剩 12 颗（不算住院为 0 颗）",
      "开药期间 12.03–12.30：没有住院，需 28 颗",
      "结果：这次开 3 盒（缺 16 颗，开 21 颗）；不算住院要开 4 盒（缺 28 颗，开 28 颗），住院让这次少开 1 盒（7 颗）",
    ]);
  });

  it("cuts the stay at now and at the visit for the list as a whole", () => {
    expect(r.stays).toEqual([
      {
        stay: { start: "2026-11-16", end: "2026-11-27" },
        state: "住院中",
        parts: [
          { where: "past", range: { start: "2026-11-16", end: "2026-11-23" } },
          { where: "beforeVisit", range: { start: "2026-11-24", end: "2026-11-27" } },
        ],
      },
    ]);
  });

  it("explains the stock list the same way, with how much later the stock lasts", () => {
    const s = stockReport(input());
    expect(s.stays[0].parts.map((p) => p.where)).toEqual(["past", "ahead"]);
    expect(stockStayLines(s.items[0].stay!, NOW)).toEqual([
      "到现在：住院 11.16–11.23（8 天），按规律本应吃 8 颗，都由医院配发，没从家里扣 → 现在剩 17 颗（不算住院为 9 颗）",
      "接下来：住院 11.24–11.27（4 天），按规律本应吃 4 颗，也不从家里扣",
      "结果：能吃到 12.14（不算住院为 12.02）：住院一共省下家里的 12 颗，能吃到的日子推后 12 天",
    ]);
  });

  it("names a stay still to come in the reserve list", () => {
    expect(reserveReport(input()).stays.map((n) => n.state)).toEqual(["住院中"]);
    expect(reserveReport(input({ now: { date: "2026-11-30", slotsDone: 0 } })).stays).toEqual([]);
  });
});

describe("a stay in the period a visit covers", () => {
  // 40 from 11-01 at 1 a day: 8 left after 12-02; 12-10 to 12-12 in hospital.
  const Y = med("药品Y", { perBox: 6, supply: 40, from: "2026-11-01" });
  const now = { date: "2026-11-06", slotsDone: 0 } as const;
  const r = visitReport(input({ medications: [Y], now, stays: [stay("2026-12-10", "2026-12-12")] }))!;
  const y = r.needed[0];

  it("leaves its days out of what the period needs", () => {
    expect(y.stay).toMatchObject({
      past: { days: 0 },
      beforeVisit: { days: 0 },
      period: { runs: [{ start: "2026-12-10", end: "2026-12-12" }], days: 3, doses: 3 },
      demand: { with: 25, without: 28 },
    });
    expect(visitStayLines(y.stay!, { ...y.need, index: 0 }, now, "盒").slice(-2)).toEqual([
      "开药期间 12.03–12.30：住院 12.10–12.12（3 天），按规律本应吃 3 颗，由医院配发，不算在需要量里 → 需 25 颗（不算住院为 28 颗）",
      "结果：这次开 3 盒（缺 17 颗，开 18 颗）；不算住院要开 4 盒（缺 20 颗，开 24 颗），住院让这次少开 1 盒（6 颗）",
    ]);
    expect(r.stays[0]).toMatchObject({ state: "还没入院", parts: [{ where: "period" }] });
  });

  it("names a stay after the period, saying it does not count for this visit", () => {
    const later = visitReport(input({ medications: [Y], now, stays: [stay("2027-01-10", "2027-01-12")] }))!;
    expect(later.needed[0].stay).toBeNull();
    expect(later.stays).toEqual([
      { stay: { start: "2027-01-10", end: "2027-01-12" }, state: "还没入院", parts: [{ where: "after", range: { start: "2027-01-10", end: "2027-01-12" } }] },
    ]);
  });
});

describe("in hospital right now, part of the way through the day", () => {
  // 100 from 11-01, 早 1 晚 1; Friday 11-20 after the noon dose.
  const Z = med("药品Z", { perBox: 50, supply: 100, from: "2026-11-01", dose: [1, 0, 1] });
  const now = { date: "2026-11-20", slotsDone: 2 } as const;

  it("puts today's done doses behind now and its evening ahead", () => {
    const z = visitReport(input({ medications: [Z], now }))!.covered[0] ?? visitReport(input({ medications: [Z], now }))!.needed[0];
    expect(z.stay).toMatchObject({
      past: { runs: [{ start: "2026-11-16", end: "2026-11-20" }], days: 5, doses: 9 },
      beforeVisit: { runs: [{ start: "2026-11-20", end: "2026-11-27" }], days: 8, doses: 15 },
      balanceNow: { with: 70, without: 61 },
    });
  });
});

describe("a count taken during the stay", () => {
  // Counted 15 after the evening dose of 11-20, in hospital.
  const counted = med("药品W", {
    perBox: 7,
    supply: 28,
    counts: [{ id: 1, date: "2026-11-20", slotsDone: 3, quantity: 15, recordedAt: 0, packId: null }],
  });

  it("starts from the count and says the earlier hospital days are in it", () => {
    const w = visitReport(input({ medications: [counted] }))!.needed[0];
    expect(w.stay).toMatchObject({
      countedAt: { date: "2026-11-20", slotsDone: 3 },
      past: { runs: [{ start: "2026-11-21", end: "2026-11-23" }], days: 3, doses: 3 },
      beforeCount: { runs: [{ start: "2026-11-16", end: "2026-11-20" }], days: 5, doses: 5 },
      balanceNow: { with: 15, without: 12 },
    });
    expect(visitStayLines(w.stay!, { ...w.need, index: 0 }, NOW, "盒").slice(0, 2)).toEqual([
      "到现在：11.20 晚上服药后盘点之后，住院 11.21–11.23（3 天），按规律本应吃 3 颗，都由医院配发，没从家里扣 → 现在剩 15 颗（不算住院为 12 颗）",
      "更早的住院 11.16–11.20（5 天）在 11.20 晚上服药后盘点之前：现有余量按盘点的实数推算，那几天不再另算",
    ]);
  });
});

describe("a visit today", () => {
  it("has nothing before it: the stock now is what it starts with", () => {
    const now = { date: "2026-12-03", slotsDone: 0 } as const;
    const v = visitReport(input({ now }))!;
    const x = [...v.needed, ...v.covered][0];
    const lines = visitStayLines(x.stay!, { ...x.need, index: 0 }, now, "盒");
    expect(lines.some((l) => l.startsWith("复诊前"))).toBe(false);
    expect(lines[0]).toContain("到现在：住院 11.16–11.27（12 天），按规律本应吃 12 颗");
  });
});

describe("no stays", () => {
  it("adds nothing", () => {
    const r = visitReport(input({ stays: [] }))!;
    expect(r.stays).toEqual([]);
    expect(r.needed[0]).toMatchObject({ stay: null, withoutStays: null });
    expect(stockReport(input({ stays: [] })).stays).toEqual([]);
    expect(reserveReport(input({ stays: [] })).stays).toEqual([]);
  });
});

describe("pdf with a stay", () => {
  it("renders the explanation in all three lists", async () => {
    const { renderReservePdf, renderStockPdf, renderVisitPdf } = await import("./pdf");
    const ctx = { input: input(), generated: "2026.11.23 周一 20:30（北京时间）" };
    for (const pdf of [
      await renderVisitPdf(visitReport(input())!, ctx),
      await renderStockPdf(stockReport(input()), ctx),
      await renderReservePdf(reserveReport(input()), ctx),
    ]) {
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    }
  }, 30_000);
});
