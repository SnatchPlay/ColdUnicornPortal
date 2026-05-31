import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Banner, EmptyState, InlineLinkButton, LoadingState, MetricCard, PageHeader, Surface } from "../components/app-ui";
import { repository, RepositoryError } from "../data/repository";
import { formatDate, formatNumber, getFullName } from "../lib/format";
import { getLeadStage } from "../lib/selectors";
import type { ManagerDashboardOverview } from "../types/view-contracts";
import { useAuth } from "../providers/auth";

function mapDashboardError(reason: unknown): string {
  if (reason instanceof RepositoryError) {
    if (reason.kind === "timeout") return `Loading timed out. A database performance issue may be affecting this view.`;
    if (reason.kind === "permission") return `Access to dashboard data is blocked by your current permissions.`;
    if (reason.kind === "network") return `Dashboard data could not be loaded due to a network error. Try again.`;
    return reason.message;
  }
  if (reason instanceof Error) return reason.message;
  return "Failed to load dashboard data.";
}

function useManagerDashboard(managerId: string) {
  const { identity, loading: authLoading } = useAuth();
  const [data, setData] = useState<ManagerDashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!managerId) return;
    setLoading(true);
    try {
      const result = await repository.loadManagerDashboardOverview(managerId);
      setData(result);
      setError(null);
    } catch (reason) {
      setError(mapDashboardError(reason));
    } finally {
      setLoading(false);
    }
  }, [managerId]);

  useEffect(() => {
    if (authLoading || !identity || !managerId) {
      if (!authLoading) setLoading(false);
      return;
    }
    void load();
  }, [authLoading, identity, managerId, load]);

  return { data, loading, error, refresh: load };
}

export function ManagerDashboardPage() {
  const { identity } = useAuth();
  const managerId = identity?.id ?? "";
  const { data, loading, error, refresh } = useManagerDashboard(managerId);

  const metrics = useMemo(() => [
    {
      label: "Assigned clients",
      value: formatNumber(data?.metrics.assignedClientsCount ?? 0),
      hint: "Portfolio under manager ownership",
      tone: "info" as const,
    },
    {
      label: "Active campaigns",
      value: formatNumber(data?.metrics.activeCampaignsCount ?? 0),
      hint: "Campaigns currently running",
      tone: "success" as const,
    },
    {
      label: "Leads in progress",
      value: formatNumber(data?.metrics.leadsInProgressCount ?? 0),
      hint: "Not won and not offer-sent",
      tone: "neutral" as const,
    },
    {
      label: "Unclassified replies",
      value: formatNumber(data?.metrics.unclassifiedRepliesCount ?? 0),
      hint: `${formatNumber(data?.metrics.recentRepliesCount14d ?? 0)} replies in the last 14 days`,
      tone: "warning" as const,
    },
  ], [data]);

  const clientPortfolio = useMemo(() => {
    return (data?.clientPortfolio ?? []).map((client) => {
      const progress = client.kpiLeads ? (client.mqlCount / client.kpiLeads) * 100 : null;
      return {
        id: client.clientId,
        name: client.clientName,
        status: client.status,
        campaigns: client.campaignsCount,
        mqls: client.mqlCount,
        won: client.wonCount,
        progress,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  const campaignWatchlist = useMemo(() => {
    return (data?.campaignWatchlist ?? [])
      .map((row) => ({
        id: row.campaignId,
        name: row.campaignName,
        status: row.status,
        sent: row.sent,
        replies: row.replies,
        replyRate: row.sent > 0 ? (row.replies / row.sent) * 100 : 0,
      }))
      .filter((c) => c.status !== "active" || c.replyRate < 1)
      .sort((a, b) => a.replyRate - b.replyRate)
      .slice(0, 8);
  }, [data]);

  const leadQueue = useMemo(() => {
    return (data?.leadQueue ?? []).map((lead) => ({
      id: lead.leadId,
      name: getFullName(lead.firstName, lead.lastName),
      stage: getLeadStage(lead),
      clientName: lead.clientName,
      updatedAt: lead.updatedAt ?? lead.createdAt,
    }));
  }, [data]);

  if (loading) {
    return <LoadingState />;
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Manager Dashboard"
          subtitle="Assigned-client operations hub: portfolio status, lead queue, and campaign watchlist."
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
        title="Manager Dashboard"
        subtitle="Assigned-client operations hub: portfolio status, lead queue, and campaign watchlist."
      />

      <Banner tone="info">
        Work queue: prioritize lead updates, then review campaign watchlist. Quick links:{" "}
        <Link to="/manager/leads" className="underline underline-offset-2">
          Leads
        </Link>{" "}
        ·{" "}
        <Link to="/manager/campaigns" className="underline underline-offset-2">
          Campaigns
        </Link>{" "}
        ·{" "}
        <Link to="/manager/clients" className="underline underline-offset-2">
          Clients
        </Link>
      </Banner>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((item) => (
          <MetricCard key={item.label} {...item} />
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <Surface
          title="Campaign watchlist"
          subtitle="Stopped/launching campaigns or low-reply performers in your scope."
          actions={
            <Link to="/manager/campaigns" className="text-sm text-sky-300 hover:text-sky-200">
              Open campaigns
            </Link>
          }
          className="xl:row-span-2"
        >
          {campaignWatchlist.length === 0 ? (
            <EmptyState title="No campaign alerts" description="All scoped campaigns look healthy based on current status and reply rate." />
          ) : (
            <div className="space-y-3">
              {campaignWatchlist.map((campaign) => (
                <div key={campaign.id} className="rounded-2xl border border-border bg-black/10 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm">{campaign.name}</p>
                    <p className="text-sm text-amber-300">{campaign.replyRate.toFixed(1)}%</p>
                  </div>
                  <p className="mt-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">{campaign.status}</p>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Sent</p>
                      <p>{formatNumber(campaign.sent)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Replies</p>
                      <p>{formatNumber(campaign.replies)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Surface>

        <Surface
          title="Assigned client portfolio"
          subtitle="Client-level KPI snapshot for your scoped portfolio."
          actions={
            <Link to="/manager/clients" className="text-sm text-sky-300 hover:text-sky-200">
              Open client workspace
            </Link>
          }
        >
          {clientPortfolio.length === 0 ? (
            <EmptyState title="No assigned clients" description="Assign clients to this manager account to populate the portfolio." />
          ) : (
            <div className="space-y-3">
              {clientPortfolio.map((client) => (
                <div key={client.id} className="rounded-2xl border border-border bg-black/10 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm">{client.name}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">{client.status}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      KPI progress: {client.progress === null ? "n/a" : `${Math.min(999, client.progress).toFixed(1)}%`}
                    </p>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Campaigns</p>
                      <p>{formatNumber(client.campaigns)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">MQLs</p>
                      <p>{formatNumber(client.mqls)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Won</p>
                      <p>{formatNumber(client.won)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Surface>

        <Surface
          title="Lead queue"
          subtitle="Most recent lead changes in your assignment scope."
          actions={
            <Link to="/manager/leads" className="text-sm text-sky-300 hover:text-sky-200">
              Open leads queue
            </Link>
          }
        >
          {leadQueue.length === 0 ? (
            <EmptyState title="No leads in queue" description="Lead operations will appear here once leads are assigned and updated." />
          ) : (
            <div className="space-y-3">
              {leadQueue.map((lead) => (
                <div key={lead.id} className="rounded-2xl border border-border bg-black/10 p-4">
                  <p className="text-sm">{lead.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {lead.clientName} · {lead.stage}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">Updated: {formatDate(lead.updatedAt)}</p>
                </div>
              ))}
            </div>
          )}
        </Surface>
      </div>
    </div>
  );
}
