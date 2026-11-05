-- RLS / ownership tests: user B must not read or modify user A's data by changing IDs.
-- Run: see supabase/tests/run_local.sh
\set ON_ERROR_STOP on
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.fr'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.fr');

create function pg_temp.expect_error(sql text, label text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    raise notice 'OK  %  (%)', label, sqlerrm;
    return;
  end;
  raise exception 'FAIL % : statement succeeded', label;
end $$;
create function pg_temp.expect(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond then raise notice 'OK  %', label; else raise exception 'FAIL %', label; end if;
end $$;

-- ===== User A creates data =====
set role authenticated;
set request.jwt.claim.role = 'authenticated';
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into personas (id, user_id, name) values ('10000000-0000-0000-0000-00000000000a', auth.uid(), 'Persona A');
insert into pitches (persona_id, user_id, title) values ('10000000-0000-0000-0000-00000000000a', auth.uid(), 'Offre A');
insert into prospects (id, user_id, persona_id, linkedin_url, full_name)
  values ('20000000-0000-0000-0000-00000000000a', auth.uid(), '10000000-0000-0000-0000-00000000000a', 'https://www.linkedin.com/in/alice/', 'Alice');
insert into messages (id, user_id, prospect_id, text)
  values ('30000000-0000-0000-0000-00000000000a', auth.uid(), '20000000-0000-0000-0000-00000000000a', 'Bonjour Alice, test ?');
insert into leads (id, user_id, prospect_id, persona_id, message_id)
  values ('40000000-0000-0000-0000-00000000000a', auth.uid(), '20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select count(*) from search_leads()) = 1, 'A sees own lead via search_leads');
insert into teams (id, name, owner_id) values ('50000000-0000-0000-0000-00000000000a', 'Team A', auth.uid());

-- ===== User B tries to reach A's data =====
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
insert into prospects (id, user_id, linkedin_url) values ('20000000-0000-0000-0000-00000000000b', auth.uid(), 'https://www.linkedin.com/in/bob/');
select pg_temp.expect((select count(*) from personas) = 0, 'B cannot read A personas');
select pg_temp.expect((select count(*) from pitches) = 0, 'B cannot read A pitches');
select pg_temp.expect((select count(*) from prospects where user_id <> auth.uid()) = 0 and (select count(*) from prospects) = 1, 'B cannot read A prospects');
select pg_temp.expect((select count(*) from messages) = 0, 'B cannot read A messages');
select pg_temp.expect((select count(*) from leads) = 0, 'B cannot read A leads');
select pg_temp.expect((select count(*) from search_leads()) = 0, 'B search_leads returns nothing of A');
select pg_temp.expect((select count(*) from profiles) = 1, 'B reads only own profile');
select pg_temp.expect((select count(*) from subscriptions) = 1, 'B reads only own subscription');

update personas set name = 'hacked' where id = '10000000-0000-0000-0000-00000000000a';
delete from leads where id = '40000000-0000-0000-0000-00000000000a';
update messages set text = 'hacked' where id = '30000000-0000-0000-0000-00000000000a';

select pg_temp.expect_error($$insert into pitches (persona_id, user_id, title) values ('10000000-0000-0000-0000-00000000000a', auth.uid(), 'x') on conflict do nothing$$, 'B cannot attach a pitch to A persona');
select pg_temp.expect_error($$insert into copywriting_settings (persona_id, user_id) values ('10000000-0000-0000-0000-00000000000a', auth.uid())$$, 'B cannot attach copywriting to A persona');
select pg_temp.expect_error($$insert into leads (user_id, prospect_id) values (auth.uid(), '20000000-0000-0000-0000-00000000000a')$$, 'B cannot create a lead on A prospect');
select pg_temp.expect_error($$insert into decisions (user_id, prospect_id, decision) values (auth.uid(), '20000000-0000-0000-0000-00000000000a', 'reject')$$, 'B cannot decide on A prospect');
select pg_temp.expect_error($$insert into personas (user_id, name) values ('00000000-0000-0000-0000-00000000000a', 'spoof')$$, 'B cannot insert with A user_id');
select pg_temp.expect_error($$update user_settings set active_persona_id = '10000000-0000-0000-0000-00000000000a'$$, 'B cannot point settings to A persona');
select pg_temp.expect((select count(*) from teams) = 0, 'B cannot read A team');
select pg_temp.expect_error($$update profiles set team_id = '50000000-0000-0000-0000-00000000000a'$$, 'B cannot join A team by setting team_id');
select pg_temp.expect_error($$insert into leads (user_id, prospect_id, team_id) values (auth.uid(), '20000000-0000-0000-0000-00000000000b', '50000000-0000-0000-0000-00000000000a')$$, 'B cannot tag a lead with a team');
update subscriptions set plan = 'pro', status = 'active';
select pg_temp.expect((select plan from subscriptions) = 'trial' and not is_paid(), 'B cannot upgrade own subscription');
select pg_temp.expect_error($$select check_rate_limit('x', 1, 60)$$, 'B cannot call check_rate_limit');
select pg_temp.expect_error($$select purge_rejected_prospects()$$, 'B cannot call purge');
select pg_temp.expect(not is_paid('00000000-0000-0000-0000-00000000000a') and not has_access('00000000-0000-0000-0000-00000000000a'), 'B cannot probe A subscription');
select pg_temp.expect((select count(*) from rate_limits) = 0 and (select count(*) from app_config) = 0, 'server-only tables invisible');
select pg_temp.expect_error($$insert into app_config values ('global_daily_ai_calls', 999999999)$$, 'B cannot raise global cap');
select pg_temp.expect_error($$insert into ai_usage (user_id, kind) values (auth.uid(), 'generate')$$, 'B cannot write ai_usage directly');
select pg_temp.expect_error($$insert into prospects (user_id, linkedin_url) values (auth.uid(), 'javascript:alert(1)')$$, 'invalid LinkedIn URL rejected');
select pg_temp.expect_error($$insert into prospects (user_id, linkedin_url, photo_url) values (auth.uid(), 'https://www.linkedin.com/in/carl/', 'https://evil.example/x.png')$$, 'non-LinkedIn photo URL rejected');
select pg_temp.expect_error($$insert into messages (user_id, prospect_id, text) values (auth.uid(), '20000000-0000-0000-0000-00000000000b', repeat('a', 301))$$, 'invitation over 300 chars rejected');

-- AI quota: 20 calls per minute, then rate limited.
do $$ begin for i in 1..20 loop perform consume_ai_quota('generate'); end loop; end $$;
select pg_temp.expect_error($$select consume_ai_quota('generate')$$, '21st AI call within a minute is rate limited');

-- ===== Back to A: data intact =====
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.expect((select name from personas) = 'Persona A', 'A persona untouched');
select pg_temp.expect((select count(*) from leads) = 1, 'A lead untouched');
select pg_temp.expect((select text from messages) = 'Bonjour Alice, test ?', 'A message untouched');
select pg_temp.expect((select count(*) from ai_usage) = 0, 'A does not see B AI usage');

-- ===== Anonymous: nothing =====
reset request.jwt.claim.sub;
set role anon;
select pg_temp.expect((select count(*) from personas) + (select count(*) from leads) + (select count(*) from profiles) = 0, 'anon reads nothing');
reset role;
\echo ALL RLS TESTS PASSED
