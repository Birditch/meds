import { describe, expect, it } from "vitest";
import { searchMedications } from "./search";

const meds = [
  { name: "阿莫西林胶囊", brand: "联邦", dosage: "0.25g", searchKeys: ["amoxilinjiaonang", "amxljn", "lianbang", "lb"] },
  { name: "阿托伐他汀钙片", brand: "立普妥", dosage: "20mg", searchKeys: ["atuofatatinggaipian", "atfttgp", "liputuo", "lpt"] },
  { name: "Metformin", brand: null, dosage: "500mg", searchKeys: [] },
];
const names = (q: string) => searchMedications(meds, q).map((m) => m.name);

describe("searchMedications", () => {
  it("returns everything for an empty query", () => {
    expect(names("  ")).toHaveLength(3);
  });
  it("matches substrings of name, brand and dosage", () => {
    expect(names("他汀")).toEqual(["阿托伐他汀钙片"]);
    expect(names("立普")).toEqual(["阿托伐他汀钙片"]);
    expect(names("500")).toEqual(["Metformin"]);
    expect(names("METF")).toEqual(["Metformin"]);
  });
  it("matches out-of-order gaps as a subsequence", () => {
    expect(names("阿林")).toEqual(["阿莫西林胶囊"]);
    expect(names("mfm")).toEqual(["Metformin"]);
  });
  it("matches pinyin and pinyin initials", () => {
    expect(names("amxl")).toEqual(["阿莫西林胶囊"]);
    expect(names("tating")).toEqual(["阿托伐他汀钙片"]);
    expect(names("lpt")).toEqual(["阿托伐他汀钙片"]);
  });
  it("requires every term and ranks prefix matches first", () => {
    expect(names("阿 20mg")).toEqual(["阿托伐他汀钙片"]);
    expect(names("a")[0]).toBe("阿莫西林胶囊"); // both start with "a"; original order breaks the tie
    expect(names("zzz")).toEqual([]);
  });
});
