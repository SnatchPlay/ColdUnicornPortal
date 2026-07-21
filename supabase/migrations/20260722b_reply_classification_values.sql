-- Outreach analytics (spec §15) needs to count negative and neutral replies separately; the
-- existing `reply_classification` enum collapsed both into `other`.
--
-- Deliberately NOT a second enum. The spec names classifications in domain form
-- (positive / negative / out_of_office / not_right_role / neutral / other_automated), but the
-- existing labels are the live n8n contract AND the value stored on every historical row. Adding a
-- parallel taxonomy would mean two sources of truth for the same fact. Instead the existing enum is
-- EXTENDED and the domain mapping is documented once, at the boundary:
--
--   OOO           → out_of_office        NRR      → not_right_role
--   Interested    → positive             negative → negative
--   neutral       → neutral              Spam_Inbound / Left_Company / other → other_automated
--
-- See docs/reference/functional/11-integrations.md §6.
--
-- NO begin/commit here on purpose: `ALTER TYPE ... ADD VALUE` cannot have its new value USED in the
-- same transaction that adds it. Nothing in this file uses them, but keeping the statements
-- transaction-free removes the trap for anyone who later appends to this file.

alter type public.reply_classification add value if not exists 'negative';
alter type public.reply_classification add value if not exists 'neutral';
