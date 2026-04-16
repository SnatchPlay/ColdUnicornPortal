import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Banner, EmptyState, MetricCard, PageHeader, Surface } from "../components/app-ui";
import { formatDate, formatNumber, getFullName } from "../lib/format";
import {
  getLeadStage,
  scopeCampaignStats,
  scopeCampaigns,
  scopeClients,
  scopeLeads,
  scopeReplies,
} from "../lib/selectors";
import { useAuth } from "../providers/auth";
import { useCoreData } from "../providers/core-data";

export function ManagerDashboardPage() {
  const { identity } = useAuth();
  const { clients, campaigns, leads, replies, campaignDailyStats, error } = useCoreData();

  const scopedClients = useMemo(() => (identity ? scopeClients(identity, clients) : []), [clients, identity]);
  const scopedCampaigns = useMemo(
    () => (identity ? scopeCampaigns(identity, clients, campaigns) : []),
    [campaigns, clients, identity],
  );
  const scopedLeads = useMemo(() => (identity ? scopeLeads(identity, clients, leads) : []), [clients, identity, leads]);
  const scopedReplies = useMemo(() => (identity ? scopeReplies(identity, clients, replies) : []), [clients, identity, replies]);
  const scopedCampaignDailyStats = useMemo(
    () => (identity ? scopeCampaignStats(identity, clients, campaigns, campaignDailyStats) : []),
    [campaignDailyStats, campaigns, clients, identity],
  );

  const recentThreshold = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() - 14);
    return date.toISOString();
  }, []);

  const campaignStatMap = useMemo(() => {
    const map = new Map<string, { sent: number; replies: number }>();
    for (const stat of scopedCampaignDailyStats) {
      const current = map.get(stat.campaign_id) ?? { sent: 0, replies: 0 };
      current.sent += stat.sent_count ?? 0;
      current.replies += stat.reply_count ?? 0;
      map.set(stat.campaign_id, current);
    }
    return map;
  }, [scopedCampaignDailyStats]);

  const leadsInProgress = useMemo(
    () => scopedLeads.filter((lead) => !lead.won && !lead.offer_sent).length,
    [scopedLeads],
  );

  const unclassifiedReplies = useMemo(
    () => scopedReplies.filter((reply) => !reply.classification).length,
    [scopedReplies],
  );

  const recentReplyCount = useMemo(
    () => scopedReplies.filter((reply) => reply.received_at >= recentThreshold).length,
    [recentThreshold, scopedReplies],
  );

  const clientPortfolio = useMemo(
    () =>
      scopedClients
        .map((client) => {
          const clientCampaigns = scopedCampaigns.filter((campaign) => campaign.client_id === client.id);
          const clientLeads = scopedLeads.filter((lead) => lead.client_id === client.id);
          const mqls = clientLeads.filter((lead) => lead.qualification === "MQL").length;
          const won = clientLeads.filter((lead) => lead.won).length;
          const kpiLeads = client.kpi_leads ?? 0;
          const progress = kpiLeads > 0 ? (mqls / kpiLeads) * 100 : null;

          return {
            id: client.id,
            name: client.name,
            status: client.status,
            campaigns: clientCampaigns.length,
            mqls,
            won,
            progress,
          };
        })
        .sort((left, right) => left.name.localeCompare(right.name)),
    [scopedCampaigns, scopedClients, scopedLeads],
  );

  const leadQueue = useMemo(
    () =>
      scopedLeads
        .slice()
        .sort((left, right) => (right.updated_at || right.created_at).localeCompare(left.updated_at || left.created_at))
        .slice(0, 10)
        .map((lead) => {
          const clientName = scopedClients.find((client) => client.id === lead.client_id)?.name ?? "Unknown client";
          return {
            id: lead.id,
            name: getFullName(lead.first_name, lead.last_name),
            stage: getLeadStage(lead),
            clientName,
            updatedAt: lead.updated_at || lead.created_at,
          };
        }),
    [scopedClients, scopedLeads],
  );

  const campaignWatchlist = useMemo(
    () =>
      scopedCampaigns
        .map((campaign) => {
          const totals = campaignStatMap.get(campaign.id) ?? { sent: 0, replies: 0 };
          const replyRate = totals.sent > 0 ? (totals.replies / totals.sent) * 100 : 0;
          return {
            id: campaign.id,
            name: campaign.name,
            status: campaign.status,
            sent: totals.sent,
            replies: totals.replies,
            replyRate,
          };
        })
        .filter((campaign) => campaign.status !== "active" || campaign.replyRate < 1)
        .sort((left, right) => left.replyRate - right.replyRate)
        .slice(0, 8),
    [campaignStatMap, scopedCampaigns],
  );

  const replyTriageRows = useMemo(
    () =>
      scopedReplies
        .filter((reply) => !reply.classification)
        .slice()
        .sort((left, right) => right.received_at.localeCompare(left.received_at))
        .slice(0, 8)
        .map((reply) => {
          const lead = scopedLeads.find((item) => item.id === reply.lead_id);
          return {
            id: reply.id,
            leadName: lead ? getFullName(lead.first_name, lead.last_name) : "Unknown lead",
            clientName:
              lead ? scopedClients.find((client) => client.id === lead.client_id)?.name ?? "Unknown client" : "Unknown client",
            receivedAt: reply.received_at,
          };
        }),
    [scopedClients, scopedLeads, scopedReplies],
  );

  const metrics = useMemo(
    () => [
      {
        label: "Assigned clients",
        value: formatNumber(scopedClients.length),
        hint: "Portfolio under manager ownership",
        tone: "info" as const,
      },
      {
        label: "Active campaigns",
        value: formatNumber(scopedCampaigns.filter((campaign) => campaign.status === "active").length),
        hint: "Campaigns currently running",
        tone: "success" as const,
      },
      {
        label: "Leads in progress",
        value: formatNumber(leadsInProgress),
        hint: "Not won and not offer-sent",
        tone: "neutral" as const,
      },
      {
        label: "Reply triage",
        value: formatNumber(unclassifiedReplies),
        hint: `${formatNumber(recentReplyCount)} replies in the last 14 days`,
        tone: "warning" as const,
      },
    ],
    [leadsInProgress, recentReplyCount, scopedCampaigns, scopedClients.length, unclassifiedReplies],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Manager Dashboard"
        subtitle="Assigned-client operations hub: portfolio status, lead queue, campaign watchlist, and reply triage."
      />

      {error && <Banner tone="warning">{error}</Banner>}

      <Banner tone="info">
        Work queue: prioritize reply triage and lead updates, then review campaign watchlist. Quick links: {" "}
        <Link to="/manager/leads" className="underline underline-offset-2">
          Leads
        </Link>{" "}
        · {" "}
        <Link to="/manager/campaigns" className="underline underline-offset-2">
          Campaigns
        </Link>{" "}
        · {" "}
        <Link to="/manager/clients" className="underline underline-offset-2">
          Clients
        </Link>
      </Banner>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((item) => (
          <MetricCard key={item.label} {...item} />
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
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

      <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <Surface
          title="Campaign watchlist"
          subtitle="Stopped/launching campaigns or low-reply performers in your scope."
          actions={
            <Link to="/manager/campaigns" className="text-sm text-sky-300 hover:text-sky-200">
              Open campaigns
            </Link>
          }
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
          title="Reply triage"
          subtitle="Recent unclassified replies that need manager review."
          actions={
            <Link to="/manager/leads" className="text-sm text-sky-300 hover:text-sky-200">
              Review in leads
            </Link>
          }
        >
          {replyTriageRows.length === 0 ? (
            <EmptyState title="No triage items" description="All visible replies are already classified." />
          ) : (
            <div className="space-y-3">
              {replyTriageRows.map((reply) => (
                <div key={reply.id} className="rounded-2xl border border-border bg-black/10 p-4">
                  <p className="text-sm">{reply.leadName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{reply.clientName}</p>
                  <p className="mt-2 text-xs text-muted-foreground">Received: {formatDate(reply.receivedAt)}</p>
                </div>
              ))}
            </div>
          )}
        </Surface>
      </div>
    </div>
  );
}
