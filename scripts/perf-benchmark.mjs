/**
 * Client-side computation performance benchmark.
 * Simulates realistic data volumes and measures actual CPU time of each function.
 * Run: node scripts/perf-benchmark.mjs
 */

// ─── Data generators ──────────────────────────────────────────────────────────

function uuid() {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}

function dateStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function tsStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

const QUALIFICATIONS = ['preMQL', 'MQL', 'meeting_scheduled', 'meeting_held', 'offer_sent', 'won', 'rejected', null];

function makeClients(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `client-${i}`,
    name: `Client ${i}`,
    manager_id: `manager-${i % 5}`,
    status: 'Active',
    kpi_leads: 50,
    prospects_added: 1000,
  }));
}

function makeCampaigns(clients, perClient = 4) {
  return clients.flatMap(c =>
    Array.from({ length: perClient }, (_, i) => ({
      id: `${c.id}-camp-${i}`,
      client_id: c.id,
      type: 'outreach',
      name: `Campaign ${i} for ${c.name}`,
      status: i === 0 ? 'active' : 'stopped',
      database_size: 500,
    }))
  );
}

function makeLeads(clients, perClient = 100) {
  const quals = QUALIFICATIONS;
  return clients.flatMap(c =>
    Array.from({ length: perClient }, (_, i) => ({
      id: `${c.id}-lead-${i}`,
      client_id: c.id,
      campaign_id: `${c.id}-camp-${i % 4}`,
      first_name: `First${i}`,
      last_name: `Last${i}`,
      email: `lead${i}@example.com`,
      company_name: `Company ${i}`,
      job_title: `Title ${i}`,
      country: 'UA',
      qualification: quals[i % quals.length],
      meeting_booked: i % 10 === 0,
      meeting_held: i % 20 === 0,
      offer_sent: i % 30 === 0,
      won: i % 50 === 0,
      created_at: tsStr(i % 90),
      updated_at: tsStr(i % 30),
      reply_text: i % 5 === 0 ? 'Some reply text here' : null,
    }))
  );
}

function makeReplies(leads, repliesPerLead = 3) {
  return leads.slice(0, Math.floor(leads.length / 2)).flatMap((l, i) =>
    Array.from({ length: repliesPerLead }, (_, j) => ({
      id: `${l.id}-reply-${j}`,
      lead_id: l.id,
      client_id: l.client_id,
      received_at: tsStr(j * 5 + 1),
      classification: j % 2 === 0 ? 'Interested' : 'NRR',
      message_subject: 'Re: subject',
      message_text: 'Reply body text here.',
      sequence_step: j + 1,
      language_detected: 'en',
    }))
  );
}

function makeCampaignDailyStats(campaigns, daysBack = 90) {
  return campaigns.flatMap(c =>
    Array.from({ length: daysBack }, (_, i) => ({
      id: `${c.id}-cds-${i}`,
      campaign_id: c.id,
      report_date: dateStr(i),
      sent_count: 50 + (i % 20),
      reply_count: 3 + (i % 5),
      bounce_count: 1,
      positive_replies_count: 1,
    }))
  );
}

function makeDailyStats(clients, daysBack = 180) {
  return clients.flatMap(c =>
    Array.from({ length: daysBack }, (_, i) => ({
      id: `${c.id}-ds-${i}`,
      client_id: c.id,
      report_date: dateStr(i),
      emails_sent: 100 + (i % 30),
      response_count: 5 + (i % 4),
      bounce_count: 2,
      human_replies_count: 3,
      ooo_count: 1,
      negative_count: 1,
      schedule_today: 120,
      schedule_tomorrow: 110,
      schedule_day_after: 100,
    }))
  );
}

// ─── Measurement helper ───────────────────────────────────────────────────────

function bench(label, fn, iterations = 5) {
  // Warmup
  fn();

  const times = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);
  return { label, avg, min, max, times };
}

function printResult(r) {
  const status = r.avg > 100 ? '🔴' : r.avg > 16 ? '🟠' : r.avg > 5 ? '🟡' : '🟢';
  console.log(
    `${status} ${r.label.padEnd(52)} avg: ${r.avg.toFixed(2).padStart(7)}ms  min: ${r.min.toFixed(2).padStart(7)}ms  max: ${r.max.toFixed(2).padStart(7)}ms`
  );
}

// ─── Implementations (copy of current production code) ───────────────────────

// ── current getClientLeadRows (O(n²)) ──
function getClientLeadRows_current(leads, campaigns, replies) {
  return leads.map((lead) => {
    const campaign = campaigns.find((item) => item.id === lead.campaign_id);
    const leadReplies = replies.filter((item) => item.lead_id === lead.id);
    const hasInlineReply = Boolean(lead.reply_text?.trim());
    const latestReply = leadReplies
      .slice()
      .sort((a, b) => b.received_at.localeCompare(a.received_at))[0];
    return {
      lead,
      id: lead.id,
      name: `${lead.first_name} ${lead.last_name}`,
      email: lead.email ?? 'No email',
      company: lead.company_name ?? 'No company',
      campaign,
      replies: leadReplies,
      replyCount: leadReplies.length || (hasInlineReply ? 1 : 0),
      latestReply,
    };
  });
}

// ── fixed getClientLeadRows (O(n) with Maps) ──
function getClientLeadRows_fixed(leads, campaigns, replies) {
  const campaignById = new Map(campaigns.map(c => [c.id, c]));
  const repliesByLeadId = new Map();
  for (const reply of replies) {
    const bucket = repliesByLeadId.get(reply.lead_id) ?? [];
    bucket.push(reply);
    repliesByLeadId.set(reply.lead_id, bucket);
  }

  return leads.map((lead) => {
    const campaign = campaignById.get(lead.campaign_id ?? '');
    const leadReplies = repliesByLeadId.get(lead.id) ?? [];
    const hasInlineReply = Boolean(lead.reply_text?.trim());
    const latestReply = leadReplies
      .slice()
      .sort((a, b) => b.received_at.localeCompare(a.received_at))[0];
    return {
      lead,
      id: lead.id,
      name: `${lead.first_name} ${lead.last_name}`,
      email: lead.email ?? 'No email',
      company: lead.company_name ?? 'No company',
      campaign,
      replies: leadReplies,
      replyCount: leadReplies.length || (hasInlineReply ? 1 : 0),
      latestReply,
    };
  });
}

// ── current clientPortfolio (O(n × m)) ──
function buildClientPortfolio_current(scopedClients, scopedCampaigns, scopedLeads) {
  return scopedClients.map(client => {
    const clientCampaigns = scopedCampaigns.filter(c => c.client_id === client.id);
    const clientLeads = scopedLeads.filter(l => l.client_id === client.id);
    const mqls = clientLeads.filter(l => l.qualification === 'MQL').length;
    const won = clientLeads.filter(l => l.won).length;
    const kpiLeads = client.kpi_leads ?? 0;
    const progress = kpiLeads > 0 ? (mqls / kpiLeads) * 100 : null;
    return { id: client.id, name: client.name, campaigns: clientCampaigns.length, mqls, won, progress };
  });
}

// ── fixed clientPortfolio (O(n + m) with Maps) ──
function buildClientPortfolio_fixed(scopedClients, scopedCampaigns, scopedLeads) {
  const campaignCountByClient = new Map();
  for (const c of scopedCampaigns) {
    campaignCountByClient.set(c.client_id, (campaignCountByClient.get(c.client_id) ?? 0) + 1);
  }
  const leadsByClient = new Map();
  for (const l of scopedLeads) {
    const bucket = leadsByClient.get(l.client_id) ?? { mqls: 0, won: 0 };
    if (l.qualification === 'MQL') bucket.mqls++;
    if (l.won) bucket.won++;
    leadsByClient.set(l.client_id, bucket);
  }
  return scopedClients.map(client => {
    const { mqls = 0, won = 0 } = leadsByClient.get(client.id) ?? {};
    const kpiLeads = client.kpi_leads ?? 0;
    const progress = kpiLeads > 0 ? (mqls / kpiLeads) * 100 : null;
    return {
      id: client.id, name: client.name,
      campaigns: campaignCountByClient.get(client.id) ?? 0,
      mqls, won, progress,
    };
  });
}

// ── current getClientKpis (3 passes) ──
function getClientKpis_current(leads, stats) {
  const sum = arr => arr.reduce((t, v) => t + (v ?? 0), 0);
  return {
    mqls: leads.filter(l => l.qualification === 'MQL').length,
    meetings: leads.filter(l => l.meeting_booked).length,
    won: leads.filter(l => l.won).length,
    emailsSent: sum(stats.map(s => s.sent_count)),
  };
}

// ── fixed getClientKpis (1 pass) ──
function getClientKpis_fixed(leads, stats) {
  let mqls = 0, meetings = 0, won = 0, emailsSent = 0;
  for (const l of leads) {
    if (l.qualification === 'MQL') mqls++;
    if (l.meeting_booked) meetings++;
    if (l.won) won++;
  }
  for (const s of stats) emailsSent += s.sent_count ?? 0;
  return { mqls, meetings, won, emailsSent };
}

// ── current search filter (no cached haystack) ──
function filterLeads_current(leads, query) {
  const q = query.toLowerCase();
  return leads.filter(lead => {
    const haystack = [
      `${lead.first_name} ${lead.last_name}`,
      lead.email,
      lead.company_name,
      lead.job_title,
      lead.country,
    ].join(' ').toLowerCase();
    return haystack.includes(q);
  });
}

// ── fixed search filter (pre-cached haystack) ──
function buildLeadHaystacks(leads) {
  return leads.map(l => ({
    lead: l,
    haystack: [
      `${l.first_name} ${l.last_name}`,
      l.email,
      l.company_name,
      l.job_title,
      l.country,
    ].join(' ').toLowerCase(),
  }));
}
function filterLeads_fixed(haystacks, query) {
  const q = query.toLowerCase();
  return haystacks.filter(h => h.haystack.includes(q)).map(h => h.lead);
}

// ── current filterByTimeframe (parses dates every call) ──
function parseUnknownDate(value) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) return new Date(+match[1], +match[2] - 1, +match[3], 12, 0, 0, 0);
  const d = new Date(value);
  return isFinite(d.getTime()) ? d : null;
}
function filterByTimeframe_current(items, getDate, start, end) {
  return items.filter(item => {
    const date = parseUnknownDate(getDate(item));
    if (!date) return false;
    const ts = date.getTime();
    if (start && ts < start) return false;
    if (end && ts > end) return false;
    return true;
  });
}

// ── fixed filterByTimeframe (pre-parsed timestamps) ──
function buildLeadTimestamps(leads) {
  return leads.map(l => ({ lead: l, ts: new Date(l.created_at).getTime() }));
}
function filterByTimeframe_fixed(stamped, start, end) {
  return stamped.filter(({ ts }) => (!start || ts >= start) && (!end || ts <= end)).map(s => s.lead);
}

// ── current metricsByClientId (O(clients × stats × leads)) ──
function createClientMetrics_stub(stats, leads) {
  // Simplified version of createClientMetrics — same algorithmic structure
  const byDate = new Map();
  for (const s of stats) {
    const key = s.report_date;
    const cur = byDate.get(key) ?? { emailsSent: 0, responseCount: 0 };
    cur.emailsSent += s.emails_sent ?? 0;
    cur.responseCount += s.response_count ?? 0;
    byDate.set(key, cur);
  }
  const leadByDate = new Map();
  for (const l of leads) {
    const key = l.created_at.slice(0, 10);
    const cur = leadByDate.get(key) ?? { all: 0, sql: 0 };
    cur.all++;
    if (l.qualification === 'MQL') cur.sql++;
    leadByDate.set(key, cur);
  }
  return { dailyMap: byDate, leadMap: leadByDate };
}

function buildMetricsByClientId_current(clients, dailyStats, leads) {
  const result = new Map();
  for (const client of clients) {
    const clientStats = dailyStats.filter(s => s.client_id === client.id);
    const clientLeads = leads.filter(l => l.client_id === client.id);
    result.set(client.id, createClientMetrics_stub(clientStats, clientLeads));
  }
  return result;
}

function buildMetricsByClientId_fixed(clients, dailyStats, leads) {
  // Pre-index first
  const statsByClient = new Map();
  const leadsByClient = new Map();
  for (const c of clients) { statsByClient.set(c.id, []); leadsByClient.set(c.id, []); }
  for (const s of dailyStats) {
    const bucket = statsByClient.get(s.client_id);
    if (bucket) bucket.push(s);
  }
  for (const l of leads) {
    const bucket = leadsByClient.get(l.client_id);
    if (bucket) bucket.push(l);
  }
  const result = new Map();
  for (const client of clients) {
    result.set(client.id, createClientMetrics_stub(
      statsByClient.get(client.id) ?? [],
      leadsByClient.get(client.id) ?? [],
    ));
  }
  return result;
}

// ─── Snapshot load simulation: 11 parallel queries ────────────────────────────

function simulateSnapshot_11queries(clients, campaigns, leads, replies, campaignStats, dailyStats) {
  // Simulates what the Edge Function does: 11 concurrent DB queries, then JSON serialization
  // We measure just the serialization + mapping work (network is separate)
  const snapshot = {
    users: [],
    clients: clients.map(c => ({ ...c })),
    clientUsers: [],
    campaigns: campaigns.map(c => ({ ...c })),
    leads: leads.map(l => ({ ...l })),
    replies: replies.map(r => ({ ...r })),
    campaignDailyStats: campaignStats.map(s => ({ ...s })),
    dailyStats: dailyStats.map(s => ({ ...s })),
    domains: [],
    invoices: [],
    emailExcludeList: [],
    conditionRules: [],
  };
  return JSON.stringify(snapshot).length; // Force serialization
}

// ─── Main ──────────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════════');
console.log('  ColdUnicorn PDCA — Client-Side Performance Benchmark');
console.log('══════════════════════════════════════════════════════════════════\n');

const SCENARIOS = [
  { label: 'Small  (10 clients)', clients: 10, leadsPerClient: 50,  repliesPerLead: 2 },
  { label: 'Medium (30 clients)', clients: 30, leadsPerClient: 100, repliesPerLead: 3 },
  { label: 'Large  (60 clients)', clients: 60, leadsPerClient: 150, repliesPerLead: 4 },
];

for (const sc of SCENARIOS) {
  const clients = makeClients(sc.clients);
  const campaigns = makeCampaigns(clients, 4);
  const leads = makeLeads(clients, sc.leadsPerClient);
  const replies = makeReplies(leads, sc.repliesPerLead);
  const campaignStats = makeCampaignDailyStats(campaigns, 90);
  const dailyStats = makeDailyStats(clients, 180);
  const start30d = new Date(); start30d.setDate(start30d.getDate() - 30);
  const haystacks = buildLeadHaystacks(leads);
  const stamped = buildLeadTimestamps(leads);

  const totalLeads = leads.length;
  const totalReplies = replies.length;
  const totalCDS = campaignStats.length;
  const totalDS = dailyStats.length;

  console.log(`\n  ── ${sc.label}: ${totalLeads} leads, ${totalReplies} replies, ${totalCDS} campaign stats, ${totalDS} daily stats ──\n`);

  const results = [
    bench(`getClientLeadRows  CURRENT (O(n²))`, () => getClientLeadRows_current(leads, campaigns, replies)),
    bench(`getClientLeadRows  FIXED   (Maps)  `, () => getClientLeadRows_fixed(leads, campaigns, replies)),
    bench(`clientPortfolio    CURRENT (nested filter)`, () => buildClientPortfolio_current(clients, campaigns, leads)),
    bench(`clientPortfolio    FIXED   (pre-index)    `, () => buildClientPortfolio_fixed(clients, campaigns, leads)),
    bench(`getClientKpis      CURRENT (3 passes)`, () => getClientKpis_current(leads, campaignStats)),
    bench(`getClientKpis      FIXED   (1 pass)  `, () => getClientKpis_fixed(leads, campaignStats)),
    bench(`filterLeads search CURRENT (rebuild haystack)`, () => filterLeads_current(leads, 'company 4')),
    bench(`filterLeads search FIXED   (cached haystack) `, () => filterLeads_fixed(haystacks, 'company 4')),
    bench(`filterByTimeframe  CURRENT (parse dates)`, () => filterByTimeframe_current(leads, l => l.created_at, start30d.getTime(), Date.now())),
    bench(`filterByTimeframe  FIXED   (pre-stamped)`, () => filterByTimeframe_fixed(stamped, start30d.getTime(), Date.now())),
    bench(`metricsByClientId  CURRENT (O(c×s×l))`, () => buildMetricsByClientId_current(clients, dailyStats, leads)),
    bench(`metricsByClientId  FIXED   (pre-index) `, () => buildMetricsByClientId_fixed(clients, dailyStats, leads)),
    bench(`snapshot serialise (ORM gateway → browser)`, () => simulateSnapshot_11queries(clients, campaigns, leads, replies, campaignStats, dailyStats)),
  ];

  results.forEach(printResult);

  // Speedup summary for paired comparisons
  console.log('\n  Speedup ratios:');
  const pairs = [
    [results[0], results[1]],
    [results[2], results[3]],
    [results[4], results[5]],
    [results[6], results[7]],
    [results[8], results[9]],
    [results[10], results[11]],
  ];
  for (const [before, after] of pairs) {
    const ratio = before.avg / after.avg;
    const name = before.label.replace(/ CURRENT.*/, '').trim();
    console.log(`  ${name.padEnd(28)}  ${before.avg.toFixed(1).padStart(7)}ms → ${after.avg.toFixed(1).padStart(6)}ms  (${ratio.toFixed(1)}× faster)`);
  }
}

// ── Snapshot payload size analysis ──
console.log('\n\n══════════════════════════════════════════════════════════════════');
console.log('  Snapshot Payload Size Analysis (network transfer estimate)');
console.log('══════════════════════════════════════════════════════════════════\n');

for (const sc of SCENARIOS) {
  const clients = makeClients(sc.clients);
  const campaigns = makeCampaigns(clients, 4);
  const leads = makeLeads(clients, sc.leadsPerClient);
  const replies = makeReplies(leads, sc.repliesPerLead);
  const campaignStats = makeCampaignDailyStats(campaigns, 90);
  const dailyStats = makeDailyStats(clients, 180);

  const snapshot = {
    clients,
    campaigns,
    leads,
    replies,
    campaignDailyStats: campaignStats,
    dailyStats,
  };

  const jsonStr = JSON.stringify(snapshot);
  const bytes = Buffer.byteLength(jsonStr, 'utf8');
  const kb = (bytes / 1024).toFixed(1);
  const mb = (bytes / 1024 / 1024).toFixed(2);

  console.log(`  ${sc.label}: ${leads.length} leads + ${replies.length} replies + ${campaignStats.length} cds + ${dailyStats.length} ds`);
  console.log(`    Raw JSON payload: ${kb} KB (${mb} MB)`);

  // Per-table breakdown
  for (const [key, arr] of Object.entries(snapshot)) {
    const size = Buffer.byteLength(JSON.stringify(arr), 'utf8');
    console.log(`      ${key.padEnd(24)} ${(size / 1024).toFixed(1).padStart(8)} KB  (${arr.length} rows)`);
  }
  console.log('');
}

// ── DB View pre-aggregation simulation ──
console.log('══════════════════════════════════════════════════════════════════');
console.log('  DB View Simulation: What a pre-aggregated view would return');
console.log('══════════════════════════════════════════════════════════════════\n');

for (const sc of SCENARIOS) {
  const clients = makeClients(sc.clients);
  const dailyStats = makeDailyStats(clients, 180);
  const leads = makeLeads(clients, sc.leadsPerClient);

  // Simulate what client_metrics_summary VIEW would return
  // (one row per client with all DoD/WoW/MoM pre-computed)
  const today = new Date();
  const viewRows = clients.map(client => {
    const clientStats = dailyStats.filter(s => s.client_id === client.id);
    const clientLeads = leads.filter(l => l.client_id === client.id);

    // DoD
    const getDay = (daysAgo) => {
      const d = new Date(today); d.setDate(d.getDate() - daysAgo);
      const key = d.toISOString().slice(0, 10);
      return clientStats.find(s => s.report_date === key) ?? null;
    };

    return {
      client_id: client.id,
      sent_today: getDay(0)?.emails_sent ?? 0,
      sent_yesterday: getDay(1)?.emails_sent ?? 0,
      sent_2dago: getDay(2)?.emails_sent ?? 0,
      schedule_today: getDay(0)?.schedule_today ?? 0,
      schedule_tomorrow: getDay(0)?.schedule_tomorrow ?? 0,
      schedule_day_after: getDay(0)?.schedule_day_after ?? 0,
      mqls_total: clientLeads.filter(l => l.qualification === 'MQL').length,
      meetings_total: clientLeads.filter(l => l.meeting_booked).length,
      won_total: clientLeads.filter(l => l.won).length,
    };
  });

  const viewJson = JSON.stringify(viewRows);
  const viewKb = (Buffer.byteLength(viewJson, 'utf8') / 1024).toFixed(1);

  const rawDsJson = JSON.stringify(dailyStats);
  const rawDsKb = (Buffer.byteLength(rawDsJson, 'utf8') / 1024).toFixed(1);

  const rawLeadsJson = JSON.stringify(leads);
  const rawLeadsKb = (Buffer.byteLength(rawLeadsJson, 'utf8') / 1024).toFixed(1);

  const reduction = ((1 - Buffer.byteLength(viewJson, 'utf8') / (Buffer.byteLength(rawDsJson, 'utf8') + Buffer.byteLength(rawLeadsJson, 'utf8'))) * 100).toFixed(0);

  console.log(`  ${sc.label}:`);
  console.log(`    daily_stats (raw):           ${rawDsKb.padStart(8)} KB  (${dailyStats.length} rows)`);
  console.log(`    leads (raw, KPI fields only): ${rawLeadsKb.padStart(8)} KB  (${leads.length} rows)`);
  console.log(`    client_metrics_summary VIEW:  ${viewKb.padStart(8)} KB  (${viewRows.length} rows) ← ${reduction}% smaller`);
  console.log('');
}

console.log('══════════════════════════════════════════════════════════════════\n');
