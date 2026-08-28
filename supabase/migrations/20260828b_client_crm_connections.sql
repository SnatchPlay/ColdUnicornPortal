-- Per-client CRM connections: the Postgres home for what today lives in a Google Sheet tab and an
-- n8n Data Table (ADR-0019).
--
-- WHAT THIS REPLACES. `[HUB] CRMs Add/Update Lead Dispatcher` resolves a client's CRM by reading
-- two stores and stitching them together in an 80-line Code node:
--   * Google Sheet 17cdj8ex… ("CS PDCA"), tab `Client CRM Details` — CRM Platform, API Key,
--     API Secret, Subdomain, Salt, Login URL;
--   * n8n Data Table `OAuth2 Tokens` — access_token, refresh_token, client_id, client_secret, domain.
-- Both are replaced by resolve_crm_connection() below.
--
-- RLS ENABLED WITH NO POLICIES **AND** GRANTS REVOKED, ON PURPOSE. This table holds clients'
-- third-party CRM secrets. `service_role` (n8n) bypasses RLS; `authenticated` — every portal role,
-- master_admin included — has no privilege on the table at all, so it cannot select a row and
-- cannot truncate it either (TRUNCATE is a privilege check that RLS does not filter). That is a deliberate departure from client_sequencers, which uses
-- private.can_manage_client and whose api_key the gateway ships to a manager's browser
-- (orm-gateway/index.ts:1680). Repeating that with a client's own CRM credentials is not worth the
-- convenience. If a status badge is ever wanted, add a view that omits `credentials` and put a
-- SELECT policy on that — never widen this table.
--
-- Every function here is SECURITY DEFINER with `set search_path = ''` and fully qualified names:
-- an empty search_path is the only configuration where a DEFINER body cannot be redirected by
-- objects created in a schema the caller controls (same rule as 20260722e_ooo_rpcs.sql).

begin;

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- Table
-- ══════════════════════════════════════════════════════════════════════════════════════════════

create table if not exists public.client_crm_connections (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients(id) on delete cascade,
  -- Mirrors the five children of the dispatcher. A sixth CRM means a new child workflow anyway, so
  -- the CHECK failing loudly is the point: an unknown provider must never reach the Switch, which
  -- has no fallback output and drops the lead in silence.
  provider     text not null check (provider in ('hubspot', 'pipedrive', 'zoho', 'salesforce', 'livespace')),
  -- How the connection was ESTABLISHED. What is usable at call time is derived from which secrets
  -- are actually present — see resolve_crm_connection.
  auth_mode    text not null check (auth_mode in ('api_key', 'oauth')),
  credentials  jsonb not null default '{}'::jsonb,
  status       text not null default 'pending' check (status in ('pending', 'connected', 'failed', 'disconnected')),
  enabled      boolean not null default true,
  connected_at timestamptz,
  last_error   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (client_id, provider)
);

comment on table public.client_crm_connections is
  'Per-client CRM connection settings and credentials. Written by n8n from the connect webhook, read by n8n through resolve_crm_connection. RLS-enabled with NO policies: the portal never reads this table. ADR-0019.';
comment on column public.client_crm_connections.credentials is
  'Provider-specific secrets: api_key, api_secret, subdomain, salt, login_url, client_id, client_secret, refresh_token, access_token, domain, expires_at. Merged on upsert, never wholesale-replaced.';
comment on column public.client_crm_connections.enabled is
  'false parks a connection without losing its credentials. resolve_crm_connection returns NULL for a disabled row, so the dispatcher treats it as "no CRM".';

alter table public.client_crm_connections enable row level security;

-- RLS ALONE IS NOT ENOUGH HERE. Supabase's default privileges in `public` hand `anon` and
-- `authenticated` the full DELETE/INSERT/SELECT/TRUNCATE/UPDATE set on every new table, and
-- **TRUNCATE is not filtered by RLS** — it is a privilege check, not a row check. So a table with
-- RLS on and no policies is still truncatable by the anon key. Measured on a local restore of the
-- production schema, 2026-08-28. Revoke explicitly and grant back only what n8n needs.
revoke all on public.client_crm_connections from public, anon, authenticated;
grant select, insert, update, delete on public.client_crm_connections to service_role;

drop trigger if exists set_updated_at on public.client_crm_connections;
create trigger set_updated_at
  before update on public.client_crm_connections
  for each row execute function public.handle_updated_at();

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- Helper: an event carrying fewer fields must not degrade the record
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- The connect webhook posts the provider's whole field set, and the fields the client left blank
-- arrive as empty strings rather than being absent. Merging those raw would blank a stored secret
-- on every re-connect. Same rule as upsert_sequencer_contact's NULL handling, one level deeper.
create or replace function private.jsonb_strip_blanks(p_input jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_object_agg(key, value)
      from jsonb_each(coalesce(p_input, '{}'::jsonb))
      where jsonb_typeof(value) <> 'null'
        and not (jsonb_typeof(value) = 'string' and btrim(value #>> '{}') = '')
    ),
    '{}'::jsonb
  );
$$;

comment on function private.jsonb_strip_blanks(jsonb) is
  'Drops null and blank-string members so a partial credential payload merges without erasing what is already stored.';

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- Intake: resolve the client a connect webhook is talking about
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- The legacy CRM project posts `clientName` (crm-integration-card.tsx passes client.name) and no id.
-- Production has duplicate client names — `SalesBook` and `Testing` each match two non-archived
-- clients as of 2026-08-28 (`Astor` also appears twice, but one of the pair is archived) — so
-- an ambiguous name MUST fail rather than pick one. A credential written against the wrong client
-- sends that client's leads into a stranger's CRM.
create or replace function public.resolve_client_for_crm_intake(p_client_name text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_client_name, ''));
  v_ids  uuid[];
begin
  if v_name = '' then
    raise exception 'resolve_client_for_crm_intake: empty client name' using errcode = '22023';
  end if;

  select array_agg(c.id)
  into v_ids
  from public.clients c
  where c.archived_at is null
    and lower(btrim(c.name)) = lower(v_name);

  if v_ids is null or cardinality(v_ids) = 0 then
    raise exception 'resolve_client_for_crm_intake: no active client named %', v_name using errcode = 'P0002';
  end if;

  if cardinality(v_ids) > 1 then
    raise exception 'resolve_client_for_crm_intake: % active clients named % — refusing to guess',
      cardinality(v_ids), v_name using errcode = 'P0003';
  end if;

  return v_ids[1];
end;
$$;

revoke all on function public.resolve_client_for_crm_intake(text) from public, anon, authenticated;
grant execute on function public.resolve_client_for_crm_intake(text) to service_role;

comment on function public.resolve_client_for_crm_intake(text) is
  'ADR-0019. Client name -> id for the CRM connect webhook. Raises on 0 or >1 match; a duplicate name is never resolved by guessing.';

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- Intake: store what the connect webhook delivered
-- ══════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.upsert_client_crm_connection(
  p_client_id   uuid,
  p_provider    text,
  p_auth_mode   text,
  p_credentials jsonb   default '{}'::jsonb,
  p_status      text    default 'connected',
  p_enabled     boolean default null,
  p_last_error  text    default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider  text := lower(btrim(coalesce(p_provider, '')));
  v_auth_mode text := lower(btrim(coalesce(p_auth_mode, '')));
  v_creds     jsonb := private.jsonb_strip_blanks(p_credentials);
  v_status    text := coalesce(nullif(btrim(p_status), ''), 'connected');
  v_id        uuid;
begin
  if p_client_id is null then
    raise exception 'upsert_client_crm_connection: client_id is required' using errcode = '22023';
  end if;

  -- The provider/auth_mode CHECKs would reject a blank on INSERT anyway, but as a constraint
  -- violation naming a constraint. A webhook payload missing a field should say which field.
  if v_provider = '' then
    raise exception 'upsert_client_crm_connection: provider is required' using errcode = '22023';
  end if;

  if v_auth_mode = '' and not exists (
    select 1 from public.client_crm_connections t
    where t.client_id = p_client_id and t.provider = v_provider
  ) then
    raise exception 'upsert_client_crm_connection: auth_mode is required for a new % connection', v_provider
      using errcode = '22023';
  end if;

  insert into public.client_crm_connections as t
    (client_id, provider, auth_mode, credentials, status, enabled, connected_at, last_error)
  values (
    p_client_id,
    v_provider,
    v_auth_mode,
    v_creds,
    v_status,
    coalesce(p_enabled, true),
    case when v_status = 'connected' then now() else null end,
    p_last_error
  )
  on conflict (client_id, provider) do update set
    auth_mode    = case when v_auth_mode = '' then t.auth_mode else v_auth_mode end,
    -- Merge, never replace: a re-connect that carries only a refreshed token must not drop the
    -- api_secret / subdomain / salt the first connect established.
    credentials  = t.credentials || v_creds,
    status       = v_status,
    -- NULL means "leave as is". This is load-bearing: a connection an operator parked
    -- (enabled = false) must not silently come back to life because the client re-authorised.
    enabled      = coalesce(p_enabled, t.enabled),
    connected_at = case when v_status = 'connected' then now() else t.connected_at end,
    last_error   = p_last_error
  returning t.id into v_id;

  return v_id;
end;
$$;

revoke all on function public.upsert_client_crm_connection(uuid, text, text, jsonb, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.upsert_client_crm_connection(uuid, text, text, jsonb, text, boolean, text)
  to service_role;

comment on function public.upsert_client_crm_connection(uuid, text, text, jsonb, text, boolean, text) is
  'ADR-0019. Idempotent per (client_id, provider). Credentials MERGE and blanks are dropped, so a partial payload never erases a stored secret; p_enabled NULL keeps the current value.';

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- Dispatch: the one call that replaces Sheets + Data Table + Merge + Aggregate + Code
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- Returns the `crm` object the dispatcher already builds, key for key, so the cutover can be
-- verified as a field-by-field diff against today's output rather than by waiting for traffic.
-- Missing values are '' (not null) because that is what the Code node's pick() produces and the
-- children's expressions are written against it.
--
-- auth_mode is DERIVED from which secret is present, not read from the column: the column records
-- how the connection was established, this records what can actually be sent. They agree in every
-- seeded row; where they ever disagree, the usable one is the honest answer for a caller.
--
-- NULL is returned for: unknown workspace, no connection row, or enabled = false. The dispatcher
-- must treat NULL as "this client has no CRM" and say so — it must not fall through silently, which
-- is how TouchlessFreaks' Salesforce sat dead and unreported since 2026-05-22.
create or replace function public.resolve_crm_connection(
  p_sequencer_key          text,
  p_external_workspace_id  text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'type',          conn.provider,
    'auth_mode',     case
                       when coalesce(conn.credentials ->> 'access_token', '') <> '' then 'oauth'
                       when coalesce(conn.credentials ->> 'api_key', '')      <> '' then 'api_key'
                       else ''
                     end,
    'access_token',  coalesce(conn.credentials ->> 'access_token', ''),
    'api_key',       coalesce(conn.credentials ->> 'api_key', ''),
    'api_token',     coalesce(nullif(conn.credentials ->> 'access_token', ''), conn.credentials ->> 'api_key', ''),
    'api_secret',    coalesce(conn.credentials ->> 'api_secret', ''),
    'subdomain',     coalesce(conn.credentials ->> 'subdomain', ''),
    'salt',          coalesce(conn.credentials ->> 'salt', ''),
    'refresh_token', coalesce(conn.credentials ->> 'refresh_token', ''),
    'client_id',     coalesce(conn.credentials ->> 'client_id', ''),
    'client_secret', coalesce(conn.credentials ->> 'client_secret', ''),
    'domain',        coalesce(conn.credentials ->> 'domain', ''),
    'login_url',     coalesce(conn.credentials ->> 'login_url', ''),
    'workspace_id',  cs.external_workspace_id
  )
  from public.client_sequencers cs
  join public.sequencers s              on s.id = cs.sequencer_id
  join public.client_crm_connections conn on conn.client_id = cs.client_id
  where s.key = p_sequencer_key
    and cs.external_workspace_id = p_external_workspace_id
    and conn.enabled
  limit 1;
$$;

revoke all on function public.resolve_crm_connection(text, text) from public, anon, authenticated;
grant execute on function public.resolve_crm_connection(text, text) to service_role;

comment on function public.resolve_crm_connection(text, text) is
  'ADR-0019. (sequencer key, external workspace id) -> the `crm` payload the CRM dispatcher sends to its children. NULL when the workspace is unknown, has no connection, or the connection is disabled.';

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- Dispatch: let the OAuth children persist a refreshed token
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- The Zoho child exchanges its refresh_token on EVERY run ("[35] Zoho: refresh access_token"), which
-- burns a request per lead and makes every execution credential-bearing. With this the children can
-- store what they got and reuse it until it expires.
create or replace function public.store_crm_oauth_tokens(
  p_client_id    uuid,
  p_provider     text,
  p_access_token text,
  p_expires_at   timestamptz default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.client_crm_connections
  set credentials = credentials || private.jsonb_strip_blanks(
        jsonb_build_object(
          'access_token', p_access_token,
          'expires_at',   to_jsonb(p_expires_at)
        )
      )
  where client_id = p_client_id
    and provider = lower(btrim(coalesce(p_provider, '')));
$$;

revoke all on function public.store_crm_oauth_tokens(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.store_crm_oauth_tokens(uuid, text, text, timestamptz) to service_role;

comment on function public.store_crm_oauth_tokens(uuid, text, text, timestamptz) is
  'ADR-0019. Stores a refreshed OAuth access token so the Zoho/Salesforce children stop re-exchanging the refresh_token on every run.';

commit;
