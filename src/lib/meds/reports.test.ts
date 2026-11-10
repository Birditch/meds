import { describe, expect, it, vi } from "vitest";
import {
  countLines,
  gapWarning,
  medicationLabel,
  otherPacksText,
  packBreakdown,
  needReason,
  needText,
  purchaseLines,
  reserveReport,
  prescriptionText,
  stockReport,
  tagsText,
  visitReport,
  type ReportInput,
} from "./reports";
import type { MedicationRecord } from "./types";

vi.mock("server-only", () => ({}));

let nextId = 1;
const med = (
  name: string,
  { perBox = null, reserve = 0, supplies = [], daily = 1 }: { perBox?: number | null; reserve?: number; supplies?: [string, number][]; daily?: 1 | 2 } = {},
): MedicationRecord => ({
  id: nextId++,
  name,
  brand: null,
  dosage: "10mg",
  packUnit: "盒",
  perBox,
  packs: [{ id: 1, brand: null, packUnit: "盒", perBox, reserve }],
  reserve,
  tags: [],
  supplies: supplies.map(([date, quantity]) => ({ id: nextId++, date, quantity, packId: null, recordedAt: 0, fromReserve: false, source: null })),
  counts: [],
  reserveLogs: [],
  regimens: [{ id: nextId++, effectiveFrom: "2026-11-01", morning: daily === 2 ? 1 : 0, noon: 0, evening: 1 }],
  searchKeys: [],
});

// Friday 2026-11-06 before the morning dose; the visit is Thursday 2026-12-03.
const NOW = { date: "2026-11-06", slotsDone: 0 } as const;
// 70 pills from Sunday 11-01 at 2 a day: 6 left after Wednesday 12-02 evening.
const A = med("药品A", { perBox: 14, supplies: [["2026-11-01", 70]], daily: 2 });
// Nothing at home, only a reserve, which the visit list must ignore.
const B = med("药品B", { reserve: 100 });
const C = med("药品C", { supplies: [["2026-11-01", 200]] });
const input = (visits: string[]): ReportInput => ({
  medications: [A, B, C],
  visits: visits.map((date, i) => ({ id: i + 1, date })),
  stays: [],
  now: NOW,
});

describe("visit list", () => {
  it("counts the stock after Wednesday evening and covers the next 4 weeks", () => {
    const r = visitReport(input(["2026-12-03"]))!;
    expect(r).toMatchObject({ date: "2026-12-03", cutoff: "2026-12-02", coverUntil: "2026-12-30", days: 28, estimated: true });
    expect(r.needed.map((it) => it.medication.name)).toEqual(["药品A", "药品B"]);
    expect(r.covered.map((it) => it.medication.name)).toEqual(["药品C"]);

    const a = r.needed[0];
    expect(a.need).toMatchObject({ stockBefore: 6, demand: 56, need: 50, packs: 4, prescribed: 56 });
    expect(needText(a.need, a.medication)).toBe("4 盒（50 颗）");
    expect(prescriptionText(a.need, a.medication)).toBe("4 盒，共 56 颗（多 6 颗）");
    const reason = needReason(a, r, NOW);
    expect(reason).toBe("不够了：周三晚剩 6 颗，4 周需 56 颗，缺 50 颗");
    expect(gapWarning(a, r)).toBeNull();
  });

  it("leaves the reserve out", () => {
    const b = visitReport(input(["2026-12-03"]))!.needed[1];
    expect(b.need).toMatchObject({ stockBefore: 0, need: 28, packs: null });
    expect(needText(b.need, b.medication)).toBe("28 颗");
    expect(prescriptionText(b.need, b.medication)).toBe("28 颗");
    // It has already run out: the list says so, apart from the prescription.
    expect(gapWarning(b, visitReport(input(["2026-12-03"]))!)).toContain("等不到这次就诊");
  });

  it("covers up to the next entered visit, and picks a visit by date", () => {
    const r = visitReport(input(["2026-12-03", "2027-01-07"]))!;
    expect(r).toMatchObject({ coverUntil: "2027-01-06", days: 35, estimated: false, following: "2027-01-07" });
    expect(r.needed[0].need).toMatchObject({ need: 64, packs: 5 });

    const later = visitReport(input(["2026-12-03", "2027-01-07"]), "2027-01-07")!;
    expect(later).toMatchObject({ index: 1, cutoff: "2027-01-06", coverUntil: "2027-02-03" });
    expect(visitReport(input(["2026-12-03"]), "2026-12-10")).toBeNull();
    expect(visitReport(input([]))).toBeNull();
  });

  it("lists every supply as a purchase", () => {
    expect(purchaseLines(A, NOW.date)).toEqual(["2026.11.01 周日 购买 70 颗（5 盒）"]);
    // Less than a box: no pack count.
    expect(purchaseLines({ ...A, supplies: [{ id: 98, date: "2026-11-02", quantity: 10, packId: null, recordedAt: 0, fromReserve: false, source: null }] }, NOW.date)).toEqual([
      "2026.11.02 周一 购买 10 颗",
    ]);
    const planned = { ...C, supplies: [...C.supplies, { id: 99, date: "2026-11-20", quantity: 30, packId: null, recordedAt: 0, fromReserve: false, source: null }] };
    expect(purchaseLines(planned, NOW.date)).toEqual(["2026.11.01 周日 购买 200 颗", "2026.11.20 周五 计划购买 30 颗"]);
    const drawn = { ...A, supplies: [{ id: 97, date: "2026-11-02", quantity: 14, packId: null, recordedAt: 0, fromReserve: true, source: "从京东大药房购买了一盒" }] };
    expect(purchaseLines(drawn, NOW.date)).toEqual(["2026.11.02 周一 从储备取用 14 颗（1 盒），来源：从京东大药房购买了一盒"]);
    // Drawn before sources were recorded: just no source.
    const old = { ...A, supplies: [{ id: 96, date: "2026-11-02", quantity: 10, packId: null, recordedAt: 0, fromReserve: true, source: null }] };
    expect(purchaseLines(old, NOW.date)).toEqual(["2026.11.02 周一 从储备取用 10 颗"]);
  });
});

describe("medications not being taken", () => {
  // Stopped on 11-01 with stock left; and one with no regimen at all.
  const D = { ...med("药品D", { supplies: [["2026-10-01", 50]] }), regimens: [{ id: 90, effectiveFrom: "2026-10-01", morning: 1, noon: 0, evening: 0 }, { id: 91, effectiveFrom: "2026-11-01", morning: 0, noon: 0, evening: 0 }] };
  const E = { ...med("药品E"), regimens: [] };
  const withInactive: ReportInput = { ...input(["2026-12-03"]), medications: [D, A, E, B, C] };

  it("keeps them out of the visit list's tables", () => {
    const r = visitReport(withInactive)!;
    expect(r.needed.map((it) => it.medication.name)).toEqual(["药品A", "药品B"]);
    expect(r.covered.map((it) => it.medication.name)).toEqual(["药品C"]);
    expect(r.inactive.map((it) => [it.medication.name, it.intake.kind])).toEqual([
      ["药品D", "stopped"],
      ["药品E", "unset"],
    ]);
  });

  it("lists the ones being taken first", () => {
    expect(stockReport(withInactive).items.map((it) => [it.medication.name, it.taking])).toEqual([
      ["药品A", true],
      ["药品B", true],
      ["药品C", true],
      ["药品D", false],
      ["药品E", false],
    ]);
  });
});

describe("stock and reserve lists", () => {
  it("shows current stock without the reserve", () => {
    const r = stockReport(input(["2026-12-03"]));
    expect(r.nextVisit).toBe("2026-12-03");
    expect(r.items.map((it) => it.status.balanceNow)).toEqual([60, 0, 195]);
  });

  it("lists what is in reserve and how long it lasts", () => {
    const r = reserveReport(input([]));
    expect(r.items.map((it) => [it.medication.name, it.lasts])).toEqual([["药品B", "可用 100 天"]]);
    expect(r.empty.map((m) => m.name)).toEqual(["药品A", "药品C"]);
  });
});

describe("pdf", () => {
  it("renders the three lists, breaking long ones across pages", async () => {
    const { renderReservePdf, renderStockPdf, renderVisitPdf } = await import("./pdf");
    const many: ReportInput = {
      ...input(["2026-12-03"]),
      medications: Array.from({ length: 24 }, (_, i) =>
        med(`测试药品${i + 1}`, { perBox: 28, reserve: i % 3 ? 0 : 56, supplies: [["2026-11-01", 20 + i]] }),
      ),
    };
    const ctx = { input: many, generated: "2026.11.06 周五 08:00（北京时间）" };
    const pages = (pdf: Buffer) => pdf.toString("latin1").match(/\/Type \/Page\b/g)?.length ?? 0;

    const visit = await renderVisitPdf(visitReport(many)!, ctx);
    const stock = await renderStockPdf(stockReport(many), ctx);
    const reserve = await renderReservePdf(reserveReport(many), ctx);
    for (const pdf of [visit, stock, reserve]) expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pages(visit)).toBeGreaterThan(2);
    expect(pages(stock)).toBeGreaterThan(2);
    expect(pages(reserve)).toBeGreaterThanOrEqual(1);
  }, 30_000);
});

describe("manufacturers and tags", () => {
  const M: MedicationRecord = {
    ...med("氯硝西泮片", { perBox: 14 }),
    dosage: "2mg",
    brand: "湖南洞庭",
    packs: [
      { id: 7, brand: "湖南洞庭", packUnit: "盒", perBox: 14, reserve: 0 },
      { id: 8, brand: "江苏恩华", packUnit: "盒", perBox: 20, reserve: 0 },
    ],
    tags: ["psy2", "rx"],
    supplies: [{ id: 1, date: "2026-11-02", quantity: 40, packId: 8, recordedAt: 0, fromReserve: false, source: null }],
  };

  it("names every manufacturer and the one each purchase came from", () => {
    expect(medicationLabel(M)).toBe("氯硝西泮片 2mg · 湖南洞庭 / 江苏恩华");
    expect(purchaseLines(M, NOW.date)).toEqual(["2026.11.02 周一 购买 40 颗（2 盒 · 江苏恩华）"]);
  });

  it("splits the stock and the reserve by manufacturer, and names the one counted", () => {
    const N: MedicationRecord = {
      ...M,
      packs: [
        { id: 7, brand: "湖南洞庭", packUnit: "盒", perBox: 14, reserve: 28 },
        { id: 8, brand: "江苏恩华", packUnit: "盒", perBox: 20, reserve: 174 },
      ],
      reserve: 202,
      counts: [{ id: 3, date: "2026-11-03", slotsDone: 0, quantity: 30, recordedAt: 0, packId: 8 }],
    };
    const [item] = stockReport({ medications: [N], visits: [], stays: [], now: NOW }).items;
    // 湖南洞庭 has none, so every evening dose comes out of 江苏恩华: counted 30 on 11-03, then 3 evenings.
    expect(item.status.balanceNow).toBe(27);
    expect(packBreakdown(item, "stock")).toBe("湖南洞庭 0 颗；江苏恩华 27 颗（1 盒 7 颗）");
    expect(packBreakdown(item, "reserve")).toBe("湖南洞庭 28 颗（2 盒）；江苏恩华 174 颗（8 盒 14 颗）");
    expect(countLines(N)).toEqual(["2026.11.03 周二 早上服药前盘点（江苏恩华）：剩 30 颗"]);
    expect(packBreakdown({ ...item, medication: { ...N, packs: N.packs.slice(0, 1) } }, "reserve")).toBeNull();
  });

  it("counts the need in the other manufacturers' boxes too", () => {
    expect(otherPacksText({ need: 26 }, M)).toBe("或 江苏恩华 2 盒（40 颗）");
    expect(otherPacksText({ need: 0 }, M)).toBeNull();
  });
});

describe("printed tags", () => {
  it("keeps what limits getting the medication, 进口 and the user's own words", () => {
    expect(tagsText({ tags: ["psy2", "doping", "rx", "ins-a", "essential", "imported", "generic", "dark", "饭后吃"] })).toBe("精二 · 进口 · 饭后吃");
    expect(tagsText({ tags: ["rx", "ins-b", "essential"] })).toBe("");
  });
});
