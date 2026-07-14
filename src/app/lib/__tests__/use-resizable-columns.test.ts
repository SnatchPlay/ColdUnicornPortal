import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useResizableColumns } from "../use-resizable-columns";

const KEY = "table:test:columns";

function widthsOf(template: string) {
  return template.split(" ").map((segment) => Number.parseInt(segment, 10));
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("useResizableColumns — dynamic column set (persist by id)", () => {
  it("keeps a saved width attached to its own column when the columns are reordered", () => {
    // The clients mega-table lets a master_admin reorder columns. With a positional
    // array the saved widths stayed bolted to the index, so reordering silently swapped
    // them between columns — the reported "columns living their own life".
    window.localStorage.setItem(KEY, JSON.stringify({ name: 300, notes: 80 }));

    const { result } = renderHook(() =>
      useResizableColumns({
        storageKey: KEY,
        defaultWidths: [120, 120],
        columnIds: ["notes", "name"], // order flipped vs. what was saved
      }),
    );

    expect(widthsOf(result.current.template)).toEqual([80, 300]);
  });

  it("keeps the other columns' widths when a column is added or removed", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ name: 300, bi_setup: 34, notes: 80 }));

    // `bi_setup` is gone and a custom field appeared — the count changed, which used to
    // invalidate the whole saved layout and reset every column to its default.
    const { result } = renderHook(() =>
      useResizableColumns({
        storageKey: KEY,
        defaultWidths: [150, 150, 150],
        columnIds: ["name", "notes", "cf:new-field"],
      }),
    );

    expect(widthsOf(result.current.template)).toEqual([300, 80, 150]);
  });

  it("persists a resize under the column's id", () => {
    const { result, rerender } = renderHook(
      (props: { columnIds: string[] }) =>
        useResizableColumns({
          storageKey: KEY,
          defaultWidths: [100, 100],
          minWidths: [40, 40],
          columnIds: props.columnIds,
        }),
      { initialProps: { columnIds: ["name", "notes"] } },
    );

    act(() => {
      const down = result.current.getResizeMouseDown(1);
      down({ preventDefault() {}, stopPropagation() {}, clientX: 0 } as never);
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 60 }));
      window.dispatchEvent(new MouseEvent("mouseup"));
    });

    expect(JSON.parse(window.localStorage.getItem(KEY) ?? "{}")).toMatchObject({ notes: 160 });

    // The widened column keeps its width after the column set changes around it.
    rerender({ columnIds: ["extra", "name", "notes"] });
    expect(widthsOf(result.current.template).at(-1)).toBe(160);
  });

  it("falls back to defaults for a column it has never seen", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ name: 300 }));

    const { result } = renderHook(() =>
      useResizableColumns({
        storageKey: KEY,
        defaultWidths: [120, 44],
        columnIds: ["name", "cf:brand-new"],
      }),
    );

    expect(widthsOf(result.current.template)).toEqual([300, 44]);
  });

  it("ignores a stored width that is not a usable number", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ name: 0, notes: "wide" }));

    const { result } = renderHook(() =>
      useResizableColumns({
        storageKey: KEY,
        defaultWidths: [120, 90],
        columnIds: ["name", "notes"],
      }),
    );

    expect(widthsOf(result.current.template)).toEqual([120, 90]);
  });
});

describe("useResizableColumns — fixed column set (positional array)", () => {
  it("still restores a positional array when no columnIds are given", () => {
    // campaigns / domains / invoices / leads tables have a static column set.
    window.localStorage.setItem(KEY, JSON.stringify([200, 90]));

    const { result } = renderHook(() =>
      useResizableColumns({ storageKey: KEY, defaultWidths: [120, 120] }),
    );

    expect(widthsOf(result.current.template)).toEqual([200, 90]);
  });

  it("rejects a positional array of the wrong length", () => {
    window.localStorage.setItem(KEY, JSON.stringify([200, 90, 70]));

    const { result } = renderHook(() =>
      useResizableColumns({ storageKey: KEY, defaultWidths: [120, 120] }),
    );

    expect(widthsOf(result.current.template)).toEqual([120, 120]);
  });
});
