import { describe, expect, it } from "vitest";
import { computeStageBands, stickyLeftOffsets } from "../table-grid";

describe("computeStageBands", () => {
  const label = (s: string) => s.toUpperCase();

  it("collapses consecutive same-stage columns into bands with correct span + startIndex", () => {
    const cols = [
      { stage: "lead" }, { stage: "lead" },
      { stage: "qualification" },
      { stage: "offering" }, { stage: "offering" }, { stage: "offering" },
    ];
    const bands = computeStageBands(cols, label);
    expect(bands).toEqual([
      { stage: "lead", label: "LEAD", span: 2, startIndex: 0 },
      { stage: "qualification", label: "QUALIFICATION", span: 1, startIndex: 2 },
      { stage: "offering", label: "OFFERING", span: 3, startIndex: 3 },
    ]);
  });

  it("total span equals column count", () => {
    const cols = [{ stage: "a" }, { stage: "b" }, { stage: "b" }];
    expect(computeStageBands(cols, label).reduce((n, b) => n + b.span, 0)).toBe(cols.length);
  });

  it("empty input → no bands", () => {
    expect(computeStageBands([] as { stage: string }[], label)).toEqual([]);
  });
});

describe("stickyLeftOffsets", () => {
  it("returns cumulative offsets for the first N columns", () => {
    expect(stickyLeftOffsets([170, 170, 130, 190], 2)).toEqual([0, 170]);
    expect(stickyLeftOffsets([100, 50, 80], 3)).toEqual([0, 100, 150]);
  });

  it("count 0 → empty", () => {
    expect(stickyLeftOffsets([100], 0)).toEqual([]);
  });
});
