import { describe, expect, it } from "vitest";
import { drugKey, drugName, findSimilar, sameDosage } from "./similar";

const med = (id: number, name: string, dosage: string, brands: (string | null)[] = [null], searchKeys: string[] = []) => ({
  id,
  name,
  dosage,
  brand: brands[0],
  packs: brands.map((brand) => ({ brand })),
  searchKeys,
});

const meds = [
  med(13, "帕利哌酮缓释片", "6mg", ["芮达"]),
  med(15, "帕利哌酮缓释片", "3mg", ["芮达"]),
  med(14, "盐酸普萘洛尔片", "10mg"),
  med(3, "盐酸普萘洛尔缓释片", "40"),
  med(16, "氯硝西泮片", "2mg", ["湖南洞庭"]),
  med(10, "多西环素", "0.1g", ["永喜"], ["duoxihuansu", "dxhs"]),
];

describe("drugName", () => {
  it("splits off the salt and the dosage form", () => {
    expect(drugName("盐酸普萘洛尔缓释片")).toEqual({ core: "普萘洛尔", form: "缓释片" });
    expect(drugName("盐酸普萘洛尔片")).toEqual({ core: "普萘洛尔", form: "片" });
    expect(drugName("注射用头孢曲松钠")).toEqual({ core: "头孢曲松", form: "注射剂" });
    expect(drugName("多西环素")).toEqual({ core: "多西环素", form: "" });
  });
  it("keys strengths of one drug together, and forms apart", () => {
    expect(drugKey("帕利哌酮缓释片")).toBe(drugKey("帕利哌酮 缓释片"));
    expect(drugKey("盐酸普萘洛尔片")).not.toBe(drugKey("盐酸普萘洛尔缓释片"));
  });
});

describe("sameDosage", () => {
  it("compares mass with units", () => {
    expect(sameDosage("0.1g", "100mg")).toBe(true);
    expect(sameDosage("2mg", "2 mg")).toBe(true);
    expect(sameDosage("1mg×50粒", "1mg")).toBe(true);
    expect(sameDosage("0.5mg", "5mg")).toBe(false);
    expect(sameDosage("3mg", "6mg")).toBe(false);
    expect(sameDosage("40", "40mg")).toBe(true);
  });
});

describe("findSimilar", () => {
  const kinds = (input: Parameters<typeof findSimilar>[0]) => findSimilar(input, meds).map((m) => [m.medication.id, m.kind]);

  it("finds the same medication from another manufacturer", () => {
    const [hit] = findSimilar({ name: "氯硝西泮片", dosage: "2mg", brand: "江苏恩华" }, meds);
    expect(hit).toMatchObject({ kind: "same", samePack: false });
    expect(hit.medication.id).toBe(16);
    expect(findSimilar({ name: "氯硝西泮", dosage: "2mg", brand: "湖南洞庭" }, meds)[0]).toMatchObject({ kind: "same", samePack: true });
  });
  it("tells another strength from the same one", () => {
    expect(kinds({ name: "帕利哌酮缓释片", dosage: "9mg" })).toEqual([
      [13, "strength"],
      [15, "strength"],
    ]);
    expect(kinds({ name: "帕利哌酮缓释片", dosage: "3mg" })[0]).toEqual([15, "same"]);
    expect(kinds({ name: "帕利哌酮缓释片" })).toEqual([
      [13, "drug"],
      [15, "drug"],
    ]);
  });
  it("flags another dosage form of the same ingredient", () => {
    expect(kinds({ name: "普萘洛尔片", dosage: "10mg" })).toEqual([
      [14, "same"],
      [3, "form"],
    ]);
  });
  it("matches partial names, brands and pinyin", () => {
    expect(kinds({ name: "帕利" }).map(([id]) => id)).toEqual([13, 15]);
    expect(kinds({ name: "芮达" }).map(([id]) => id)).toEqual([13, 15]);
    expect(kinds({ name: "dxhs" })).toEqual([[10, "similar"]]);
    expect(kinds({ name: "阿莫西林" })).toEqual([]);
  });
});
