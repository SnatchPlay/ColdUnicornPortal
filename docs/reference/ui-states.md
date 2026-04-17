# UI States

- Loading:
  global workspace loading handled before protected routes render.
- Empty:
  every major panel has an explicit empty state instead of blank tables.
- Error:
  auth/data blockers are rendered as banners in-page.
- Blocker:
  missing auth linkage, tenant mapping, or RLS stays visible as an explicit blocker state; runtime does not fall back to local fixtures.

Backend blocker alignment:
- Auth identity mapping must resolve a usable role identity before protected routes are considered ready.
- Tenant access mapping (`client_users`) is required for client shell access and must not be bypassed.
- RLS gaps are treated as release blockers; frontend should surface permission errors explicitly and avoid hidden fallbacks.
