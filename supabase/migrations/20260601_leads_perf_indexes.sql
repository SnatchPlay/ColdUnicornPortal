-- Phase 4B: add indexes missing for loadLeadsList + loadLeadDetail performance.
-- Identified via EXPLAIN ANALYZE on 3972-row leads table.

-- Campaign filter currently does a full seq scan on leads (3972 rows removed by filter).
CREATE INDEX IF NOT EXISTS leads_campaign_id_idx ON public.leads (campaign_id);

-- campaigns(client_id) missing — needed for efficient client-scoped campaign lookups.
CREATE INDEX IF NOT EXISTS campaigns_client_id_idx ON public.campaigns (client_id);

-- replies(lead_id) missing — loadLeadDetail and the reply-count subquery will seq scan
-- when the replies table has data. The existing idx_replies_received covers received_at only.
CREATE INDEX IF NOT EXISTS replies_lead_id_idx ON public.replies (lead_id);

-- Duplicate: leads_updated_at_idx1 has the same definition as leads_updated_at_idx.
DROP INDEX IF EXISTS public.leads_updated_at_idx1;
