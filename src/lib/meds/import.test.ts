import { describe, expect, it } from "vitest";
import { importTemplate, matchEntry, parseImportText, resolveImportAmount, type ImportCandidate } from "./import";

const one = (line: string) => {
  const [e] = parseImportText(line);
  return e;
};

describe("parseImportText", () => {
  it("reads the template format back", () => {
    expect(one("他克莫司胶囊，普乐可复，1mg，每盒50颗，余 3 盒 12 颗，储备 2 盒，早1 中0 晚1")).toMatchObject({
      name: "他克莫司胶囊",
      brand: "普乐可复",
      dosage: "1mg",
      packUnit: "盒",
      perBox: 50,
      stock: { packs: 3, pills: 12 },
      reserve: { packs: 2, pills: 0 },
      regimen: { morning: 1, noon: 0, evening: 1 },
      warnings: [],
    });
  });

  it("reads free text: spaces, full-width digits, brand in brackets, blister packs", () => {
    expect(one("1. 阿托伐他汀钙片（立普妥） 20mg 7片×2板 剩 ２０ 片")).toMatchObject({
      name: "阿托伐他汀钙片",
      brand: "立普妥",
      dosage: "20mg",
      perBox: 14,
      stock: { packs: 0, pills: 20 },
      reserve: null,
      regimen: null,
    });
    expect(one("吗替麦考酚酯 0.25g×40粒/瓶 余 86 储备 1瓶 早晚各2粒")).toMatchObject({
      name: "吗替麦考酚酯",
      dosage: "0.25g",
      packUnit: "瓶",
      perBox: 40,
      stock: { packs: 0, pills: 86 },
      reserve: { packs: 1, pills: 0 },
      regimen: { morning: 2, noon: 0, evening: 2 },
    });
    expect(one("维生素D3 800iu 30片/盒 2盒")).toMatchObject({ name: "维生素D3", dosage: "800iu", perBox: 30, stock: { packs: 2, pills: 0 } });
  });

  it("leaves the pack size empty when the line does not say it", () => {
    const e = one("硝苯地平控释片 30mg 3盒 储备 10片");
    expect(e).toMatchObject({ perBox: null, packUnit: "盒", stock: { packs: 3, pills: 0 }, reserve: { packs: 0, pills: 10 } });
  });

  it("warns about numbers it cannot place and skips blank and comment lines", () => {
    const entries = parseImportText("# 11 月盘点\n\n药品A 10mg 3\n// 备注\n");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ line: 3, name: "药品A", stock: null, warnings: ["「3」没有单位，没能识别"] });
    expect(one("余 3盒").warnings).toEqual(["没有识别出药名"]);
  });
});

describe("matchEntry", () => {
  const meds: ImportCandidate[] = [
    { id: 1, name: "他克莫司胶囊", brand: "普乐可复", dosage: "1mg", searchKeys: ["takemosijiaonang", "tkmsjn"] },
    { id: 2, name: "他克莫司胶囊", brand: "普乐可复", dosage: "0.5mg" },
    { id: 3, name: "阿托伐他汀钙片", brand: "立普妥", dosage: "20mg" },
  ];
  const e = (name: string, dosage: string | null = null, brand: string | null = null) => ({ name, dosage, brand });

  it("matches by name, brand, part of the name or pinyin, narrowed by dosage", () => {
    expect(matchEntry(e("他克莫司胶囊", "1mg"), meds)).toEqual({ kind: "match", id: 1 });
    expect(matchEntry(e("他克莫司", "0.5 MG"), meds)).toEqual({ kind: "match", id: 2 });
    expect(matchEntry(e("立普妥"), meds)).toEqual({ kind: "match", id: 3 });
    expect(matchEntry(e("tkmsjn", "1mg"), meds)).toEqual({ kind: "match", id: 1 });
  });

  it("asks when several fit and treats another dosage as a new medication", () => {
    expect(matchEntry(e("他克莫司"), meds)).toEqual({ kind: "ambiguous", ids: [1, 2] });
    expect(matchEntry(e("他克莫司", "5mg"), meds)).toEqual({ kind: "none", similar: [1, 2] });
    expect(matchEntry(e("硝苯地平"), meds)).toEqual({ kind: "none", similar: [] });
  });
});

describe("resolveImportAmount", () => {
  it("adds packs and loose pills, empty meaning unchanged", () => {
    expect(resolveImportAmount("3", "12", 50)).toEqual({ value: 162 });
    expect(resolveImportAmount("", "7.5", null)).toEqual({ value: 7.5 });
    expect(resolveImportAmount("", "", 50)).toEqual({ value: null });
    expect(resolveImportAmount("0", "", 50)).toEqual({ value: 0 });
  });

  it("needs the pack size to count packs", () => {
    expect(resolveImportAmount("2", "", null, "瓶")).toEqual({ error: "未写明每瓶颗数，无法按瓶计算" });
    expect(resolveImportAmount("", "1.2", 30)).toEqual({ error: "颗数只能是整数或 0.5 的倍数" });
  });
});

describe("importTemplate", () => {
  it("writes each medication on one line that parses back to the same values", () => {
    const text = importTemplate([
      {
        name: "药品A",
        brand: "辉瑞",
        dosage: "10mg",
        packUnit: "瓶",
        perBox: 30,
        stock: 100,
        reserve: 0,
        regimen: { morning: 1, noon: 0, evening: 1 },
      },
      { name: "药品B", brand: null, dosage: "5mg", packUnit: "盒", perBox: null, stock: 12.5, reserve: 20, regimen: null },
    ]);
    expect(text).toBe("药品A，辉瑞，10mg，每瓶30颗，余 3 瓶 10 颗，储备 0 颗，早1 中0 晚1\n药品B，5mg，余 12.5 颗，储备 20 颗");
    const [a, b] = parseImportText(text);
    expect(a).toMatchObject({ name: "药品A", brand: "辉瑞", perBox: 30, packUnit: "瓶", stock: { packs: 3, pills: 10 }, reserve: { packs: 0, pills: 0 } });
    expect(b).toMatchObject({ name: "药品B", brand: null, dosage: "5mg", perBox: null, stock: { packs: 0, pills: 12.5 }, reserve: { packs: 0, pills: 20 } });
  });
});
