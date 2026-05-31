import { useCallback, useEffect, useRef, useState } from "react";
import { repository, RepositoryError } from "../data/repository";
import type { LeadsListParams, LeadsListResponse, LeadDetailResult } from "../types/view-contracts";
import type { ReplyRecord } from "../types/core";

export function mapLeadsError(reason: unknown): string {
  if (reason instanceof RepositoryError) {
    if (reason.kind === "timeout") return "Loading timed out. A database performance issue may be affecting this view.";
    if (reason.kind === "permission") return "Access to lead data is blocked by your current permissions.";
    if (reason.kind === "network") return "Lead data could not be loaded due to a network error. Try again.";
    return reason.message;
  }
  if (reason instanceof Error) return reason.message;
  return "Failed to load lead data.";
}

/** Fetches a server-paginated/filtered leads list. Re-fetches whenever params change. */
export function useLeadsList(params: LeadsListParams) {
  const [data, setData] = useState<LeadsListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Serialize params to avoid effect identity issues.
  const paramsKey = JSON.stringify(params);

  const load = useCallback(async (p: LeadsListParams) => {
    setLoading(true);
    try {
      const result = await repository.loadLeadsList(p);
      setData(result);
      setError(null);
    } catch (reason) {
      setError(mapLeadsError(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(params); }, [paramsKey]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const refresh = useCallback(() => { void load(params); }, [load, paramsKey]);

  return { data, loading, error, refresh };
}

/** Lazily fetches the reply thread for a single lead when the drawer opens. */
export function useLeadDetail(leadId: string | null): { replies: ReplyRecord[]; loading: boolean } {
  const [replies, setReplies] = useState<ReplyRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (!leadId) { setReplies([]); return; }
    cancelRef.current = false;
    setLoading(true);
    setReplies([]);
    repository.loadLeadDetail(leadId)
      .then((result: LeadDetailResult) => { if (!cancelRef.current) setReplies(result.replies); })
      .catch(() => { /* replies missing is non-fatal — show empty */ })
      .finally(() => { if (!cancelRef.current) setLoading(false); });
    return () => { cancelRef.current = true; };
  }, [leadId]);

  return { replies, loading };
}
