# Mutation Ownership Matrix

| Entity | Client | Manager | Admin |
|---|---|---|---|
| clients | No | Assigned records only | All |
| campaigns | No | Assigned records only | All |
| leads | No | Assigned records only | All |
| replies | No | No | No |
| campaign_daily_stats | No | No | No |
| daily_stats | No | No | No |

Notes:
- Current frontend phase only mutates fields already present in live schema.
- Analytics tables remain read-only.
