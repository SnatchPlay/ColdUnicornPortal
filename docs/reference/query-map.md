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
    `clients`, `users`, `client_users`
- Domains:
    `domains`, `clients`
- Invoices:
    `invoices`, `clients`
- Blacklist:
    `email_exclude_list`
- Settings:
    auth identity + runtime config

Notes:
- `daily_stats` is selectively loaded for internal roles (manager/admin) and may be skipped for client scope.
- `client_users` is required for admin assignment workflows and client identity linkage.
- `domains` and `invoices` are internal modules (manager/admin shells) and are scoped by client ownership rules.
- `email_exclude_list` is globally readable for internal roles; mutations are admin-only.
