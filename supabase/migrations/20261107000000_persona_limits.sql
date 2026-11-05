-- Personas: up to 10 job titles and 10 keywords (was 5), with a bound on total length.
alter table public.personas drop constraint if exists personas_job_titles_check;
alter table public.personas drop constraint if exists personas_keywords_check;
alter table public.personas
  add constraint personas_job_titles_check check (
    cardinality(job_titles) <= 10 and char_length(array_to_string(job_titles, '')) <= 800
  ),
  add constraint personas_keywords_check check (
    cardinality(keywords) <= 10 and char_length(array_to_string(keywords, '')) <= 600
  );
