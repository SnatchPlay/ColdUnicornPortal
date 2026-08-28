-- Makes upsert_client_crm_connection reject a non-object `credentials` with a sentence a human can
-- act on, instead of leaking a helper's internals.
--
-- HOW THIS WAS FOUND: seeding the table from a script that passed the payload through a driver which
-- JSON-encoded it twice. The value arrived as a jsonb *string* rather than an object, and the call
-- failed with `cannot call jsonb_each on a non-object` — an error that names neither the function nor
-- the argument at fault. The caller this exists for is the CRM connect webhook, where a payload
-- arriving as a string is a completely ordinary mistake, and where the person debugging it will be
-- reading an n8n execution, not this schema.
--
-- Deliberately a REJECTION, not a coercion. Parsing a string that happens to look like JSON would be
-- guessing at the caller's intent, and a credential written from a guess is worse than a failed run.

begin;

create or replace function private.jsonb_strip_blanks(p_input jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_object_agg(key, value)
      from jsonb_each(case when jsonb_typeof(coalesce(p_input, '{}'::jsonb)) = 'object'
                           then coalesce(p_input, '{}'::jsonb)
                           else '{}'::jsonb end)
      where jsonb_typeof(value) <> 'null'
        and not (jsonb_typeof(value) = 'string' and btrim(value #>> '{}') = '')
    ),
    '{}'::jsonb
  );
$$;

comment on function private.jsonb_strip_blanks(jsonb) is
  'Drops null and blank-string members so a partial credential payload merges without erasing what is already stored. A non-object input yields {} — callers that care must validate first (see upsert_client_crm_connection).';

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
  v_creds     jsonb;
  v_status    text := coalesce(nullif(btrim(p_status), ''), 'connected');
  v_id        uuid;
begin
  if p_client_id is null then
    raise exception 'upsert_client_crm_connection: client_id is required' using errcode = '22023';
  end if;

  -- A webhook that JSON-encodes its body twice sends a jsonb string, not an object. Say so.
  if p_credentials is not null and jsonb_typeof(p_credentials) <> 'object' then
    raise exception
      'upsert_client_crm_connection: credentials must be a JSON object, got %. A doubly-encoded payload arrives as a string — send the object, not its serialisation.',
      jsonb_typeof(p_credentials)
      using errcode = '22023';
  end if;

  v_creds := private.jsonb_strip_blanks(p_credentials);

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
    p_client_id, v_provider, v_auth_mode, v_creds, v_status,
    coalesce(p_enabled, true),
    case when v_status = 'connected' then now() else null end,
    p_last_error
  )
  on conflict (client_id, provider) do update set
    auth_mode    = case when v_auth_mode = '' then t.auth_mode else v_auth_mode end,
    credentials  = t.credentials || v_creds,
    status       = v_status,
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

commit;
