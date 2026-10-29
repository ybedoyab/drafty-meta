-- Production jobs are written by the API service role. Authenticated users can read
-- their rows and cannot change status, results, or the dispatch secret.

alter table jobs add column if not exists compute text;
alter table jobs add column if not exists message text;
alter table jobs add column if not exists artifact_storage text;
alter table jobs add column if not exists request_hash text;

create table if not exists job_dispatch (
    job_id uuid primary key references jobs (id) on delete cascade,
    callback_token text not null,
    modal_call_id text,
    created_at timestamptz not null default now()
);

alter table job_dispatch enable row level security;

drop policy if exists "owner inserts jobs" on jobs;
drop policy if exists "owner updates jobs" on jobs;
drop policy if exists "owner deletes jobs" on jobs;
drop policy if exists "owner inserts results" on results;
drop policy if exists "owner inserts artifacts" on artifacts;

create index if not exists jobs_owner_created_idx on jobs (owner_id, created_at desc);
create unique index if not exists artifacts_job_name_idx on artifacts (job_id, name);

grant select, insert, update, delete on job_dispatch to service_role;
