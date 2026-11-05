-- =============================================================
-- Automatic onboarding: the user's own LinkedIn profile + company page → suggested persona & pitch.
-- Stored in linkedin_profiles_user (RLS: own rows only, already in place). Nothing is created
-- in personas until the user reviews and saves the pre-filled form.
-- =============================================================
alter table public.linkedin_profiles_user
  add column if not exists suggestion jsonb not null default '{}';

alter table public.linkedin_profiles_user drop constraint if exists linkedin_profiles_user_sizes;
alter table public.linkedin_profiles_user add constraint linkedin_profiles_user_sizes check (
  pg_column_size(profile_data) <= 32768
  and pg_column_size(company_data) <= 16384
  and pg_column_size(suggestion) <= 16384
  and (profile_url is null or profile_url ~ '^https://www\.linkedin\.com/in/[^/?#\s]{1,200}/$')
  and (company_url is null or company_url ~ '^https://www\.linkedin\.com/company/[^/?#\s]{1,200}/$')
);

create index if not exists linkedin_profiles_user_latest on public.linkedin_profiles_user (user_id, created_at desc);
