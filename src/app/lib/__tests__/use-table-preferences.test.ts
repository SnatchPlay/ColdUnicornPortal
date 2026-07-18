import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTablePreferences } from "../use-table-preferences";
import { repository } from "../../data/repository";

vi.mock("../../data/repository", () => ({
  repository: {
    loadTablePreferences: vi.fn(),
    saveTablePreferences: vi.fn(),
  },
}));

const mockedRepo = vi.mocked(repository as unknown as {
  loadTablePreferences: ReturnType<typeof vi.fn>;
  saveTablePreferences: ReturnType<typeof vi.fn>;
});

const TABLE = "clients:mega";
const CACHE = `table-prefs:${TABLE}`;

interface Prefs extends Record<string, unknown> {
  widths: Record<string, number>;
  healthFilter: string;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  window.localStorage.clear();
  mockedRepo.loadTablePreferences.mockResolvedValue({ tableKey: TABLE, preferences: null, updatedAt: null });
  mockedRepo.saveTablePreferences.mockResolvedValue({ tableKey: TABLE, preferences: {}, updatedAt: null });
});

describe("useTablePreferences", () => {
  it("paints from the localStorage cache on the first frame, before the server answers", () => {
    window.localStorage.setItem(CACHE, JSON.stringify({ healthFilter: "danger" }));
    let resolveLoad: (value: unknown) => void = () => {};
    mockedRepo.loadTablePreferences.mockReturnValue(new Promise((resolve) => { resolveLoad = resolve; }));

    const { result } = renderHook(() => useTablePreferences<Prefs>(TABLE));

    // The round-trip has not settled, yet the layout is already there.
    expect(result.current.preferences.healthFilter).toBe("danger");
    expect(result.current.loaded).toBe(false);
    resolveLoad({ tableKey: TABLE, preferences: null, updatedAt: null });
  });

  it("lets the stored row replace the cache once it lands", async () => {
    window.localStorage.setItem(CACHE, JSON.stringify({ healthFilter: "danger" }));
    mockedRepo.loadTablePreferences.mockResolvedValue({
      tableKey: TABLE,
      preferences: { healthFilter: "healthy", widths: { name: 300 } },
      updatedAt: "2026-07-14T00:00:00Z",
    });

    const { result } = renderHook(() => useTablePreferences<Prefs>(TABLE));

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.preferences.healthFilter).toBe("healthy");
    expect(result.current.preferences.widths).toEqual({ name: 300 });
    // The DB copy is cached, so the next mount still paints instantly.
    expect(JSON.parse(window.localStorage.getItem(CACHE) ?? "{}")).toMatchObject({ healthFilter: "healthy" });
  });

  it("debounces writes so a drag does not become a gateway call per pixel", async () => {
    const { result } = renderHook(() => useTablePreferences<Prefs>(TABLE));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.update({ widths: { name: 200 } });
      result.current.update({ widths: { name: 240 } });
      result.current.update({ widths: { name: 280 } });
    });

    // Cached immediately, but not yet sent.
    expect(JSON.parse(window.localStorage.getItem(CACHE) ?? "{}").widths).toEqual({ name: 280 });
    expect(mockedRepo.saveTablePreferences).not.toHaveBeenCalled();

    // Only the final value reaches the gateway, once.
    await waitFor(() => expect(mockedRepo.saveTablePreferences).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(mockedRepo.saveTablePreferences).toHaveBeenCalledWith(TABLE, { widths: { name: 280 } });
  });

  it("promotes a cache-only layout to the server when the user has no stored row yet", async () => {
    window.localStorage.setItem(CACHE, JSON.stringify({ widths: { name: 300 } }));
    mockedRepo.loadTablePreferences.mockResolvedValue({ tableKey: TABLE, preferences: null, updatedAt: null });

    const { result } = renderHook(() => useTablePreferences<Prefs>(TABLE));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await waitFor(() =>
      expect(mockedRepo.saveTablePreferences).toHaveBeenCalledWith(TABLE, { widths: { name: 300 } }),
    );
  });

  it("stays usable when the gateway does not know the action yet", async () => {
    // e.g. the edge function has not been deployed. The table must still work off the cache.
    window.localStorage.setItem(CACHE, JSON.stringify({ healthFilter: "danger" }));
    mockedRepo.loadTablePreferences.mockRejectedValue(new Error("unknown action"));
    mockedRepo.saveTablePreferences.mockRejectedValue(new Error("unknown action"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { result } = renderHook(() => useTablePreferences<Prefs>(TABLE));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    expect(result.current.preferences.healthFilter).toBe("danger");

    act(() => result.current.update({ healthFilter: "healthy" }));
    expect(result.current.preferences.healthFilter).toBe("healthy");
    await waitFor(() => expect(warn).toHaveBeenCalled(), { timeout: 2000 });
    warn.mockRestore();
  });

  it("survives a repository that does not implement the action at all", async () => {
    // A synchronous throw inside the hook would otherwise escape as an uncaught error and
    // take the whole page down with it.
    mockedRepo.loadTablePreferences.mockImplementation(() => {
      throw new TypeError("repository.loadTablePreferences is not a function");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { result } = renderHook(() => useTablePreferences<Prefs>(TABLE));

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.preferences).toEqual({});
    warn.mockRestore();
  });
});
