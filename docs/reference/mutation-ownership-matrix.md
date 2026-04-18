# Mutation Ownership Matrix

| Entity | Client | Manager | Admin |
|---|---|---|---|
| clients | No | Assigned records only | All |
| client_users | No | No | All |
| campaigns | No | Assigned records only | All |
| leads | No | Assigned records only | All |
| domains | No | Assigned records only | All |
| invoices | No | Assigned records only | All |
| email_exclude_list | No | No | All |
| invitations (edge functions) | No | No | All |
| replies | No | No | No |
| campaign_daily_stats | No | No | No |
| daily_stats | No | No | No |

Notes:
- Current frontend phase only mutates fields already present in live schema.
- Analytics tables remain read-only.
- `client_users` mutations are admin-only and drive client access mapping.
- `email_exclude_list` is an admin-owned global compliance list.
