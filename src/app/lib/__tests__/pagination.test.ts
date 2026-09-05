import { describe, expect, it } from "vitest";
import { buildPageWindow, clampPage, MAX_PAGE_LINKS } from "../pagination";

describe("clampPage", () => {
  it("keeps a page inside the available range", () => {
    expect(clampPage(0, 5)).toBe(1);
    expect(clampPage(3, 5)).toBe(3);
    expect(clampPage(9, 5)).toBe(5);
  });

  it("falls back to page 1 for an empty list", () => {
    expect(clampPage(4, 0)).toBe(1);
  });
});

describe("buildPageWindow", () => {
  it("lists every page when they fit", () => {
    expect(buildPageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(buildPageWindow(2, MAX_PAGE_LINKS)).toEqual([1, 2, 3, 4, 5]);
  });

  it("centres the window on the current page and pins it at the edges", () => {
    expect(buildPageWindow(1, 12)).toEqual([1, 2, 3, 4, 5]);
    expect(buildPageWindow(7, 12)).toEqual([5, 6, 7, 8, 9]);
    expect(buildPageWindow(12, 12)).toEqual([8, 9, 10, 11, 12]);
  });
});
