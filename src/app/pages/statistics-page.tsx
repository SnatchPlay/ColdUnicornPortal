import { useEffect, useMemo, useState } from "react";
import {
  Cell,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Search } from "lucide-react";
import { DateRangeButton } from "../components/portal-ui";
import { Banner, ChartTextSummary, EmptyState, InlineLinkButton, LoadingState, MetricCard, PageHeader, Surface } from "../components/app-ui";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { formatDate, formatNumber } from "../lib/format";
import { isInternalAdmin, scopeCampaignStats, scopeCampaigns, scopeClients, scopeDailyStats, scopeLeads, sortClientsAlpha } from "../lib/selectors";
import { createDefaultTimeframe, filterByTimeframe, getTimeframeLabel, resolveTimeframeBounds } from "../lib/timeframe";
import { useCoreData } from "../providers/core-data";
import { useAuth } from "../providers/auth";
import { ClientStatisticsPage } from "./client-statistics-page";
import type { CampaignDailyStatRecord, DailyStatRecord, UserRecord } from "../types/core";

const PIE_COLORS = ["#38bdf8", "#22c55e", "#f59e0b", "#f97316"];
const PIE_COLOR_DOT_CLASSES = ["bg-sky-400", "bg-emerald-500", "bg-amber-500", "bg-orange-500"];
const ALL_FILTER_VALUE = "__all__";
const SELECT_OPTION_LIMIT = 80;
const CLIENT_CARD_PAGE_SIZE = 40;
const CAMPAIGN_CLIENT_GROUP_PAGE_SIZE = 12;
const CAMPAIGNS_PER_CLIENT_PREVIEW = 12;

interface ManagerAnalyticsOption {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: UserRecord["role"] | "missing_manager";
}

interface AnalyticsTotals {
  totalSent: number;
  totalReplies: number;
  totalBounces: number;
  replyRate: number;
  bounceRate: number;
}

interface DailySeriesPoint {
  date: string;
  label: string;
  sent: number;
  replies: number;
  bounces: number;
}

function normalizeReportDate(value: string) {
  return value.slice(0, 10);
}

function formatDateKey(value: string) {
  return formatDate(`${value}T12:00:00`, { day: "2-digit", month: "short" });
}

function toDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addCalendarDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function formatDayCount(value: number, noun = "day") {
  return `${formatNumber(value)} ${noun}${value === 1 ? "" : "s"}`;
}

function enumerateDateKeys(start: Date, end: Date) {
  const keys: string[] = [];
  let cursor = new Date(start);
  cursor.setHours(12, 0, 0, 0);
  const endDate = new Date(end);
  endDate.setHours(12, 0, 0, 0);

  while (cursor.getTime() <= endDate.getTime() && keys.length < 370) {
    keys.push(toDateKey(cursor));
    cursor = addCalendarDays(cursor, 1);
  }

  return keys;
}

function includesSearch(value: string | null | undefined, query: string) {
  if (!query.trim()) return true;
  return (value ?? "").toLowerCase().includes(query.trim().toLowerCase());
}

function parseAnalyticsDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function getManagerDisplayName(manager: ManagerAnalyticsOption) {
  return `${manager.first_name} ${manager.last_name}`.trim() || manager.email;
}

function aggregateCampaignStats(stats: CampaignDailyStatRecord[]): AnalyticsTotals {
  const totalSent = stats.reduce((sum, item) => sum + (item.sent_count ?? 0), 0);
  const totalReplies = stats.reduce((sum, item) => sum + (item.reply_count ?? 0), 0);
  const totalBounces = stats.reduce((sum, item) => sum + (item.bounce_count ?? 0), 0);
  return {
    totalSent,
    totalReplies,
    totalBounces,
    replyRate: totalSent > 0 ? (totalReplies / totalSent) * 100 : 0,
    bounceRate: totalSent > 0 ? (totalBounces / totalSent) * 100 : 0,
  };
}

function aggregateDailyStats(stats: DailyStatRecord[]): AnalyticsTotals {
  const totalSent = stats.reduce((sum, item) => sum + item.emails_sent, 0);
  const totalReplies = stats.reduce((sum, item) => sum + item.response_count, 0);
  const totalBounces = stats.reduce((sum, item) => sum + item.bounce_count, 0);
  return {
    totalSent,
    totalReplies,
    totalBounces,
    replyRate: totalSent > 0 ? (totalReplies / totalSent) * 100 : 0,
    bounceRate: totalSent > 0 ? (totalBounces / totalSent) * 100 : 0,
  };
}

export function StatisticsPage() {
  const { identity } = useAuth();
  if (identity?.role === "client") return <ClientStatisticsPage />;
  return <InternalStatisticsPage />;
}

function InternalStatisticsPage() {
  const { identity } = useAuth();
  const { users = [], clients, campaigns, leads, campaignDailyStats, dailyStats = [], loading, error, refresh } = useCoreData();
  const [timeframe, setTimeframe] = useState(() => createDefaultTimeframe());
  const [managerFilterId, setManagerFilterId] = useState(ALL_FILTER_VALUE);
  const [clientFilterId, setClientFilterId] = useState(ALL_FILTER_VALUE);
  const [campaignFilterId, setCampaignFilterId] = useState(ALL_FILTER_VALUE);
  const [managerSearch, setManagerSearch] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [clientBreakdownSearch, setClientBreakdownSearch] = useState("");
  const [campaignSearch, setCampaignSearch] = useState("");
  const [clientCardLimit, setClientCardLimit] = useState(CLIENT_CARD_PAGE_SIZE);
  const [campaignGroupLimit, setCampaignGroupLimit] = useState(CAMPAIGN_CLIENT_GROUP_PAGE_SIZE);

  const scopedClients = useMemo(
    () => (identity ? sortClientsAlpha(scopeClients(identity, clients)) : []),
    [clients, identity],
  );
  const scopedCampaigns = useMemo(
    () => (identity ? scopeCampaigns(identity, clients, campaigns) : []),
    [campaigns, clients, identity],
  );
  const scopedLeads = useMemo(() => (identity ? scopeLeads(identity, clients, leads) : []), [clients, identity, leads]);
  const scopedStats = useMemo(
    () => (identity ? scopeCampaignStats(identity, clients, campaigns, campaignDailyStats) : []),
    [campaignDailyStats, campaigns, clients, identity],
  );
  const scopedDailyStats = useMemo(
    () => (identity ? scopeDailyStats(identity, clients, dailyStats) : []),
    [clients, dailyStats, identity],
  );

  const showManagerScope = identity ? isInternalAdmin(identity.role) : false;
  const managerUsers = useMemo<ManagerAnalyticsOption[]>(() => {
    const userById = new Map(users.map((user) => [user.id, user] as const));
    const rows = users
      .filter((user) => user.role === "manager")
      .map((user) => ({
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        role: user.role,
      }));
    const knownIds = new Set(rows.map((manager) => manager.id));
    for (const client of scopedClients) {
      if (!client.manager_id || knownIds.has(client.manager_id)) continue;
      knownIds.add(client.manager_id);
      const user = userById.get(client.manager_id);
      if (user) {
        rows.push({
          id: user.id,
          first_name: user.first_name,
          last_name: user.last_name,
          email: user.email,
          role: user.role,
        });
        continue;
      }
      rows.push({
        id: client.manager_id,
        first_name: "Unknown",
        last_name: "manager",
        email: client.manager_id,
        role: "missing_manager",
      });
    }
    return rows.sort((a, b) => getManagerDisplayName(a).localeCompare(getManagerDisplayName(b)));
  }, [scopedClients, users]);

  const managerFilteredClients = useMemo(
    () =>
      managerFilterId === ALL_FILTER_VALUE
        ? scopedClients
        : scopedClients.filter((client) => client.manager_id === managerFilterId),
    [managerFilterId, scopedClients],
  );
  const managerFilteredClientIds = useMemo(
    () => new Set(managerFilteredClients.map((client) => client.id)),
    [managerFilteredClients],
  );

  const campaignById = useMemo(() => new Map(scopedCampaigns.map((item) => [item.id, item])), [scopedCampaigns]);
  const clientById = useMemo(() => new Map(scopedClients.map((item) => [item.id, item])), [scopedClients]);

  const clientFilteredCampaigns = useMemo(
    () =>
      clientFilterId === ALL_FILTER_VALUE
        ? scopedCampaigns.filter((item) => managerFilteredClientIds.has(item.client_id))
        : scopedCampaigns.filter((item) => item.client_id === clientFilterId && managerFilteredClientIds.has(item.client_id)),
    [clientFilterId, managerFilteredClientIds, scopedCampaigns],
  );

  useEffect(() => {
    if (clientFilterId === ALL_FILTER_VALUE) return;
    if (!managerFilteredClients.some((item) => item.id === clientFilterId)) {
      setClientFilterId(ALL_FILTER_VALUE);
    }
  }, [clientFilterId, managerFilteredClients]);

  useEffect(() => {
    if (campaignFilterId === ALL_FILTER_VALUE) return;
    if (!clientFilteredCampaigns.some((item) => item.id === campaignFilterId)) {
      setCampaignFilterId(ALL_FILTER_VALUE);
    }
  }, [campaignFilterId, clientFilteredCampaigns]);

  useEffect(() => {
    setCampaignGroupLimit(CAMPAIGN_CLIENT_GROUP_PAGE_SIZE);
  }, [campaignFilterId, campaignSearch, clientFilterId, managerFilterId, timeframe]);

  useEffect(() => {
    setClientCardLimit(CLIENT_CARD_PAGE_SIZE);
  }, [clientBreakdownSearch, clientFilterId, managerFilterId, timeframe]);

  const timeframeAnchor = useMemo(() => {
    let latest: Date | null = null;
    const consider = (value: string | null | undefined) => {
      const parsed = parseAnalyticsDate(value);
      if (!parsed) return;
      if (!latest || parsed.getTime() > latest.getTime()) latest = parsed;
    };
    for (const item of scopedStats) consider(item.report_date);
    for (const item of scopedDailyStats) consider(item.report_date);
    for (const item of scopedLeads) consider(item.updated_at || item.created_at);
    return latest ?? new Date();
  }, [scopedDailyStats, scopedLeads, scopedStats]);

  const timeframeStats = useMemo(
    () => filterByTimeframe(scopedStats, (item) => item.report_date, timeframe, timeframeAnchor),
    [scopedStats, timeframe, timeframeAnchor],
  );
  const timeframeDailyStats = useMemo(
    () => filterByTimeframe(scopedDailyStats, (item) => item.report_date, timeframe, timeframeAnchor),
    [scopedDailyStats, timeframe, timeframeAnchor],
  );
  const timeframeLeads = useMemo(
    () => filterByTimeframe(scopedLeads, (item) => item.created_at, timeframe, timeframeAnchor),
    [scopedLeads, timeframe, timeframeAnchor],
  );

  const filteredStats = useMemo(
    () =>
      timeframeStats.filter((item) => {
        const campaign = campaignById.get(item.campaign_id);
        if (!campaign) return false;
        if (clientFilterId !== ALL_FILTER_VALUE && campaign.client_id !== clientFilterId) return false;
        if (!managerFilteredClientIds.has(campaign.client_id)) return false;
        if (campaignFilterId !== ALL_FILTER_VALUE && campaign.id !== campaignFilterId) return false;
        return true;
      }),
    [campaignById, campaignFilterId, clientFilterId, managerFilteredClientIds, timeframeStats],
  );

  const filteredDailyStats = useMemo(
    () =>
      timeframeDailyStats.filter((item) => {
        if (!managerFilteredClientIds.has(item.client_id)) return false;
        if (clientFilterId !== ALL_FILTER_VALUE && item.client_id !== clientFilterId) return false;
        return true;
      }),
    [clientFilterId, managerFilteredClientIds, timeframeDailyStats],
  );

  const filteredLeads = useMemo(
    () =>
      timeframeLeads.filter((item) => {
        if (!managerFilteredClientIds.has(item.client_id)) return false;
        if (clientFilterId !== ALL_FILTER_VALUE && item.client_id !== clientFilterId) return false;
        if (campaignFilterId !== ALL_FILTER_VALUE && item.campaign_id !== campaignFilterId) return false;
        return true;
      }),
    [campaignFilterId, clientFilterId, managerFilteredClientIds, timeframeLeads],
  );

  const sortedFilteredStats = useMemo(
    () => filteredStats.slice().sort((a, b) => a.report_date.localeCompare(b.report_date)),
    [filteredStats],
  );
  const sortedFilteredDailyStats = useMemo(
    () => filteredDailyStats.slice().sort((a, b) => a.report_date.localeCompare(b.report_date)),
    [filteredDailyStats],
  );
  const timeframeBounds = useMemo(
    () => resolveTimeframeBounds(timeframe, timeframeAnchor),
    [timeframe, timeframeAnchor],
  );

  const dailySeries = useMemo(() => {
    const byDate = new Map<string, DailySeriesPoint>();
    const useCampaignStats = campaignFilterId !== ALL_FILTER_VALUE || sortedFilteredDailyStats.length === 0;
    const ensureDate = (date: string) => {
      const current = byDate.get(date) ?? {
        date,
        label: formatDateKey(date),
        sent: 0,
        replies: 0,
        bounces: 0,
      };
      byDate.set(date, current);
      return current;
    };

    if (useCampaignStats) {
      for (const item of sortedFilteredStats) {
        const date = normalizeReportDate(item.report_date);
        const current = ensureDate(date);
        current.sent += item.sent_count ?? 0;
        current.replies += item.reply_count ?? 0;
        current.bounces += item.bounce_count ?? 0;
      }
    } else {
      for (const item of sortedFilteredDailyStats) {
        const date = normalizeReportDate(item.report_date);
        const current = ensureDate(date);
        current.sent += item.emails_sent;
        current.replies += item.response_count;
        current.bounces += item.bounce_count;
      }
    }

    if (timeframeBounds.start && timeframeBounds.end) {
      return enumerateDateKeys(timeframeBounds.start, timeframeBounds.end).map((date) => (
        byDate.get(date) ?? {
          date,
          label: formatDateKey(date),
          sent: 0,
          replies: 0,
          bounces: 0,
        }
      ));
    }

    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [campaignFilterId, sortedFilteredDailyStats, sortedFilteredStats, timeframeBounds]);

  const sentSeries = dailySeries;
  const signalsSeries = dailySeries;

  const activityCoverage = useMemo(() => {
    const sourceDates = campaignFilterId === ALL_FILTER_VALUE && filteredDailyStats.length > 0
      ? filteredDailyStats.map((item) => normalizeReportDate(item.report_date))
      : filteredStats.map((item) => normalizeReportDate(item.report_date));
    const activeDates = Array.from(new Set(sourceDates)).sort();

    return {
      activeDays: activeDates.length,
      calendarDays: dailySeries.length,
    };
  }, [campaignFilterId, dailySeries.length, filteredDailyStats, filteredStats]);

  const timeframeLabel = getTimeframeLabel(timeframe);

  const summaryMetrics = useMemo(() => {
    if (campaignFilterId !== ALL_FILTER_VALUE || filteredDailyStats.length === 0) {
      return aggregateCampaignStats(filteredStats);
    }
    return aggregateDailyStats(filteredDailyStats);
  }, [campaignFilterId, filteredDailyStats, filteredStats]);

  const byClientBreakdown = useMemo(() => {
    if (scopedClients.length <= 1) return [];
    return managerFilteredClients
      .map((client) => {
        const clientCampaignIds = new Set(
          scopedCampaigns.filter((c) => c.client_id === client.id).map((c) => c.id),
        );
        const clientStats = filteredStats.filter((item) => clientCampaignIds.has(item.campaign_id));
        const clientDaily = filteredDailyStats.filter((item) => item.client_id === client.id);
        const totals =
          campaignFilterId !== ALL_FILTER_VALUE || clientDaily.length === 0
            ? aggregateCampaignStats(clientStats)
            : aggregateDailyStats(clientDaily);
        const clientLeads = filteredLeads.filter((l) => l.client_id === client.id).length;
        return {
          client,
          totalSent: totals.totalSent,
          totalReplies: totals.totalReplies,
          clientLeads,
          replyRate: totals.replyRate,
        };
      })
      .filter((item) => item.totalSent > 0 || item.clientLeads > 0);
  }, [campaignFilterId, filteredDailyStats, filteredLeads, filteredStats, managerFilteredClients, scopedCampaigns, scopedClients.length]);

  const byManagerBreakdown = useMemo(() => {
    if (!showManagerScope || managerUsers.length === 0) return [];
    const rows = managerUsers
      .map((manager) => {
        const managerClients = managerFilteredClients.filter((client) => client.manager_id === manager.id);
        const managerClientIds = new Set(managerClients.map((client) => client.id));
        const managerCampaigns = clientFilteredCampaigns.filter((campaign) => managerClientIds.has(campaign.client_id));
        const managerCampaignIds = new Set(managerCampaigns.map((campaign) => campaign.id));
        const managerStats = filteredStats.filter((stat) => managerCampaignIds.has(stat.campaign_id));
        const managerDailyStats = filteredDailyStats.filter((stat) => managerClientIds.has(stat.client_id));
        const totals =
          campaignFilterId !== ALL_FILTER_VALUE || managerDailyStats.length === 0
            ? aggregateCampaignStats(managerStats)
            : aggregateDailyStats(managerDailyStats);
        const managerLeads = filteredLeads.filter((lead) => managerClientIds.has(lead.client_id)).length;
        return {
          manager,
          clientsCount: managerClients.length,
          campaignsCount: managerCampaigns.length,
          totalSent: totals.totalSent,
          totalReplies: totals.totalReplies,
          managerLeads,
          replyRate: totals.replyRate,
        };
      })
      .filter((item) => item.clientsCount > 0 || item.campaignsCount > 0 || item.managerLeads > 0 || item.totalSent > 0 || item.totalReplies > 0);
    return rows.sort((a, b) => b.totalSent - a.totalSent || b.managerLeads - a.managerLeads);
  }, [campaignFilterId, clientFilteredCampaigns, filteredDailyStats, filteredLeads, filteredStats, managerFilteredClients, managerUsers, showManagerScope]);

  const qualificationSeries = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of filteredLeads) {
      const key = item.qualification ?? "unqualified";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([name, value]) => ({ name, value }));
  }, [filteredLeads]);

  const managerLeadBreakdown = useMemo(() => {
    if (!showManagerScope || managerUsers.length === 0) return [];
    return managerUsers
      .map((manager) => {
        const managerClientIds = new Set(
          managerFilteredClients.filter((client) => client.manager_id === manager.id).map((client) => client.id),
        );
        const managerLeads = filteredLeads.filter((lead) => managerClientIds.has(lead.client_id));
        const mql = managerLeads.filter((lead) => (lead.qualification ?? "").toLowerCase() === "mql").length;
        const preMql = managerLeads.filter((lead) => (lead.qualification ?? "").toLowerCase() === "premql").length;
        const unqualified = managerLeads.filter((lead) => !lead.qualification).length;
        return {
          manager,
          total: managerLeads.length,
          mql,
          preMql,
          unqualified,
        };
      })
      .filter((item) => item.total > 0)
      .sort((a, b) => b.total - a.total || b.mql - a.mql);
  }, [filteredLeads, managerFilteredClients, managerUsers, showManagerScope]);

  /*
   * Campaign-specific sections stay on campaign_daily_stats because daily_stats
   * is client-level and cannot answer per-campaign filters.
   */
  const campaignTotals = useMemo(() => {
    const totals = new Map<string, { sent: number; replies: number; rows: number }>();
    for (const item of timeframeStats) {
      const campaign = campaignById.get(item.campaign_id);
      if (!campaign) continue;
      if (clientFilterId !== ALL_FILTER_VALUE && campaign.client_id !== clientFilterId) continue;
      const current = totals.get(campaign.id) ?? { sent: 0, replies: 0, rows: 0 };
      current.sent += item.sent_count ?? 0;
      current.replies += item.reply_count ?? 0;
      current.rows += 1;
      totals.set(campaign.id, current);
    }
    return totals;
  }, [campaignById, clientFilterId, timeframeStats]);

  const campaignSeries = useMemo(
    () =>
      clientFilteredCampaigns
        .filter((item) => campaignFilterId === ALL_FILTER_VALUE || item.id === campaignFilterId)
        .map((campaign) => {
          const totals = campaignTotals.get(campaign.id);
          const sent = totals?.sent ?? 0;
          const replies = totals?.replies ?? 0;
          return {
            id: campaign.id,
            name: campaign.name,
            status: campaign.status,
            type: campaign.type,
            clientId: campaign.client_id,
            clientName: clientById.get(campaign.client_id)?.name ?? "Unassigned client",
            startDate: campaign.start_date,
            databaseSize: campaign.database_size ?? 0,
            positiveResponses: campaign.positive_responses,
            sent,
            replies,
            replyRate: sent > 0 ? (replies / sent) * 100 : 0,
            dailyRows: totals?.rows ?? 0,
            externalId: campaign.external_id,
            genderTarget: campaign.gender_target ?? "-",
          };
        })
        .filter((campaign) => campaignFilterId !== ALL_FILTER_VALUE || campaign.dailyRows > 0 || campaign.sent > 0 || campaign.replies > 0)
        .sort((a, b) => b.sent - a.sent || b.replies - a.replies || a.name.localeCompare(b.name)),
    [campaignFilterId, campaignTotals, clientById, clientFilteredCampaigns],
  );

  const selectedCampaign = useMemo(
    () => campaignSeries.find((item) => item.id === campaignFilterId) ?? null,
    [campaignFilterId, campaignSeries],
  );
  const managerFilterOptions = useMemo(() => {
    const matches = managerUsers.filter((manager) =>
      includesSearch(`${getManagerDisplayName(manager)} ${manager.email}`, managerSearch),
    );
    const selected = managerFilterId === ALL_FILTER_VALUE ? null : managerUsers.find((manager) => manager.id === managerFilterId);
    const limited = matches.slice(0, SELECT_OPTION_LIMIT);
    if (selected && !limited.some((manager) => manager.id === selected.id)) {
      return [selected, ...limited].slice(0, SELECT_OPTION_LIMIT);
    }
    return limited;
  }, [managerFilterId, managerSearch, managerUsers]);
  const clientFilterOptions = useMemo(() => {
    const matches = managerFilteredClients.filter((client) => includesSearch(client.name, clientSearch));
    const selected = clientFilterId === ALL_FILTER_VALUE ? null : managerFilteredClients.find((client) => client.id === clientFilterId);
    const limited = matches.slice(0, SELECT_OPTION_LIMIT);
    if (selected && !limited.some((client) => client.id === selected.id)) {
      return [selected, ...limited].slice(0, SELECT_OPTION_LIMIT);
    }
    return limited;
  }, [clientFilterId, clientSearch, managerFilteredClients]);
  const campaignFilterOptions = useMemo(() => {
    const matches = clientFilteredCampaigns.filter((campaign) => includesSearch(campaign.name, campaignSearch));
    const selected = campaignFilterId === ALL_FILTER_VALUE ? null : clientFilteredCampaigns.find((campaign) => campaign.id === campaignFilterId);
    const limited = matches.slice(0, SELECT_OPTION_LIMIT);
    if (selected && !limited.some((campaign) => campaign.id === selected.id)) {
      return [selected, ...limited].slice(0, SELECT_OPTION_LIMIT);
    }
    return limited;
  }, [campaignFilterId, campaignSearch, clientFilteredCampaigns]);
  const campaignCards = useMemo(
    () => campaignSeries.filter((campaign) => includesSearch(campaign.name, campaignSearch)),
    [campaignSearch, campaignSeries],
  );
  const campaignClientGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        clientId: string;
        clientName: string;
        campaigns: typeof campaignCards;
        totalSent: number;
        totalReplies: number;
      }
    >();

    for (const campaign of campaignCards) {
      const current = groups.get(campaign.clientId) ?? {
        clientId: campaign.clientId,
        clientName: campaign.clientName,
        campaigns: [],
        totalSent: 0,
        totalReplies: 0,
      };
      current.campaigns.push(campaign);
      current.totalSent += campaign.sent;
      current.totalReplies += campaign.replies;
      groups.set(campaign.clientId, current);
    }

    return Array.from(groups.values()).sort(
      (a, b) => b.totalSent - a.totalSent || b.campaigns.length - a.campaigns.length || a.clientName.localeCompare(b.clientName),
    );
  }, [campaignCards]);
  const visibleCampaignClientGroups = useMemo(
    () => campaignClientGroups.slice(0, campaignGroupLimit),
    [campaignClientGroups, campaignGroupLimit],
  );
  const filteredClientBreakdown = useMemo(
    () => byClientBreakdown.filter(({ client }) => includesSearch(client.name, clientBreakdownSearch)),
    [byClientBreakdown, clientBreakdownSearch],
  );
  const visibleClientBreakdown = useMemo(
    () => filteredClientBreakdown.slice(0, clientCardLimit),
    [clientCardLimit, filteredClientBreakdown],
  );
  if (loading) {
    return <LoadingState />;
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Statistics"
          subtitle="Performance overview for campaigns in your current scope."
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
        title="Statistics"
        subtitle="Performance overview for campaigns in your current scope."
        actions={<DateRangeButton value={timeframe} onChange={setTimeframe} />}
      />

      <Surface title="Filters" subtitle={`Current timeframe: ${timeframeLabel}`}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {showManagerScope && managerUsers.length > 1 ? (
            <div className="space-y-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
                <Input
                  aria-label="Search managers"
                  value={managerSearch}
                  onChange={(event) => setManagerSearch(event.target.value)}
                  placeholder="Search managers"
                  className="h-auto rounded-2xl border-white/10 bg-black/20 py-3 pl-9 text-sm text-white placeholder:text-neutral-500"
                />
              </div>
              <Select value={managerFilterId} onValueChange={setManagerFilterId}>
                <SelectTrigger
                  aria-label="Filter statistics by manager"
                  className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white"
                >
                  <SelectValue placeholder="All managers" />
                </SelectTrigger>
                <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                  <SelectItem value={ALL_FILTER_VALUE} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                    All managers
                  </SelectItem>
                  {managerFilterOptions.map((manager) => (
                    <SelectItem key={manager.id} value={manager.id} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                      {getManagerDisplayName(manager)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {scopedClients.length > 1 ? (
            <div className="space-y-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
                <Input
                  aria-label="Search clients"
                  value={clientSearch}
                  onChange={(event) => setClientSearch(event.target.value)}
                  placeholder="Search clients"
                  className="h-auto rounded-2xl border-white/10 bg-black/20 py-3 pl-9 text-sm text-white placeholder:text-neutral-500"
                />
              </div>
              <Select value={clientFilterId} onValueChange={setClientFilterId}>
                <SelectTrigger
                  aria-label="Filter statistics by client"
                  className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white"
                >
                  <SelectValue placeholder="All clients" />
                </SelectTrigger>
                <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                  <SelectItem value={ALL_FILTER_VALUE} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                    All clients
                  </SelectItem>
                  {clientFilterOptions.map((client) => (
                    <SelectItem key={client.id} value={client.id} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                      {client.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="rounded-2xl border border-border bg-black/10 px-4 py-3 text-sm text-muted-foreground">
              Client scope: {scopedClients[0]?.name ?? "n/a"}
            </div>
          )}

          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
              <Input
                aria-label="Search campaigns"
                value={campaignSearch}
                onChange={(event) => setCampaignSearch(event.target.value)}
                placeholder="Search campaigns"
                className="h-auto rounded-2xl border-white/10 bg-black/20 py-3 pl-9 text-sm text-white placeholder:text-neutral-500"
              />
            </div>
            <Select value={campaignFilterId} onValueChange={setCampaignFilterId}>
              <SelectTrigger
                aria-label="Filter statistics by campaign"
                className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white"
              >
                <SelectValue placeholder="All campaigns" />
              </SelectTrigger>
              <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                <SelectItem value={ALL_FILTER_VALUE} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                  All campaigns
                </SelectItem>
                {campaignFilterOptions.map((campaign) => (
                  <SelectItem key={campaign.id} value={campaign.id} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                    {campaign.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Surface>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <MetricCard
          label="Sent"
          value={formatNumber(summaryMetrics.totalSent)}
          hint={`${timeframeLabel}`}
          tone="info"
        />
        <MetricCard
          label="Replies"
          value={formatNumber(summaryMetrics.totalReplies)}
          hint={`Reply rate ${summaryMetrics.replyRate.toFixed(1)}%`}
          tone="success"
        />
        <MetricCard
          label="Bounces"
          value={formatNumber(summaryMetrics.totalBounces)}
          hint={`Bounce rate ${summaryMetrics.bounceRate.toFixed(1)}%`}
          tone={summaryMetrics.bounceRate > 5 ? "warning" : "neutral"}
        />
        <MetricCard
          label="Leads"
          value={formatNumber(filteredLeads.length)}
          hint="In current scope"
        />
        <MetricCard
          label="Campaigns"
          value={formatNumber(campaignSeries.length)}
          hint="Visible campaigns"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Surface title="Sent volume" subtitle="Emails sent per day over the selected period.">
          {activityCoverage.activeDays === 0 ? (
            <EmptyState title="No send data yet" description="No activity data is available for the selected filters." />
          ) : (
            <>
              <ChartTextSummary summary={`Sent volume chart with ${formatDayCount(activityCoverage.calendarDays, "calendar day")} and ${formatDayCount(activityCoverage.activeDays, "active day")}.`} />
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={sentSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" vertical={false} />
                    <XAxis dataKey="label" interval="preserveStartEnd" minTickGap={28} tick={{ fill: "rgba(148,163,184,0.8)", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "rgba(148,163,184,0.8)", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip
                      cursor={false}
                      contentStyle={{ backgroundColor: "rgba(2,6,23,0.98)", border: "1px solid rgba(148,163,184,0.2)", borderRadius: "16px", color: "#fff" }}
                      labelStyle={{ color: "rgba(226,232,240,0.92)" }}
                      itemStyle={{ color: "#f8fafc" }}
                    />
                    <Line type="monotone" dataKey="sent" stroke="#38bdf8" strokeWidth={2.5} dot={false} name="Sent" />
                    <Legend wrapperStyle={{ fontSize: 12, color: "rgba(148,163,184,0.8)" }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </Surface>

        <Surface title="Replies & bounces" subtitle="Engagement and delivery signals over the selected period.">
          {activityCoverage.activeDays === 0 ? (
            <EmptyState title="No signal data yet" description="No activity data is available for the selected filters." />
          ) : (
            <>
              <ChartTextSummary summary={`Signals chart with ${formatDayCount(activityCoverage.calendarDays, "calendar day")} and ${formatDayCount(activityCoverage.activeDays, "active day")}.`} />
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={signalsSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" vertical={false} />
                    <XAxis dataKey="label" interval="preserveStartEnd" minTickGap={28} tick={{ fill: "rgba(148,163,184,0.8)", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "rgba(148,163,184,0.8)", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip
                      cursor={false}
                      contentStyle={{ backgroundColor: "rgba(2,6,23,0.98)", border: "1px solid rgba(148,163,184,0.2)", borderRadius: "16px", color: "#fff" }}
                      labelStyle={{ color: "rgba(226,232,240,0.92)" }}
                      itemStyle={{ color: "#f8fafc" }}
                    />
                    <Line type="monotone" dataKey="replies" stroke="#22c55e" strokeWidth={2.5} dot={false} name="Replies" />
                    <Line type="monotone" dataKey="bounces" stroke="#f97316" strokeWidth={2.5} dot={false} name="Bounces" />
                    <Legend wrapperStyle={{ fontSize: 12, color: "rgba(148,163,184,0.8)" }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </Surface>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[1fr_1.4fr]">
        <Surface title="Lead qualification mix" subtitle="Based on visible lead records in the current scope.">
          {qualificationSeries.length === 0 ? (
            <EmptyState title="No leads available" description="Once visible leads exist, the qualification mix appears here." />
          ) : (
            <>
              <ChartTextSummary summary={`Lead qualification pie chart with ${qualificationSeries.length} qualification buckets.`} />
              <div className="grid gap-4">
                <div className="grid items-center gap-4 md:grid-cols-[minmax(0,0.9fr)_minmax(12rem,1fr)]">
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={qualificationSeries} dataKey="value" nameKey="name" outerRadius={88} innerRadius={54}>
                          {qualificationSeries.map((entry, index) => (
                            <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          cursor={false}
                          contentStyle={{
                            backgroundColor: "rgba(2,6,23,0.98)",
                            border: "1px solid rgba(148,163,184,0.2)",
                            borderRadius: "16px",
                            color: "#fff",
                          }}
                          labelStyle={{ color: "rgba(226,232,240,0.92)" }}
                          itemStyle={{ color: "#f8fafc" }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="divide-y divide-border rounded-2xl border border-border bg-black/10">
                    {qualificationSeries.map((entry, index) => (
                      <div key={entry.name} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${PIE_COLOR_DOT_CLASSES[index % PIE_COLOR_DOT_CLASSES.length]}`} />
                          <span className="truncate text-sm text-neutral-300">{entry.name}</span>
                        </div>
                        <span className="font-mono text-sm text-white">{formatNumber(entry.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {managerLeadBreakdown.length > 0 ? (
                  <div className="rounded-2xl border border-border bg-black/10">
                    <div className="border-b border-border px-4 py-3">
                      <p className="text-sm font-medium text-white">By manager</p>
                      <p className="mt-1 text-xs text-neutral-500">Lead count and qualification split.</p>
                    </div>
                    <div className="max-h-64 divide-y divide-border overflow-y-auto">
                      {managerLeadBreakdown.map(({ manager, total, mql, preMql, unqualified }) => (
                        <div key={manager.id} className="px-4 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="truncate text-sm text-white">{getManagerDisplayName(manager)}</p>
                            <span className="font-mono text-sm text-white">{formatNumber(total)}</span>
                          </div>
                          <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-neutral-400">
                            <span>MQL {formatNumber(mql)}</span>
                            <span>preMQL {formatNumber(preMql)}</span>
                            <span>Unqualified {formatNumber(unqualified)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          )}
        </Surface>

        {byClientBreakdown.length > 0 ? (
          <Surface title="By client" subtitle="Sent, replies, and leads per client in the current scope.">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="relative min-w-[240px] flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
                  <Input
                    aria-label="Search client breakdown"
                    value={clientBreakdownSearch}
                    onChange={(event) => setClientBreakdownSearch(event.target.value)}
                    placeholder="Search client cards"
                    className="h-auto rounded-2xl border-white/10 bg-black/20 py-2.5 pl-9 text-sm text-white placeholder:text-neutral-500"
                  />
                </div>
                <span className="text-sm text-neutral-400">
                  Showing {formatNumber(visibleClientBreakdown.length)} of {formatNumber(filteredClientBreakdown.length)} clients
                </span>
              </div>
              <div className="max-h-[34rem] space-y-3 overflow-y-auto pr-1">
                {visibleClientBreakdown.map(({ client, totalSent, totalReplies, clientLeads, replyRate }) => (
                  <div key={client.id} className="rounded-2xl border border-border bg-black/10 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm text-white">{client.name}</p>
                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300">
                        {replyRate.toFixed(1)}% reply rate
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Sent</p>
                        <p className="mt-1 text-sm">{formatNumber(totalSent)}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Replies</p>
                        <p className="mt-1 text-sm">{formatNumber(totalReplies)}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Leads</p>
                        <p className="mt-1 text-sm">{formatNumber(clientLeads)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {visibleClientBreakdown.length < filteredClientBreakdown.length ? (
                <button
                  onClick={() => setClientCardLimit((current) => current + CLIENT_CARD_PAGE_SIZE)}
                  className="rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground transition hover:text-white"
                >
                  Load more clients
                </button>
              ) : null}
            </div>
          </Surface>
        ) : null}
      </div>

      {byManagerBreakdown.length > 0 ? (
        <Surface title="By manager" subtitle="Manager-level delivery and lead contribution in the current scope.">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {byManagerBreakdown.map(({ manager, clientsCount, campaignsCount, totalSent, totalReplies, managerLeads, replyRate }) => (
              <div key={manager.id} className="rounded-2xl border border-border bg-black/10 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-white">{getManagerDisplayName(manager)}</p>
                    <p className="mt-1 text-xs text-neutral-500">
                      {formatNumber(clientsCount)} clients, {formatNumber(campaignsCount)} campaigns
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-xs text-sky-300">
                    {replyRate.toFixed(1)}%
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Sent</p>
                    <p className="mt-1 text-sm">{formatNumber(totalSent)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Replies</p>
                    <p className="mt-1 text-sm">{formatNumber(totalReplies)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Leads</p>
                    <p className="mt-1 text-sm">{formatNumber(managerLeads)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Surface>
      ) : null}

      <Surface title="Campaign portfolio" subtitle="Size and response density across visible campaigns.">
        {campaignSeries.length === 0 ? (
          <EmptyState title="No campaigns in scope" description="Adjust filters to view campaigns in this section." />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-neutral-400">
              <span>
                Showing {formatNumber(visibleCampaignClientGroups.length)} of {formatNumber(campaignClientGroups.length)} client groups, {formatNumber(campaignCards.length)} matching campaigns
              </span>
              {campaignSearch ? (
                <button
                  onClick={() => setCampaignSearch("")}
                  className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:text-white"
                >
                  Clear search
                </button>
              ) : null}
            </div>
            <div className="space-y-4">
              {visibleCampaignClientGroups.map((group) => {
                const visibleGroupCampaigns = group.campaigns.slice(0, CAMPAIGNS_PER_CLIENT_PREVIEW);
                const groupReplyRate = group.totalSent > 0 ? (group.totalReplies / group.totalSent) * 100 : 0;

                return (
                  <div key={group.clientId} className="rounded-2xl border border-border bg-black/10 p-4">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white">{group.clientName}</p>
                        <p className="mt-1 text-xs text-neutral-500">
                          {formatNumber(group.campaigns.length)} campaigns, {formatNumber(group.totalSent)} sent, {groupReplyRate.toFixed(1)}% reply rate
                        </p>
                      </div>
                      {group.campaigns.length > CAMPAIGNS_PER_CLIENT_PREVIEW ? (
                        <span className="rounded-full border border-border px-2.5 py-1 text-xs text-neutral-400">
                          First {formatNumber(CAMPAIGNS_PER_CLIENT_PREVIEW)} shown
                        </span>
                      ) : null}
                    </div>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {visibleGroupCampaigns.map((campaign) => (
                        <button
                          key={campaign.id}
                          onClick={() => setCampaignFilterId(campaign.id)}
                          className={`rounded-2xl border p-4 text-left transition ${
                            selectedCampaign?.id === campaign.id
                              ? "border-emerald-500/30 bg-emerald-500/10"
                              : "border-border bg-[#101010] hover:bg-black/20"
                          }`}
                        >
                          <p className="truncate text-sm">{campaign.name}</p>
                          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                            <div>
                              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Database</p>
                              <p className="mt-1">{formatNumber(campaign.databaseSize)}</p>
                            </div>
                            <div>
                              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Positive</p>
                              <p className="mt-1">{formatNumber(campaign.positiveResponses)}</p>
                            </div>
                            <div>
                              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Sent</p>
                              <p className="mt-1">{formatNumber(campaign.sent)}</p>
                            </div>
                            <div>
                              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Reply rate</p>
                              <p className="mt-1">{campaign.replyRate.toFixed(1)}%</p>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            {visibleCampaignClientGroups.length < campaignClientGroups.length ? (
              <button
                onClick={() => setCampaignGroupLimit((current) => current + CAMPAIGN_CLIENT_GROUP_PAGE_SIZE)}
                className="rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground transition hover:text-white"
              >
                Load more client groups
              </button>
            ) : null}

            {selectedCampaign ? (
              <div className="rounded-2xl border border-border bg-black/10 p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <p className="text-base">{selectedCampaign.name}</p>
                  <button
                    onClick={() => setCampaignFilterId(ALL_FILTER_VALUE)}
                    className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:text-white"
                  >
                    Clear campaign filter
                  </button>
                </div>
                <div className="grid gap-3 md:grid-cols-4">
                  {[
                    ["Status", selectedCampaign.status],
                    ["Type", selectedCampaign.type],
                    ["Start date", selectedCampaign.startDate ? formatDate(selectedCampaign.startDate) : "-"],
                    ["Database size", formatNumber(selectedCampaign.databaseSize)],
                    ["Positive responses", formatNumber(selectedCampaign.positiveResponses)],
                    ["External id", selectedCampaign.externalId],
                    ["Gender target", selectedCampaign.genderTarget],
                    ["Daily stat rows", formatNumber(selectedCampaign.dailyRows)],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl bg-[#101010] p-4">
                      <p className="text-sm text-neutral-500">{label}</p>
                      <p className="mt-2 break-all text-sm text-white">{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <EmptyState
                title="Select a campaign to inspect details"
                description="Click any campaign card to open detailed campaign information."
              />
            )}
          </div>
        )}
      </Surface>
    </div>
  );
}
