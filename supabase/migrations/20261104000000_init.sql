-- =============================================================
-- KAIRO BizDev — initial schema
-- Every table is scoped per user with Row Level Security.
-- =============================================================

create extension if not exists "pgcrypto";

-- ---------- Enums ----------
create type public.lead_status as enum ('to_contact','invitation_sent','accepted','replied','meeting');
create type public.decision_kind as enum ('approve','reject','skip_low_score');
create type public.plan_kind as enum ('trial','pro','team');
create type public.app_mode as enum ('copilot','autopilot');
create type public.action_result as enum ('success','failure','skipped');
create type public.queue_status as enum ('pending','done','failed','cancelled');

-- ---------- Teams & users ----------
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text,
  full_name text,
  avatar_url text,
  locale text not null default 'fr' check (locale in ('fr','en')),
  team_id uuid references public.teams(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  mode public.app_mode not null default 'copilot',
  active_persona_id uuid,
  daily_profile_views int not null default 80 check (daily_profile_views between 1 and 300),
  daily_invitations int not null default 20 check (daily_invitations between 1 and 100),
  weekly_invitations int not null default 100 check (weekly_invitations between 1 and 200),
  daily_messages int not null default 50 check (daily_messages between 1 and 150),
  min_delay_seconds int not null default 45,
  max_delay_seconds int not null default 180,
  work_start_hour int not null default 9 check (work_start_hour between 0 and 23),
  work_end_hour int not null default 19 check (work_end_hour between 1 and 24),
  work_days int[] not null default '{1,2,3,4,5}',
  timezone text not null default 'Europe/Paris',
  min_match_score int not null default 60 check (min_match_score between 0 and 100),
  withdraw_pending_after_days int not null default 21,
  purge_rejected_after_months int not null default 6,
  autopilot_warning_accepted_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan public.plan_kind not null default 'trial',
  status text not null default 'trialing',
  trial_ends_at timestamptz not null default (now() + interval '7 days'),
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

-- Profile of the user analysed at onboarding (phase 2: auto persona).
create table public.linkedin_profiles_user (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_url text,
  company_url text,
  profile_data jsonb not null default '{}',
  company_data jsonb not null default '{}',
  analyzed_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- Personas, pitch, copywriting, knowledge ----------
create table public.personas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  name text not null check (char_length(name) between 1 and 80),
  job_titles text[] not null default '{}' check (cardinality(job_titles) <= 5),
  locations text[] not null default '{}',
  industries text[] not null default '{}',
  company_sizes text[] not null default '{}',
  keywords text[] not null default '{}' check (cardinality(keywords) <= 5),
  formal_address boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.personas (user_id);

alter table public.user_settings
  add constraint user_settings_active_persona_fk
  foreign key (active_persona_id) references public.personas(id) on delete set null;

create table public.pitches (
  persona_id uuid primary key references public.personas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  description text not null default '',
  benefits text not null default '',
  updated_at timestamptz not null default now()
);

create table public.copywriting_settings (
  persona_id uuid primary key references public.personas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  template text not null default '',
  instructions text not null default '',
  updated_at timestamptz not null default now()
);

create table public.knowledge_docs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  content text not null default '' check (char_length(content) <= 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Prospects, decisions, messages, leads ----------
create table public.prospects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  persona_id uuid references public.personas(id) on delete set null,
  linkedin_url text not null,
  full_name text,
  first_name text,
  headline text,
  company text,
  location text,
  about text,
  photo_url text,
  experiences jsonb not null default '[]',
  recent_activity jsonb not null default '[]',
  score int check (score between 0 and 100),
  score_reason text,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, linkedin_url)
);

create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  persona_id uuid references public.personas(id) on delete set null,
  decision public.decision_kind not null,
  created_at timestamptz not null default now(),
  unique (user_id, prospect_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  persona_id uuid references public.personas(id) on delete set null,
  kind text not null default 'invitation'
    check (kind in ('invitation','followup_1','followup_2','followup_3','followup_4')),
  text text not null,
  version int not null default 1,
  regeneration_count int not null default 0,
  edited boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.messages (prospect_id, kind, version desc);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  persona_id uuid references public.personas(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  status public.lead_status not null default 'to_contact',
  last_action text,
  seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, prospect_id)
);
create index on public.leads (user_id, created_at desc);

create table public.exclusion_list (
  user_id uuid not null references auth.users(id) on delete cascade,
  linkedin_url text not null,
  reason text,
  created_at timestamptz not null default now(),
  primary key (user_id, linkedin_url)
);

-- ---------- Automation: logs, campaigns, queue (autopilot = phase 2) ----------
create table public.action_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  action_type text not null,         -- profile_view, invitation, message, search_page, pause, ...
  prospect_id uuid references public.prospects(id) on delete set null,
  linkedin_url text,
  result public.action_result not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on public.action_logs (user_id, action_type, created_at desc);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  persona_id uuid not null references public.personas(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','running','paused','finished')),
  batch_validation boolean not null default false,
  followup_delays_days int[] not null default '{3,7,14}',
  warmup_visit boolean not null default true,
  warmup_follow boolean not null default false,
  warmup_like boolean not null default false,
  paused_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Only one running campaign per account.
create unique index campaigns_one_running on public.campaigns (user_id) where status = 'running';

create table public.action_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  prospect_id uuid references public.prospects(id) on delete cascade,
  action_type text not null,
  payload jsonb not null default '{}',
  scheduled_at timestamptz not null default now(),
  status public.queue_status not null default 'pending',
  attempts int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.action_queue (user_id, status, scheduled_at);

-- ---------- Helpers ----------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['user_settings','subscriptions','personas','pitches','copywriting_settings',
                           'knowledge_docs','prospects','leads','campaigns','action_queue']
  loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;

-- New user bootstrap: profile + settings + 7-day trial (no credit card).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, first_name, full_name, avatar_url)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data->>'first_name', ''),
      nullif(split_part(coalesce(new.raw_user_meta_data->>'full_name', ''), ' ', 1), ''),
      initcap(split_part(split_part(new.email, '@', 1), '.', 1))
    ),
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  insert into public.user_settings (user_id) values (new.id);
  insert into public.subscriptions (user_id) values (new.id);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_paid(uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.subscriptions s
    where s.user_id = uid and s.plan in ('pro','team') and s.status in ('active','trialing_paid')
  );
$$;

create or replace function public.has_access(uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.subscriptions s
    where s.user_id = uid
      and ((s.plan = 'trial' and s.trial_ends_at > now()) or s.status = 'active')
  );
$$;

-- Persona limit: 3 during the trial, 20 on paid plans.
create or replace function public.enforce_persona_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int; max_n int;
begin
  select count(*) into n from public.personas where user_id = new.user_id;
  max_n := case when public.is_paid(new.user_id) then 20 else 3 end;
  if n >= max_n then
    raise exception 'persona_limit_reached' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger personas_limit before insert on public.personas
  for each row execute function public.enforce_persona_limit();

-- Returns, among candidate URLs, those never decided, excluded, or already a lead.
create or replace function public.filter_new_profiles(urls text[]) returns setof text
language sql stable security invoker set search_path = public as $$
  select u from unnest(urls) as u
  where not exists (
    select 1 from public.prospects p
    join public.decisions d on d.prospect_id = p.id
    where p.user_id = auth.uid() and p.linkedin_url = u
  )
  and not exists (select 1 from public.exclusion_list e where e.user_id = auth.uid() and e.linkedin_url = u)
  and not exists (
    select 1 from public.prospects p join public.leads l on l.prospect_id = p.id
    where p.user_id = auth.uid() and p.linkedin_url = u
  );
$$;

-- Number of successful actions of a given type today (in the user's timezone).
create or replace function public.count_actions_today(p_action text) returns int
language sql stable security invoker set search_path = public as $$
  select count(*)::int from public.action_logs a
  join public.user_settings s on s.user_id = a.user_id
  where a.user_id = auth.uid()
    and a.action_type = p_action
    and a.result = 'success'
    and (a.created_at at time zone s.timezone)::date = (now() at time zone s.timezone)::date;
$$;

create or replace function public.count_actions_week(p_action text) returns int
language sql stable security invoker set search_path = public as $$
  select count(*)::int from public.action_logs a
  where a.user_id = auth.uid() and a.action_type = p_action and a.result = 'success'
    and a.created_at > now() - interval '7 days';
$$;

-- GDPR: purge rejected prospects older than the user's retention setting.
-- Schedule with pg_cron: select cron.schedule('purge-rejected', '0 3 * * *', 'select public.purge_rejected_prospects()');
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
  -- Keep the URL in the exclusion list so the profile is never proposed again.
  return n;
end $$;

-- Rejected profiles go to the exclusion list so they survive the purge.
create or replace function public.exclude_on_reject() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.decision = 'reject' then
    insert into public.exclusion_list (user_id, linkedin_url, reason)
    select new.user_id, p.linkedin_url, 'rejected' from public.prospects p where p.id = new.prospect_id
    on conflict do nothing;
  end if;
  return new;
end $$;
create trigger decisions_exclude after insert or update on public.decisions
  for each row execute function public.exclude_on_reject();

-- GDPR: delete all prospecting data of the current user.
create or replace function public.delete_my_prospecting_data() returns void
language sql security definer set search_path = public as $$
  delete from public.prospects where user_id = auth.uid();
  delete from public.action_logs where user_id = auth.uid();
  delete from public.exclusion_list where user_id = auth.uid();
$$;

-- ---------- Row Level Security ----------
do $$
declare t text;
begin
  foreach t in array array['user_settings','subscriptions','linkedin_profiles_user','personas','pitches',
                           'copywriting_settings','knowledge_docs','prospects','decisions','messages','leads',
                           'exclusion_list','action_logs','campaigns','action_queue']
  loop
    execute format('alter table public.%I enable row level security', t);
    if t = 'subscriptions' then
      execute format('create policy "own rows (read)" on public.%I for select using (user_id = auth.uid())', t);
    else
      execute format('create policy "own rows" on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    end if;
  end loop;
end $$;

alter table public.profiles enable row level security;
create policy "own profile" on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());

alter table public.teams enable row level security;
create policy "team members read" on public.teams for select
  using (owner_id = auth.uid() or id in (select team_id from public.profiles where id = auth.uid()));
create policy "team owner write" on public.teams for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Action logs are append-only for clients.
drop policy "own rows" on public.action_logs;
create policy "own logs read" on public.action_logs for select using (user_id = auth.uid());
create policy "own logs insert" on public.action_logs for insert with check (user_id = auth.uid());
