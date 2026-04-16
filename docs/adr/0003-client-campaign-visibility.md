# ADR 0003: Client Campaign Visibility

## Status
Accepted

## Decision
Client users only see campaigns with `campaigns.type = 'outreach'`.

## Consequences
- Internal `ooo`, `nurture`, and related campaign types stay hidden from client routes.
- Client dashboard, leads, and statistics are filtered through the same rule.
