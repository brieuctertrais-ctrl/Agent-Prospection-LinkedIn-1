-- =============================================================
-- Security hardening
--  * explicit RLS policies per operation (SELECT / INSERT / UPDATE / DELETE)
--  * ownership checks on every referenced row (persona, prospect, message, campaign)
--  * team_id never writable by clients
--  * no information leak through SECURITY DEFINER helpers
--  * server-only tables (rate limits, config) explicitly denied to clients
--  * AI usage quotas per user / plan + global safety cap
--  * input constraints (URL formats, lengths) enforced in the database
-- =============================================================

-- ---------- auth.role() helper (exists on Supabase; created only if missing, e.g. local tests) ----------
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'auth' and p.proname = 'role') then
    execute $f$create function auth.role() returns text language sql stable as
      'select nullif(current_setting(''request.jwt.claim.role'', true), '''')'$f$;
  end if;
end $$;

-- ---------- Ownership helpers (SECURITY DEFINER, always scoped to auth.uid()) ----------
create or replace function public.owns_persona(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.personas where id = p and user_id = auth.uid());
$$;

create or replace function public.owns_prospect(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.prospects where id = p and user_id = auth.uid());
$$;

create or replace function public.owns_message(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.messages where id = p and user_id = auth.uid());
$$;

create or replace function public.owns_campaign(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.campaigns where id = p and user_id = auth.uid());
$$;

-- is_paid / has_access: a user may only ask about themselves (server code may ask about anyone).
create or replace function public.is_paid(uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    -- auth.role() is NULL only for direct SQL (migrations, cron); API callers are anon/authenticated/service_role.
    when uid is distinct from auth.uid() and auth.role() is distinct from 'service_role' and auth.role() is not null then false
    else exists (
      select 1 from public.subscriptions s
      where s.user_id = uid and s.plan in ('pro','team') and s.status = 'active'
    )
  end;
$$;

create or replace function public.has_access(uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    -- auth.role() is NULL only for direct SQL (migrations, cron); API callers are anon/authenticated/service_role.
    when uid is distinct from auth.uid() and auth.role() is distinct from 'service_role' and auth.role() is not null then false
    else exists (
      select 1 from public.subscriptions s
      where s.user_id = uid
        and ((s.plan = 'trial' and s.trial_ends_at > now()) or s.status = 'active')
    )
  end;
$$;

-- ---------- team_id is managed server-side only ----------
create or replace function public.protect_team_id() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Only server code (service_role) or direct SQL (no JWT) may set team membership.
  if auth.role() = 'service_role' or auth.role() is null then
    return new;
  end if;
  if tg_op = 'INSERT' and new.team_id is not null then
    raise exception 'forbidden_team_id' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.team_id is distinct from old.team_id then
    raise exception 'forbidden_team_id' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger profiles_protect_team before insert or update on public.profiles
  for each row execute function public.protect_team_id();
create trigger personas_protect_team before insert or update on public.personas
  for each row execute function public.protect_team_id();
create trigger leads_protect_team before insert or update on public.leads
  for each row execute function public.protect_team_id();

-- ---------- Input constraints ----------
alter table public.prospects
  add constraint prospects_linkedin_url_format check (linkedin_url ~ '^https://www\.linkedin\.com/in/[^/?#\s]{1,200}/$'),
  add constraint prospects_photo_url_format check (photo_url is null or photo_url ~ '^https://[a-z0-9.-]+\.licdn\.com/'),
  add constraint prospects_lengths check (
    char_length(coalesce(full_name, '')) <= 200 and char_length(coalesce(first_name, '')) <= 100
    and char_length(coalesce(headline, '')) <= 500 and char_length(coalesce(company, '')) <= 200
    and char_length(coalesce(location, '')) <= 200 and char_length(coalesce(about, '')) <= 5000
    and char_length(coalesce(score_reason, '')) <= 500
    and pg_column_size(experiences) <= 32768 and pg_column_size(recent_activity) <= 8192
  );

alter table public.exclusion_list
  add constraint exclusion_linkedin_url_format check (linkedin_url ~ '^https://www\.linkedin\.com/in/[^/?#\s]{1,200}/$'),
  add constraint exclusion_reason_length check (char_length(coalesce(reason, '')) <= 100);

alter table public.messages
  add constraint messages_text_length check (
    char_length(text) between 1 and 2000 and (kind <> 'invitation' or char_length(text) <= 300)
  );

alter table public.knowledge_docs add constraint knowledge_title_length check (char_length(title) between 1 and 200);
alter table public.pitches add constraint pitches_lengths check (
  char_length(title) <= 120 and char_length(description) <= 3000 and char_length(benefits) <= 3000);
alter table public.copywriting_settings add constraint copywriting_lengths check (
  char_length(template) <= 2000 and char_length(instructions) <= 2000);
alter table public.action_logs add constraint action_logs_sizes check (
  char_length(action_type) <= 50 and pg_column_size(details) <= 8192
  and (linkedin_url is null or linkedin_url ~ '^https://www\.linkedin\.com/'));
alter table public.leads add constraint leads_last_action_length check (char_length(coalesce(last_action, '')) <= 100);
alter table public.teams add constraint teams_name_length check (char_length(name) between 1 and 120);
alter table public.user_settings add constraint user_settings_timezone_length check (char_length(timezone) <= 64);

-- ---------- Server-only tables ----------
-- Generic fixed-window rate limiter (used by Edge Functions and Next.js routes with the service role).
create table public.rate_limits (
  key text not null check (char_length(key) <= 200),
  window_start timestamptz not null,
  count int not null default 0,
  primary key (key, window_start)
);

-- Global settings (safety caps). Not readable by clients.
create table public.app_config (
  key text primary key,
  value bigint not null
);
insert into public.app_config (key, value) values
  ('global_daily_ai_calls', 20000),
  ('global_daily_ai_tokens', 40000000);

-- AI usage ledger (one row per model call), readable by its owner.
create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('generate','score')),
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  created_at timestamptz not null default now()
);
create index on public.ai_usage (user_id, created_at desc);
create index on public.ai_usage (created_at);

create or replace function public.check_rate_limit(p_key text, p_max int, p_window_seconds int) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  n int;
begin
  insert into public.rate_limits (key, window_start, count) values (p_key, w, 1)
  on conflict (key, window_start) do update set count = public.rate_limits.count + 1
  returning count into n;
  return n <= p_max;
end $$;

-- Reserves one AI call for the current user, enforcing per-minute, per-day (by plan),
-- per-day token and global caps. Returns the usage row id (to record tokens afterwards).
create or replace function public.consume_ai_quota(p_kind text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  paid boolean;
  per_min int := 20;
  per_day int;
  tokens_day bigint;
  n int;
  t bigint;
  id uuid;
begin
  if uid is null then raise exception 'unauthorized' using errcode = '42501'; end if;
  if p_kind not in ('generate','score') then raise exception 'invalid_kind' using errcode = '22023'; end if;
  if not public.has_access(uid) then raise exception 'subscription_required' using errcode = 'P0001'; end if;

  perform pg_advisory_xact_lock(hashtext('ai:' || uid::text));
  paid := public.is_paid(uid);
  per_day := case
    when p_kind = 'generate' and paid then 500
    when p_kind = 'generate' then 150
    when paid then 1500
    else 400 end;
  tokens_day := case when paid then 5000000 else 1500000 end;

  select count(*) into n from public.ai_usage where user_id = uid and created_at > now() - interval '1 minute';
  if n >= per_min then raise exception 'rate_limited' using errcode = 'P0001'; end if;

  select count(*) filter (where kind = p_kind), coalesce(sum(input_tokens + output_tokens), 0)
    into n, t
    from public.ai_usage where user_id = uid and created_at > now() - interval '1 day';
  if n >= per_day or t >= tokens_day then raise exception 'quota_exceeded' using errcode = 'P0001'; end if;

  select count(*), coalesce(sum(input_tokens + output_tokens), 0) into n, t
    from public.ai_usage where created_at > now() - interval '1 day';
  if n >= (select value from public.app_config where key = 'global_daily_ai_calls')
     or t >= (select value from public.app_config where key = 'global_daily_ai_tokens') then
    raise exception 'service_busy' using errcode = 'P0001';
  end if;

  insert into public.ai_usage (user_id, kind) values (uid, p_kind) returning ai_usage.id into id;
  return id;
end $$;

create or replace function public.record_ai_usage(p_id uuid, p_input int, p_output int) returns void
language sql security definer set search_path = public as $$
  update public.ai_usage
     set input_tokens = greatest(0, least(p_input, 2000000)), output_tokens = greatest(0, least(p_output, 2000000))
   where id = p_id and user_id = auth.uid();
$$;

-- Lead search with bound parameters (no filter string built from user input).
create or replace function public.search_leads(
  p_q text default null, p_persona uuid default null, p_status public.lead_status default null, p_limit int default 500
) returns table (
  id uuid, status public.lead_status, created_at timestamptz, persona_name text, message_text text,
  full_name text, headline text, company text, location text, linkedin_url text, photo_url text
)
language sql stable security invoker set search_path = public as $$
  select l.id, l.status, l.created_at, pe.name, m.text,
         p.full_name, p.headline, p.company, p.location, p.linkedin_url, p.photo_url
  from public.leads l
  join public.prospects p on p.id = l.prospect_id
  left join public.personas pe on pe.id = l.persona_id
  left join public.messages m on m.id = l.message_id
  where l.user_id = auth.uid()
    and (p_persona is null or l.persona_id = p_persona)
    and (p_status is null or l.status = p_status)
    and (coalesce(p_q, '') = ''
         or strpos(lower(coalesce(p.full_name, '') || ' ' || coalesce(p.company, '') || ' ' || coalesce(p.headline, '')),
                   lower(left(p_q, 100))) > 0)
  order by l.created_at desc
  limit least(greatest(coalesce(p_limit, 500), 1), 10000);
$$;

-- Old rate-limit windows are purged together with rejected prospects.
create or replace function public.purge_rejected_prospects() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from public.prospects p
  using public.decisions d, public.user_settings s
  where d.prospect_id = p.id and s.user_id = p.user_id
    and d.decision in ('reject','skip_low_score')
    and d.created_at < now() - make_interval(months => s.purge_rejected_after_months)
    and not exists (select 1 from public.leads l where l.prospect_id = p.id);
  get diagnostics n = row_count;
  delete from public.rate_limits where window_start < now() - interval '2 days';
  delete from public.ai_usage where created_at < now() - interval '400 days';
  return n;
end $$;

-- ---------- Function privileges ----------
revoke execute on function public.check_rate_limit(text, int, int) from public, anon, authenticated;
revoke execute on function public.purge_rejected_prospects() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.enforce_persona_limit() from public, anon, authenticated;
revoke execute on function public.exclude_on_reject() from public, anon, authenticated;
revoke execute on function public.protect_team_id() from public, anon, authenticated;
revoke execute on function public.consume_ai_quota(text) from public, anon;
revoke execute on function public.record_ai_usage(uuid, int, int) from public, anon;
revoke execute on function public.delete_my_prospecting_data() from public, anon;
grant execute on function public.check_rate_limit(text, int, int) to service_role;
grant execute on function public.purge_rejected_prospects() to service_role;
grant execute on function public.consume_ai_quota(text) to authenticated;
grant execute on function public.record_ai_usage(uuid, int, int) to authenticated;
grant execute on function public.delete_my_prospecting_data() to authenticated;

-- ---------- RLS: explicit policies per operation ----------
-- Drop the previous catch-all policies.
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- Helper used only during this migration to create owner policies.
create function pg_temp.own_policies(t text, ops text[], extra_check text default 'true') returns void
language plpgsql as $$
declare op text;
begin
  execute format('alter table public.%I enable row level security', t);
  foreach op in array ops loop
    if op = 'select' then
      execute format('create policy "%s_select_own" on public.%I for select to authenticated using (user_id = auth.uid())', t, t);
    elsif op = 'insert' then
      execute format('create policy "%s_insert_own" on public.%I for insert to authenticated with check (user_id = auth.uid() and %s)', t, t, extra_check);
    elsif op = 'update' then
      execute format('create policy "%s_update_own" on public.%I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and %s)', t, t, extra_check);
    elsif op = 'delete' then
      execute format('create policy "%s_delete_own" on public.%I for delete to authenticated using (user_id = auth.uid())', t, t);
    end if;
  end loop;
end $$;

-- Operations not listed are denied (no policy): rows are created by triggers or server code.
select pg_temp.own_policies('user_settings', array['select','update'],
  '(active_persona_id is null or public.owns_persona(active_persona_id))');            -- insert: trigger; delete: cascade
select pg_temp.own_policies('subscriptions', array['select']);                          -- writes: verified webhook only
select pg_temp.own_policies('linkedin_profiles_user', array['select','insert','update','delete']);
select pg_temp.own_policies('personas', array['select','insert','update','delete']);
select pg_temp.own_policies('pitches', array['select','insert','update','delete'], 'public.owns_persona(persona_id)');
select pg_temp.own_policies('copywriting_settings', array['select','insert','update','delete'], 'public.owns_persona(persona_id)');
select pg_temp.own_policies('knowledge_docs', array['select','insert','update','delete']);
select pg_temp.own_policies('prospects', array['select','insert','update','delete'],
  '(persona_id is null or public.owns_persona(persona_id))');
select pg_temp.own_policies('decisions', array['select','insert','update','delete'],
  'public.owns_prospect(prospect_id) and (persona_id is null or public.owns_persona(persona_id))');
select pg_temp.own_policies('messages', array['select','insert','update','delete'],
  'public.owns_prospect(prospect_id) and (persona_id is null or public.owns_persona(persona_id))');
select pg_temp.own_policies('leads', array['select','insert','update','delete'],
  'public.owns_prospect(prospect_id) and (persona_id is null or public.owns_persona(persona_id)) and (message_id is null or public.owns_message(message_id))');
select pg_temp.own_policies('exclusion_list', array['select','insert','update','delete']);
select pg_temp.own_policies('action_logs', array['select','insert'],
  '(prospect_id is null or public.owns_prospect(prospect_id))');                         -- append-only journal
select pg_temp.own_policies('campaigns', array['select','insert','update','delete'], 'public.owns_persona(persona_id)');
select pg_temp.own_policies('action_queue', array['select','insert','update','delete'],
  '(campaign_id is null or public.owns_campaign(campaign_id)) and (prospect_id is null or public.owns_prospect(prospect_id))');
select pg_temp.own_policies('ai_usage', array['select']);                               -- writes: consume_ai_quota()

-- profiles: the row is created by the signup trigger; users read/update only their own.
alter table public.profiles enable row level security;
create policy "profiles_select_own" on public.profiles for select to authenticated using (id = auth.uid());
create policy "profiles_update_own" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- teams: members read; owner manages. (Membership is assigned server-side, see protect_team_id.)
alter table public.teams enable row level security;
create policy "teams_select_member" on public.teams for select to authenticated
  using (owner_id = auth.uid() or id = (select team_id from public.profiles where id = auth.uid()));
create policy "teams_insert_owner" on public.teams for insert to authenticated with check (owner_id = auth.uid());
create policy "teams_update_owner" on public.teams for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "teams_delete_owner" on public.teams for delete to authenticated using (owner_id = auth.uid());

-- Server-only tables: RLS on + explicit deny for client roles (service_role bypasses RLS).
alter table public.rate_limits enable row level security;
create policy "rate_limits_deny_clients" on public.rate_limits as restrictive for all to anon, authenticated using (false) with check (false);
alter table public.app_config enable row level security;
create policy "app_config_deny_clients" on public.app_config as restrictive for all to anon, authenticated using (false) with check (false);

-- Safety net: fail the migration if any public table is left without RLS or without a policy.
do $$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || quote_ident(r.relname))::regclass) then
      raise exception 'RLS disabled on public.%', r.relname;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = r.relname) then
      raise exception 'No policy on public.%', r.relname;
    end if;
  end loop;
end $$;
