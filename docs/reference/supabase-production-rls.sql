-- Production RLS baseline for the current frontend runtime.
-- Apply this to the target Supabase project used by the deployed frontend.
-- This artifact was generated from runtime truth in the React app, not from archive specs.

begin;

create or replace function public.current_app_role()
returns text
language sql
stable
as $$
  select role
  from public.users
  where id = auth.uid()
  limit 1
$$;

create or replace function public.is_internal_user()
returns boolean
language sql
stable
as $$
  select coalesce(public.current_app_role() in ('super_admin', 'admin', 'manager'), false)
$$;

create or replace function public.is_admin_user()
returns boolean
language sql
stable
as $$
  select coalesce(public.current_app_role() in ('super_admin', 'admin'), false)
$$;

create or replace function public.is_manager_of_client(target_client_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.clients
    where id = target_client_id
      and manager_id = auth.uid()
  )
$$;

create or replace function public.is_client_member(target_client_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.client_users
    where client_id = target_client_id
      and user_id = auth.uid()
  )
$$;

create or replace function public.can_access_client(target_client_id uuid)
returns boolean
language sql
stable
as $$
  select coalesce(
    public.is_admin_user()
    or public.is_manager_of_client(target_client_id)
    or public.is_client_member(target_client_id),
    false
  )
$$;

alter table public.users enable row level security;
alter table public.client_users enable row level security;
alter table public.clients enable row level security;
alter table public.campaigns enable row level security;
alter table public.leads enable row level security;
alter table public.replies enable row level security;
alter table public.campaign_daily_stats enable row level security;
alter table public.daily_stats enable row level security;
alter table public.domains enable row level security;
alter table public.invoices enable row level security;
alter table public.email_exclude_list enable row level security;

drop policy if exists "users_select_internal_or_self" on public.users;
create policy "users_select_internal_or_self"
on public.users
for select
to authenticated
using (
  public.is_internal_user()
  or id = auth.uid()
);

drop policy if exists "client_users_select_visible" on public.client_users;
create policy "client_users_select_visible"
on public.client_users
for select
to authenticated
using (
  public.is_admin_user()
  or public.is_manager_of_client(client_id)
  or user_id = auth.uid()
);

drop policy if exists "client_users_admin_manage" on public.client_users;
create policy "client_users_admin_manage"
on public.client_users
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

drop policy if exists "clients_select_visible" on public.clients;
create policy "clients_select_visible"
on public.clients
for select
to authenticated
using (public.can_access_client(id));

drop policy if exists "clients_update_internal" on public.clients;
create policy "clients_update_internal"
on public.clients
for update
to authenticated
using (
  public.is_admin_user()
  or public.is_manager_of_client(id)
)
with check (
  public.is_admin_user()
  or public.is_manager_of_client(id)
);

drop policy if exists "campaigns_select_visible" on public.campaigns;
create policy "campaigns_select_visible"
on public.campaigns
for select
to authenticated
using (public.can_access_client(client_id));

drop policy if exists "campaigns_update_internal" on public.campaigns;
create policy "campaigns_update_internal"
on public.campaigns
for update
to authenticated
using (
  public.is_admin_user()
  or public.is_manager_of_client(client_id)
)
with check (
  public.is_admin_user()
  or public.is_manager_of_client(client_id)
);

drop policy if exists "leads_select_visible" on public.leads;
create policy "leads_select_visible"
on public.leads
for select
to authenticated
using (public.can_access_client(client_id));

drop policy if exists "leads_update_visible" on public.leads;
create policy "leads_update_visible"
on public.leads
for update
to authenticated
using (public.can_access_client(client_id))
with check (
  public.can_access_client(client_id)
);

drop policy if exists "replies_select_visible" on public.replies;
create policy "replies_select_visible"
on public.replies
for select
to authenticated
using (
  client_id is null
  or public.can_access_client(client_id)
);

drop policy if exists "campaign_daily_stats_select_visible" on public.campaign_daily_stats;
create policy "campaign_daily_stats_select_visible"
on public.campaign_daily_stats
for select
to authenticated
using (
  exists (
    select 1
    from public.campaigns
    where campaigns.id = campaign_daily_stats.campaign_id
      and public.can_access_client(campaigns.client_id)
  )
);

drop policy if exists "daily_stats_select_visible" on public.daily_stats;
create policy "daily_stats_select_visible"
on public.daily_stats
for select
to authenticated
using (public.can_access_client(client_id));

drop policy if exists "domains_select_internal_visible" on public.domains;
create policy "domains_select_internal_visible"
on public.domains
for select
to authenticated
using (
  public.is_admin_user()
  or public.is_manager_of_client(client_id)
);

drop policy if exists "domains_update_internal_visible" on public.domains;
create policy "domains_update_internal_visible"
on public.domains
for update
to authenticated
using (
  public.is_admin_user()
  or public.is_manager_of_client(client_id)
)
with check (
  public.is_admin_user()
  or public.is_manager_of_client(client_id)
);

drop policy if exists "invoices_select_internal_visible" on public.invoices;
create policy "invoices_select_internal_visible"
on public.invoices
for select
to authenticated
using (
  public.is_admin_user()
  or public.is_manager_of_client(client_id)
);

drop policy if exists "invoices_update_internal_visible" on public.invoices;
create policy "invoices_update_internal_visible"
on public.invoices
for update
to authenticated
using (
  public.is_admin_user()
  or public.is_manager_of_client(client_id)
)
with check (
  public.is_admin_user()
  or public.is_manager_of_client(client_id)
);

drop policy if exists "email_exclude_list_select_internal" on public.email_exclude_list;
create policy "email_exclude_list_select_internal"
on public.email_exclude_list
for select
to authenticated
using (public.is_internal_user());

drop policy if exists "email_exclude_list_admin_manage" on public.email_exclude_list;
create policy "email_exclude_list_admin_manage"
on public.email_exclude_list
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

commit;
