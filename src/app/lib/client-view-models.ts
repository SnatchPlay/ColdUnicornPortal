import { formatDate, formatNumber, getFullName } from "./format";
import { getLeadStage } from "./selectors";
import type {
  CampaignDailyStatRecord,
  CampaignRecord,
  ClientRecord,
  LeadQualification,
  LeadRecord,
  ReplyRecord,
} from "../types/core";

export type PipelineStage = LeadQualification | "unqualified";

export const PIPELINE_STAGES: Array<{ key: PipelineStage; label: string; color: string }> = [
  { key: "preMQL", label: "Pre-MQL", color: "#facc15" },
  { key: "MQL", label: "MQL", color: "#3b82f6" },
  { key: "meeting_scheduled", label: "Meeting Scheduled", color: "#c084fc" },
  { key: "meeting_held", label: "Meeting Held", color: "#818cf8" },
  { key: "offer_sent", label: "Offer Sent", color: "#f97316" },
  { key: "won", label: "Won", color: "#22c55e" },
  { key: "rejected", label: "Rejected", color: "#fb7185" },
];

function sum(values: Array<number | null | undefined>) {
  return values.reduce((total, value) => total + (value ?? 0), 0);
}

export function getClientKpis(
  clients: ClientRecord[],
  campaigns: CampaignRecord[],
  leads: LeadRecord[],
  stats: CampaignDailyStatRecord[],
) {
  const prospectsFromCampaigns = sum(campaigns.map((item) => item.database_size));
  const prospectsFromClients = sum(clients.map((item) => item.prospects_added));
  return {
    mqls: leads.filter((item) => item.qualification === "MQL").length,
    meetings: leads.filter((item) => item.meeting_booked).length,
    won: leads.filter((item) => item.won).length,
    emailsSent: sum(stats.map((item) => item.sent_count)),
    prospects: prospectsFromCampaigns || prospectsFromClients,
  };
}

export function getPipelineCounts(leads: LeadRecord[]) {
  const counts = new Map<PipelineStage, number>();
  for (const stage of PIPELINE_STAGES) counts.set(stage.key, 0);
  for (const lead of leads) {
    const stage = getLeadStage(lead);
    counts.set(stage, (counts.get(stage) ?? 0) + 1);
  }
  return PIPELINE_STAGES.map((stage) => ({
    ...stage,
    count: counts.get(stage.key) ?? 0,
  }));
}

export function getDailySentSeries(stats: CampaignDailyStatRecord[]) {
  const byDate = new Map<string, number>();
  for (const stat of stats) {
    byDate.set(stat.report_date, (byDate.get(stat.report_date) ?? 0) + (stat.sent_count ?? 0));
  }
  return Array.from(byDate.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, sent]) => ({
      date,
      label: formatDate(date, { day: "numeric", month: "short" }),
      sent,
    }));
}

export function getPipelineActivitySeries(leads: LeadRecord[]) {
  const byDate = new Map<string, { date: string; mqls: number; meetings: number; won: number }>();
  for (const lead of leads) {
    const date = lead.updated_at?.slice(0, 10) || lead.created_at.slice(0, 10);
    const current = byDate.get(date) ?? { date, mqls: 0, meetings: 0, won: 0 };
    if (lead.qualification === "MQL") current.mqls += 1;
    if (lead.meeting_booked) current.meetings += 1;
    if (lead.won) current.won += 1;
    byDate.set(date, current);
  }
  return Array.from(byDate.values())
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((item) => ({
      ...item,
      label: formatDate(item.date, { day: "numeric", month: "short" }),
    }));
}

export function getCampaignPerformance(campaigns: CampaignRecord[], stats: CampaignDailyStatRecord[]) {
  return campaigns
    .map((campaign) => {
      const campaignStats = stats.filter((item) => item.campaign_id === campaign.id);
      const sent = sum(campaignStats.map((item) => item.sent_count));
      const replies = sum(campaignStats.map((item) => item.reply_count));
      const replyRate = sent > 0 ? (replies / sent) * 100 : 0;
      return {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        sent,
        replies,
        replyRate,
      };
    })
    .sort((left, right) => right.replyRate - left.replyRate);
}

export function getConversionRates(leads: LeadRecord[], prospects: number) {
  const mqls = leads.filter((item) => item.qualification === "MQL").length;
  const meetings = leads.filter((item) => item.meeting_booked).length;
  const won = leads.filter((item) => item.won).length;
  return [
    {
      label: "Prospects",
      value: prospects,
      from: prospects,
      rateLabel: "",
      color: "#3b82f6",
    },
    {
      label: "MQLs",
      value: mqls,
      from: prospects,
      rateLabel: prospects ? `${((mqls / prospects) * 100).toFixed(1)}%` : "0%",
      color: "#8b5cf6",
    },
    {
      label: "Meetings",
      value: meetings,
      from: mqls,
      rateLabel: mqls ? `${((meetings / mqls) * 100).toFixed(1)}%` : "0%",
      color: "#a855f7",
    },
    {
      label: "Won",
      value: won,
      from: meetings,
      rateLabel: meetings ? `${((won / meetings) * 100).toFixed(1)}%` : "0%",
      color: "#22c55e",
    },
  ];
}

export function getClientLeadRows(
  leads: LeadRecord[],
  campaigns: CampaignRecord[],
  replies: ReplyRecord[],
) {
  return leads.map((lead) => {
    const stage = getLeadStage(lead);
    const campaign = campaigns.find((item) => item.id === lead.campaign_id);
    const leadReplies = replies.filter((item) => item.lead_id === lead.id);
    const hasInlineReply = Boolean(lead.reply_text?.trim());
    const latestReply = leadReplies
      .slice()
      .sort((left, right) => right.received_at.localeCompare(left.received_at))[0];
    return {
      lead,
      id: lead.id,
      name: getFullName(lead.first_name, lead.last_name),
      initials: getFullName(lead.first_name, lead.last_name)
        .split(" ")
        .map((item) => item[0])
        .join("")
        .slice(0, 2)
        .toUpperCase(),
      email: lead.email ?? "No email",
      company: lead.company_name ?? "No company",
      title: lead.job_title ?? "No title",
      stage,
      campaignName: campaign?.name ?? "No campaign linked",
      step: lead.message_number ?? latestReply?.sequence_step ?? null,
      replyCount: leadReplies.length || (hasInlineReply ? 1 : 0),
      lastReplyDate: latestReply?.received_at ?? (hasInlineReply ? lead.updated_at : null),
      addedDate: lead.created_at,
      campaign,
      replies: leadReplies,
    };
  });
}

export function formatCompact(value: number | null | undefined) {
  if (!value) return "0";
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}K`;
  return formatNumber(value);
}
