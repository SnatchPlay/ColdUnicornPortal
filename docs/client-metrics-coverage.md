# Client Metrics Coverage (Manager/Admin)

This document tracks how Excel-style client metrics map to the current app data model.

Status values:
- `Implemented`: metric is computed in the app from existing data.
- `Missing source`: required source field does not exist in current DB/API payloads.

| Excel field / block | App source | Formula / logic in app | Status |
| --- | --- | --- | --- |
| DoD Schedule `+2/+1/0` | `daily_stats.schedule_day_after / schedule_tomorrow / schedule_today` | Current day schedule values grouped as `+2/+1/0` | Implemented |
| DoD Daily sent `0/-1/-2/-3/-4` | `daily_stats.emails_sent` | Daily sent count for current day and previous 4 days | Implemented |
| 3DoD TOTAL leads `0..-4` | `leads.created_at`, `leads.qualification` | Count where qualification is `preMQL` or `MQL` by day | Implemented |
| 3DoD SQL leads `0..-4` | `leads.created_at`, `leads.qualification` | Count where qualification is `MQL` by day | Implemented |
| WoW Bounce rate `0..-3` | `daily_stats.bounce_count`, `daily_stats.emails_sent` | `sum(bounce) / sum(sent)` per week | Implemented |
| WoW Total response rate `0..-3` | `daily_stats.response_count`, `daily_stats.emails_sent` | `sum(response) / sum(sent)` per week | Implemented |
| WoW Human response rate `0..-3` | `daily_stats.human_replies_count`, `daily_stats.emails_sent` | `sum(human_replies) / sum(sent)` per week | Implemented |
| WoW Out of office rate `0..-3` | `daily_stats.ooo_count`, `daily_stats.emails_sent` | `sum(ooo) / sum(sent)` per week | Implemented |
| WoW Negative response rate `0..-3` | `daily_stats.negative_count`, `daily_stats.emails_sent` | `sum(negative) / sum(sent)` per week | Implemented |
| WoW TOTAL leads received `0..-3` | `leads.created_at` | Count all leads per week | Implemented |
| WoW SQL leads received `0..-3` | `leads.created_at`, `leads.qualification` | Count `MQL` per week | Implemented |
| MoM TOTAL leads received `0..-3` | `leads.created_at` | Count all leads per month | Implemented |
| MoM SQL leads received `0..-3` | `leads.created_at`, `leads.qualification` | Count `MQL` per month | Implemented |
| MoM Meetings received `0..-3` | `leads.created_at`, `leads.meeting_booked` | Count rows with `meeting_booked = true` per month | Implemented |
| MoM WONs rate/count `0..-3` | `leads.created_at`, `leads.won` | Count rows with `won = true` per month | Implemented |
| 2Wo2W IP health | N/A | No DB field for IP health rubric/state | Missing source |
| 2Wo2W domains health | N/A | No DB field for domains health rubric/state | Missing source |
| 2Wo2W warmup health | N/A | No DB field for warmup health rubric/state | Missing source |
| 2Wo2W copy health | N/A | No DB field for copy health rubric/state | Missing source |
| 2Wo2W funnel health | N/A | No DB field for funnel health rubric/state | Missing source |
| 2Wo2W insights | N/A | No structured field for this checklist result | Missing source |
| CRM status (Excel block) | Partial: `clients.crm_config` | Only raw config object exists, no normalized status dimension | Missing source |
| CRM API status | N/A | No dedicated health/status field, only config storage | Missing source |
| Auto invitations API key (separate from LinkedIn key) | N/A | No separate field for this key type | Missing source |
| Workshop S/O W1/W2/W/X checklist | N/A | No DB fields for workshop checklist columns | Missing source |
| MoM invoices `contracted/chance/issue time/opinion/vindication` block | Partial: `invoices`, `clients` | Required dimensions not represented in current schema | Missing source |
| MoM partnerships reporting block | N/A | No partnership reporting table/fields in app model | Missing source |
| MoM ABS block (`CLV`, `Market Size`, `Score`, `Up/Cr/Re`) | N/A | No ABS scoring data model in current schema | Missing source |
