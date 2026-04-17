import { useMemo, useState } from "react";
import { Banner, EmptyState, InlineLinkButton, LoadingState, PageHeader, Surface } from "../components/app-ui";
import { formatDate, formatNumber } from "../lib/format";
import { useAuth } from "../providers/auth";
import { useCoreData } from "../providers/core-data";

function normalizeDomain(value: string) {
  return value.trim().toLowerCase();
}

function isDomainValid(value: string) {
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(value);
}

export function BlacklistPage() {
  const { identity } = useAuth();
  const { emailExcludeList, loading, error, refresh, upsertEmailExcludeDomain, deleteEmailExcludeDomain } = useCoreData();

  const [query, setQuery] = useState("");
  const [newDomain, setNewDomain] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canManageBlacklist = identity?.role === "admin" || identity?.role === "super_admin";

  const filteredEntries = useMemo(() => {
    const search = query.trim().toLowerCase();
    return emailExcludeList
      .slice()
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .filter((item) => search.length === 0 || item.domain.toLowerCase().includes(search));
  }, [emailExcludeList, query]);

  async function addDomain() {
    const normalized = normalizeDomain(newDomain);
    if (!normalized || !isDomainValid(normalized)) return;

    setIsSubmitting(true);
    try {
      await upsertEmailExcludeDomain(normalized);
      setNewDomain("");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function removeDomain(domain: string) {
    setIsSubmitting(true);
    try {
      await deleteEmailExcludeDomain(domain);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!identity || identity.role === "client") {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Blacklist"
          subtitle="Global email blacklist is available for manager and admin roles only."
        />
        <Banner tone="warning">This module is not available in client shell.</Banner>
      </div>
    );
  }

  if (loading) {
    return <LoadingState />;
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Blacklist"
          subtitle="Global email exclusion list used by outreach operations and compliance checks."
        />
        <Banner tone="warning">{error}</Banner>
        <InlineLinkButton
          onClick={() => {
            void refresh();
          }}
        >
          Retry data sync
        </InlineLinkButton>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Blacklist"
        subtitle="Global exclude-domain list used to block sending to restricted domains."
        actions={
          <div className="rounded-2xl border border-border bg-black/10 px-4 py-3 text-sm">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Entries</p>
            <p className="mt-1 text-xl">{formatNumber(emailExcludeList.length)}</p>
          </div>
        }
      />

      {!canManageBlacklist && (
        <Banner tone="info">You have read-only access. Only admin roles can add or remove blacklist entries.</Banner>
      )}

      <Surface title="Exclude list" subtitle="Domains listed here are blocked in sending workflows.">
        <div className="mb-4 flex flex-wrap gap-3">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search excluded domain"
            className="min-w-[16rem] flex-1 rounded-2xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm outline-none"
          />

          {canManageBlacklist && (
            <div className="flex min-w-[18rem] flex-1 gap-3">
              <input
                value={newDomain}
                onChange={(event) => setNewDomain(event.target.value)}
                placeholder="example.com"
                aria-label="New blacklist domain"
                className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm outline-none"
              />
              <button
                onClick={() => {
                  void addDomain();
                }}
                disabled={isSubmitting || !isDomainValid(normalizeDomain(newDomain))}
                className="rounded-full border border-sky-400/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-100 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Add domain
              </button>
            </div>
          )}
        </div>

        {filteredEntries.length === 0 ? (
          <EmptyState
            title="No blacklist entries"
            description="Add blocked domains to prevent send flows from targeting excluded recipients."
          />
        ) : (
          <div className="space-y-2">
            {filteredEntries.map((entry) => (
              <div
                key={entry.domain}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-black/10 px-4 py-3"
              >
                <div>
                  <p className="text-sm">{entry.domain}</p>
                  <p className="text-xs text-muted-foreground">Added: {formatDate(entry.created_at)}</p>
                </div>
                {canManageBlacklist && (
                  <button
                    onClick={() => {
                      void removeDomain(entry.domain);
                    }}
                    disabled={isSubmitting}
                    className="rounded-full border border-border px-3 py-1.5 text-xs text-foreground transition hover:border-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Remove domain
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Surface>
    </div>
  );
}
