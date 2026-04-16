# Query Dependency Map

- Dashboard:
  `clients`, `campaigns`, `leads`, `campaign_daily_stats`, optional `daily_stats`
- Leads:
  `leads`, `replies`, `campaigns`
- Campaigns:
  `campaigns`, `campaign_daily_stats`
- Statistics:
  `campaigns`, `leads`, `campaign_daily_stats`
- Clients:
  `clients`, `users`
- Settings:
  auth identity + runtime config
