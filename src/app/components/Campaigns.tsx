import { useState } from 'react';
import {
  Search, ChevronRight, X, Plus, Calendar, BarChart2,
  ArrowRight, Clock, Filter
} from 'lucide-react';
import { mockCampaigns, mockCampaignDailyStats, mockOooRouting } from '../data/mock';
import type { Campaign, CampaignType, CampaignDailyStat } from '../data/schema';

// ── Config ───────────────────────────────────────────────────

const campaignTypeConfig: Record<CampaignType, { label: string; color: string }> = {
  outreach: { label: 'Outreach', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  ooo:      { label: 'OOO',      color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' },
  nurture:  { label: 'Nurture',  color: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
};

const statusConfig: Record<string, { label: string; color: string; dot: string }> = {
  active:    { label: 'Active',    color: 'bg-green-500/10 text-green-400 border-green-500/20',  dot: 'bg-green-400'  },
  paused:    { label: 'Paused',    color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20', dot: 'bg-yellow-400' },
  completed: { label: 'Completed', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20',     dot: 'bg-blue-400'   },
  draft:     { label: 'Draft',     color: 'bg-secondary text-muted-foreground border-border',     dot: 'bg-gray-500'   },
};

function getStatusCfg(status: string | null) {
  return statusConfig[status ?? ''] ?? { label: status ?? '—', color: 'bg-secondary/50 text-muted-foreground', dot: 'bg-gray-500' };
}

// Aggregate campaign_daily_stats per campaign
function aggregateStats(campaignId: string): {
  sent_count: number; reply_count: number; bounce_count: number; unique_open_count: number;
  reply_rate: number; open_rate: number; bounce_rate: number;
  days: CampaignDailyStat[];
} {
  const days = mockCampaignDailyStats.filter(s => s.campaign_id === campaignId);
  const sent = days.reduce((a, s) => a + s.sent_count, 0);
  const replies = days.reduce((a, s) => a + s.reply_count, 0);
  const bounces = days.reduce((a, s) => a + s.bounce_count, 0);
  const opens = days.reduce((a, s) => a + s.unique_open_count, 0);
  return {
    sent_count: sent,
    reply_count: replies,
    bounce_count: bounces,
    unique_open_count: opens,
    reply_rate: sent > 0 ? parseFloat(((replies / sent) * 100).toFixed(2)) : 0,
    open_rate: sent > 0 ? parseFloat(((opens / sent) * 100).toFixed(2)) : 0,
    bounce_rate: sent > 0 ? parseFloat(((bounces / sent) * 100).toFixed(2)) : 0,
    days,
  };
}

// ── Campaign Drawer ───────────────────────────────────────────

function CampaignDrawer({ campaign, onClose }: { campaign: Campaign; onClose: () => void }) {
  const stats = aggregateStats(campaign.id);
  const statusCfg = getStatusCfg(campaign.status);
  const typeCfg = campaignTypeConfig[campaign.type];
  const oooRouting = mockOooRouting.filter(r => r.campaign_id === campaign.id);

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="w-[520px] max-w-full h-full bg-[#111111] border-l border-border flex flex-col overflow-hidden">

        {/* Header */}
        <div className="p-5 border-b border-border bg-[#0d0d0d]">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h2 className="text-base mb-1">{campaign.name}</h2>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-xs ${statusCfg.color}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.dot}`} />
                  {statusCfg.label}
                </span>
                <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs ${typeCfg.color}`}>
                  {typeCfg.label}
                </span>
                {campaign.external_id && (
                  <span className="text-xs text-muted-foreground bg-secondary/40 px-2 py-0.5 rounded font-mono">
                    {campaign.external_id}
                  </span>
                )}
              </div>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 hover:bg-white/5 rounded">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">

          {/* campaigns table fields */}
          <div className="p-5 border-b border-border">
            <h3 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">campaigns table</h3>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'id',          value: campaign.id,                    mono: true },
                { label: 'client_id',   value: campaign.client_id,             mono: true },
                { label: 'external_id', value: campaign.external_id ?? 'null', mono: true },
                { label: 'type',        value: campaign.type,                  mono: false },
                { label: 'status',      value: campaign.status ?? 'null',      mono: false },
                { label: 'database_size', value: campaign.database_size.toLocaleString(), mono: false },
                { label: 'created_at',  value: new Date(campaign.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }), mono: false },
              ].map(({ label, value, mono }) => (
                <div key={label} className="bg-secondary/20 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1 font-mono">{label}</p>
                  <p className={`text-xs truncate ${mono ? 'font-mono text-muted-foreground' : ''}`}>{value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* campaign_daily_stats aggregated */}
          <div className="p-5 border-b border-border">
            <h3 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">
              campaign_daily_stats (aggregated · {stats.days.length} rows)
            </h3>
            {stats.days.length > 0 ? (
              <>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {[
                    { label: 'sent_count',        value: stats.sent_count.toLocaleString(), color: '' },
                    { label: 'reply_count',        value: stats.reply_count,                 color: 'text-green-400' },
                    { label: 'bounce_count',       value: stats.bounce_count,                color: stats.bounce_rate > 3 ? 'text-red-400' : 'text-orange-400' },
                    { label: 'unique_open_count',  value: stats.unique_open_count,           color: 'text-blue-400' },
                    { label: 'reply_rate',         value: `${stats.reply_rate}%`,            color: 'text-green-400' },
                    { label: 'open_rate',          value: `${stats.open_rate}%`,             color: 'text-blue-400' },
                    { label: 'bounce_rate',        value: `${stats.bounce_rate}%`,           color: stats.bounce_rate > 3 ? 'text-red-400' : 'text-green-400' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="bg-secondary/20 rounded-lg p-3">
                      <p className="text-xs text-muted-foreground mb-0.5 font-mono">{label}</p>
                      <p className={`text-sm ${color}`}>{value}</p>
                    </div>
                  ))}
                </div>

                {/* Daily breakdown */}
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Daily rows:</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border">
                          {['report_date', 'sent_count', 'reply_count', 'bounce_count', 'unique_open_count'].map(h => (
                            <th key={h} className="text-left py-1.5 px-2 text-muted-foreground font-mono whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {stats.days.map(d => (
                          <tr key={d.id} className="hover:bg-secondary/10">
                            <td className="py-1.5 px-2 text-muted-foreground">{d.report_date}</td>
                            <td className="py-1.5 px-2">{d.sent_count}</td>
                            <td className="py-1.5 px-2 text-green-400">{d.reply_count}</td>
                            <td className={`py-1.5 px-2 ${d.bounce_count > 5 ? 'text-orange-400' : ''}`}>{d.bounce_count}</td>
                            <td className="py-1.5 px-2 text-blue-400">{d.unique_open_count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No stats rows yet (campaign not launched)</p>
            )}
          </div>

          {/* OOO Routing if applicable */}
          {oooRouting.length > 0 && (
            <div className="p-5 border-b border-border">
              <h3 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">client_ooo_routing</h3>
              <div className="space-y-2">
                {oooRouting.map(r => (
                  <div key={r.id} className="bg-yellow-500/5 border border-yellow-500/15 rounded-lg p-3">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground font-mono">gender</span>
                      <span className="capitalize">{r.gender}</span>
                    </div>
                    <div className="flex justify-between text-xs mt-1">
                      <span className="text-muted-foreground font-mono">is_active</span>
                      <span className={r.is_active ? 'text-green-400' : 'text-red-400'}>{String(r.is_active)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border bg-[#0d0d0d]">
          <p className="text-xs text-muted-foreground text-center">
            campaign_id: <code className="font-mono">{campaign.id}</code>
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────

export function Campaigns() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<CampaignType | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selected, setSelected] = useState<Campaign | null>(null);

  const filtered = mockCampaigns.filter(c => {
    const matchSearch = c.name.toLowerCase().includes(search.toLowerCase())
      || (c.external_id ?? '').toLowerCase().includes(search.toLowerCase());
    const matchType = typeFilter === 'all' || c.type === typeFilter;
    const matchStatus = statusFilter === 'all' || c.status === statusFilter;
    return matchSearch && matchType && matchStatus;
  });

  // Summary from campaign_daily_stats
  const totalSent    = mockCampaignDailyStats.reduce((a, s) => a + s.sent_count, 0);
  const totalReplies = mockCampaignDailyStats.reduce((a, s) => a + s.reply_count, 0);
  const totalBounces = mockCampaignDailyStats.reduce((a, s) => a + s.bounce_count, 0);
  const totalOpens   = mockCampaignDailyStats.reduce((a, s) => a + s.unique_open_count, 0);

  const statuses = Array.from(new Set(mockCampaigns.map(c => c.status).filter(Boolean))) as string[];
  const types: CampaignType[] = ['outreach', 'ooo', 'nurture'];

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="mb-1">Campaigns</h1>
            <p className="text-sm text-muted-foreground">
              Source: <code className="text-xs bg-secondary/50 px-1 rounded">campaigns</code> + <code className="text-xs bg-secondary/50 px-1 rounded">campaign_daily_stats</code>
            </p>
          </div>
          <button className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-sm">
            <Plus className="w-4 h-4" />New Campaign
          </button>
        </div>

        {/* Summary KPIs from campaign_daily_stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'sent_count (total)',        value: totalSent.toLocaleString(),    color: 'text-blue-400' },
            { label: 'reply_count (total)',        value: totalReplies,                   color: 'text-green-400' },
            { label: 'unique_open_count (total)', value: totalOpens.toLocaleString(),   color: 'text-purple-400' },
            { label: 'bounce_count (total)',       value: totalBounces,                  color: totalBounces / totalSent > 0.03 ? 'text-red-400' : 'text-orange-400' },
          ].map(m => (
            <div key={m.label} className="bg-card border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground font-mono mb-2">{m.label}</p>
              <p className={`text-2xl font-semibold ${m.color}`}>{m.value}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name or external_id..."
              className="w-full pl-10 pr-4 py-2 bg-secondary/50 border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* type filter */}
          <div className="flex gap-1 bg-secondary/30 rounded-lg p-1">
            <button onClick={() => setTypeFilter('all')} className={`px-3 py-1 rounded text-xs transition-all ${typeFilter === 'all' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>All</button>
            {types.map(t => (
              <button key={t} onClick={() => setTypeFilter(t)} className={`px-3 py-1 rounded text-xs transition-all capitalize ${typeFilter === t ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{t}</button>
            ))}
          </div>

          {/* status filter */}
          <div className="flex gap-1 bg-secondary/30 rounded-lg p-1">
            <button onClick={() => setStatusFilter('all')} className={`px-3 py-1 rounded text-xs transition-all ${statusFilter === 'all' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>All Status</button>
            {statuses.map(s => (
              <button key={s} onClick={() => setStatusFilter(s)} className={`px-3 py-1 rounded text-xs transition-all capitalize ${statusFilter === s ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{s}</button>
            ))}
          </div>
        </div>

        {/* Campaign Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map(campaign => {
            const stats = aggregateStats(campaign.id);
            const statusCfg = getStatusCfg(campaign.status);
            const typeCfg = campaignTypeConfig[campaign.type];

            return (
              <div
                key={campaign.id}
                onClick={() => setSelected(campaign)}
                className="bg-card border border-border rounded-lg p-5 hover:border-primary/30 cursor-pointer transition-all group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm truncate mb-1">{campaign.name}</h3>
                    {campaign.external_id && (
                      <p className="text-xs text-muted-foreground font-mono">{campaign.external_id}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 ml-3">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-xs shrink-0 ${statusCfg.color}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.dot}`} />
                      {statusCfg.label}
                    </span>
                    <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                </div>

                {/* Type badge */}
                <div className="flex gap-2 mb-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs ${typeCfg.color}`}>
                    {typeCfg.label}
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-secondary/40 rounded text-xs text-muted-foreground">
                    <BarChart2 className="w-3 h-3" />
                    {campaign.database_size.toLocaleString()} in base
                  </span>
                </div>

                {/* Stats from campaign_daily_stats */}
                {stats.days.length > 0 ? (
                  <div className="grid grid-cols-4 gap-2 mb-3">
                    {[
                      { label: 'sent_count',  value: stats.sent_count.toLocaleString(), color: '' },
                      { label: 'reply_count', value: stats.reply_count, color: 'text-green-400' },
                      { label: 'reply_rate',  value: `${stats.reply_rate}%`, color: stats.reply_rate >= 5 ? 'text-green-400' : 'text-yellow-400' },
                      { label: 'bounce_count', value: stats.bounce_count, color: stats.bounce_rate > 3 ? 'text-red-400' : 'text-orange-400' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="text-center bg-secondary/20 rounded-lg py-2">
                        <p className={`text-sm ${color}`}>{value}</p>
                        <p className="text-xs text-muted-foreground font-mono truncate px-1">{label}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mb-3 p-2 bg-secondary/10 rounded text-xs text-muted-foreground text-center">
                    No campaign_daily_stats rows yet
                  </div>
                )}

                {/* Footer */}
                <div className="flex items-center justify-between pt-3 border-t border-border/50">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {new Date(campaign.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                  {stats.days.length > 0 && (
                    <span className="text-xs text-muted-foreground">{stats.days.length} stat rows</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <div className="bg-card border border-border rounded-lg p-12 text-center text-muted-foreground">
            No campaigns match filters
          </div>
        )}

        {/* OOO Routing rules */}
        <div className="bg-card border border-border rounded-lg p-6">
          <h3 className="mb-1">client_ooo_routing</h3>
          <p className="text-xs text-muted-foreground mb-4">Rule engine for OOO re-engagement routing by lead gender</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/30">
                <tr>
                  {['id', 'client_id', 'gender', 'campaign_id (campaign name)', 'is_active'].map(h => (
                    <th key={h} className="text-left p-3 text-xs text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {mockOooRouting.map(r => {
                  const camp = mockCampaigns.find(c => c.id === r.campaign_id);
                  return (
                    <tr key={r.id} className="hover:bg-secondary/10 transition-colors">
                      <td className="p-3 text-xs text-muted-foreground font-mono">{r.id}</td>
                      <td className="p-3 text-xs text-muted-foreground font-mono">{r.client_id}</td>
                      <td className="p-3">
                        <span className={`text-xs px-2 py-0.5 rounded capitalize ${r.gender === 'male' ? 'bg-blue-500/10 text-blue-400' : 'bg-pink-500/10 text-pink-400'}`}>
                          {r.gender}
                        </span>
                      </td>
                      <td className="p-3 text-sm">{camp?.name ?? r.campaign_id}</td>
                      <td className="p-3">
                        <span className={`text-xs ${r.is_active ? 'text-green-400' : 'text-red-400'}`}>
                          {String(r.is_active)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {selected && <CampaignDrawer campaign={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
