import { describe, expect, it } from "vitest";
import { getCustomFieldSortValue, parseNumericValue } from "../custom-field-sort";
import type { ClientCustomFieldType } from "../../types/core";

function field(field_type: ClientCustomFieldType, options?: string[] | null) {
  return { field_type, options };
}

describe("parseNumericValue", () => {
  it("parses plain integers and decimals", () => {
    expect(parseNumericValue("8000")).toBe(8000);
    expect(parseNumericValue("8.50")).toBe(8.5);
    expect(parseNumericValue("0")).toBe(0);
  });

  it("strips currency symbols and codes", () => {
    expect(parseNumericValue("8000 zl")).toBe(8000);
    expect(parseNumericValue("8000 zł")).toBe(8000);
    expect(parseNumericValue("10000 PLN")).toBe(10000);
    expect(parseNumericValue("€1000")).toBe(1000);
    expect(parseNumericValue("$1,000")).toBe(1000);
    expect(parseNumericValue("£250.75")).toBe(250.75);
  });

  it("handles space and comma thousands grouping", () => {
    expect(parseNumericValue("12 000 zł")).toBe(12000);
    expect(parseNumericValue("12,000 PLN")).toBe(12000);
    expect(parseNumericValue("1,234,567")).toBe(1234567);
  });

  it("infers decimal vs thousands when both separators present", () => {
    expect(parseNumericValue("1,234.56")).toBe(1234.56);
    expect(parseNumericValue("1.234,56 €")).toBe(1234.56);
  });

  it("treats a short comma group as a decimal", () => {
    expect(parseNumericValue("12,50")).toBe(12.5);
  });

  it("returns null for empty or non-numeric input", () => {
    expect(parseNumericValue("")).toBeNull();
    expect(parseNumericValue("   ")).toBeNull();
    expect(parseNumericValue("abc")).toBeNull();
    expect(parseNumericValue(null)).toBeNull();
  });
});

describe("getCustomFieldSortValue", () => {
  it("text: lowercases, empty → null", () => {
    expect(getCustomFieldSortValue(field("text"), "Hello")).toBe("hello");
    expect(getCustomFieldSortValue(field("text"), "")).toBeNull();
    expect(getCustomFieldSortValue(field("text"), null)).toBeNull();
    // text is never coerced to a number
    expect(getCustomFieldSortValue(field("text"), "8000 zl")).toBe("8000 zl");
  });

  it("checkbox: true → 1, false → 0, empty → null", () => {
    expect(getCustomFieldSortValue(field("checkbox"), "true")).toBe(1);
    expect(getCustomFieldSortValue(field("checkbox"), "false")).toBe(0);
    expect(getCustomFieldSortValue(field("checkbox"), "")).toBeNull();
  });

  it("droplist: sorts by option order, unknown after known, empty → null", () => {
    const f = field("droplist", ["S1", "S2", "S3"]);
    expect(getCustomFieldSortValue(f, "S1")).toBe(0);
    expect(getCustomFieldSortValue(f, "S2")).toBe(1);
    expect(getCustomFieldSortValue(f, "S3")).toBe(2);
    expect(getCustomFieldSortValue(f, "??")).toBe(3); // unknown → options.length
    expect(getCustomFieldSortValue(f, "")).toBeNull();
  });

  it("number / currency: numeric parse, invalid → null", () => {
    expect(getCustomFieldSortValue(field("number"), "100")).toBe(100);
    expect(getCustomFieldSortValue(field("number"), "abc")).toBeNull();
    expect(getCustomFieldSortValue(field("currency"), "8000 zl")).toBe(8000);
    expect(getCustomFieldSortValue(field("currency"), "10000 zl")).toBe(10000);
    expect(getCustomFieldSortValue(field("currency"), "12 000 zł")).toBe(12000);
    expect(getCustomFieldSortValue(field("currency"), "")).toBeNull();
  });

  it("currency values order numerically, not lexicographically", () => {
    const f = field("currency");
    const vals = ["8000 zl", "10000 PLN", "12 000 zł", "900 zl"];
    const sorted = vals
      .map((v) => ({ v, n: getCustomFieldSortValue(f, v) as number }))
      .sort((a, b) => a.n - b.n)
      .map((x) => x.v);
    expect(sorted).toEqual(["900 zl", "8000 zl", "10000 PLN", "12 000 zł"]);
  });

  it("link: normalized lowercase, empty → null", () => {
    expect(getCustomFieldSortValue(field("link"), "HTTPS://A.com")).toBe("https://a.com");
    expect(getCustomFieldSortValue(field("link"), "")).toBeNull();
  });
});
