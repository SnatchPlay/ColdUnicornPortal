import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLeadViewModeList } from "../use-lead-crm";
import type { LeadsListParams } from "../../types/view-contracts";

const loadLeadsList = vi.fn();
const loadLeadCrmList = vi.fn();

vi.mock("../../data/repository", () => ({
  RepositoryError: class extends Error {},
  repository: {
    loadLeadsList: (p: LeadsListParams) => loadLeadsList(p),
    loadLeadCrmList: (p: LeadsListParams) => loadLeadCrmList(p),
  },
}));

const params = (over: Partial<LeadsListParams> = {}): LeadsListParams => ({
  sortField: "created", sortDir: "desc", page: 1, pageSize: 50, ...over,
});

const listResponse = (tag: string) => ({ rows: [{ id: tag }], totalCount: 1, stageCounts: {}, customFields: [], customValues: [] });
const crmResponse = (tag: string) => ({ ...listResponse(tag), asOf: "2026-09-01T00:00:00.000Z", businessDays: { timeZone: "UTC" } });

describe("useLeadViewModeList", () => {
  beforeEach(() => {
    loadLeadsList.mockReset().mockResolvedValue(listResponse("pdca"));
    loadLeadCrmList.mockReset().mockResolvedValue(crmResponse("crm"));
  });

  it("fetches only the active mode's action", async () => {
    const { result } = renderHook(() => useLeadViewModeList(params(), "pdca"));
    await waitFor(() => expect(result.current.data?.rows[0].id).toBe("pdca"));
    expect(loadLeadCrmList).not.toHaveBeenCalled();
    expect(result.current.isCrmView).toBe(false);
  });

  it("CRM and Combined read the same action, and switching between them does not re-fetch", async () => {
    const { result, rerender } = renderHook(({ mode }) => useLeadViewModeList(params(), mode), {
      initialProps: { mode: "crm" as const },
    });
    await waitFor(() => expect(result.current.data?.rows[0].id).toBe("crm"));
    expect(loadLeadCrmList).toHaveBeenCalledTimes(1);

    await act(async () => { rerender({ mode: "combined" as unknown as "crm" }); });
    expect(loadLeadCrmList).toHaveBeenCalledTimes(1);
    expect(result.current.data?.rows[0].id).toBe("crm");
  });

  it("keeps a still-valid cache across a mode switch, and reports it as current", async () => {
    const { result, rerender } = renderHook(({ mode }) => useLeadViewModeList(params(), mode), {
      initialProps: { mode: "crm" as const },
    });
    await waitFor(() => expect(result.current.isDataCurrent).toBe(true));

    await act(async () => { rerender({ mode: "pdca" as unknown as "crm" }); });
    await waitFor(() => expect(result.current.data?.rows[0].id).toBe("pdca"));

    // Back to CRM with the SAME params: the cached response is still valid, so it is shown at once.
    await act(async () => { rerender({ mode: "crm" as unknown as "crm" }); });
    expect(result.current.data?.rows[0].id).toBe("crm");
    expect(result.current.isDataCurrent).toBe(true);
  });

  it("drops a cache that went stale while the loader was switched off", async () => {
    const { result, rerender } = renderHook(
      ({ mode, search }) => useLeadViewModeList(params({ search }), mode),
      { initialProps: { mode: "crm" as const, search: undefined as string | undefined } },
    );
    await waitFor(() => expect(result.current.data?.rows[0].id).toBe("crm"));

    // Filter moves while CRM is off — its cached rows now answer a query nobody asked for.
    await act(async () => { rerender({ mode: "pdca" as unknown as "crm", search: "acme" }); });
    await waitFor(() => expect(result.current.data?.rows[0].id).toBe("pdca"));

    // Hold the next CRM response open so the intermediate state is observable.
    let release: (value: unknown) => void = () => {};
    loadLeadCrmList.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    await act(async () => { rerender({ mode: "crm" as unknown as "crm", search: "acme" }); });
    expect(result.current.data).toBeNull(); // the stale response never paints
    expect(result.current.loading).toBe(true);

    await act(async () => { release(crmResponse("crm-filtered")); });
    await waitFor(() => expect(result.current.data?.rows[0].id).toBe("crm-filtered"));
    expect(result.current.isDataCurrent).toBe(true);
  });
});
