-- Projects, designs, jobs, and private artifacts.
-- The API uses the service role. Authenticated users can read their own rows.

create extension if not exists pgcrypto;

create table if not exists projects (
    id uuid primary key default gen_random_uuid(),
    owner_id text not null,
    name text not null,
    created_at timestamptz not null default now()
);

create table if not exists designs (
    id uuid primary key default gen_random_uuid(),
    project_id uuid references projects (id) on delete cascade,
    owner_id text not null,
    name text not null,
    spec jsonb not null,
    created_at timestamptz not null default now()
);

create table if not exists revisions (
    id uuid primary key default gen_random_uuid(),
    design_id uuid not null references designs (id) on delete cascade,
    spec jsonb not null,
    created_at timestamptz not null default now()
);

create table if not exists jobs (
    id uuid primary key,
    owner_id text not null,
    design_id uuid references designs (id) on delete set null,
    kind text not null,
    status text not null,
    spec jsonb not null,
    error text,
    summary jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists results (
    id uuid primary key default gen_random_uuid(),
    job_id uuid not null unique references jobs (id) on delete cascade,
    summary jsonb not null,
    created_at timestamptz not null default now()
);

create table if not exists artifacts (
    id uuid primary key default gen_random_uuid(),
    job_id uuid not null references jobs (id) on delete cascade,
    name text not null,
    storage_path text not null,
    content_type text,
    created_at timestamptz not null default now()
);

alter table projects enable row level security;
alter table designs enable row level security;
alter table revisions enable row level security;
alter table jobs enable row level security;
alter table results enable row level security;
alter table artifacts enable row level security;

create policy "owner reads projects" on projects
    for select to authenticated using (owner_id = auth.uid()::text);
create policy "owner reads designs" on designs
    for select to authenticated using (owner_id = auth.uid()::text);
create policy "owner reads revisions" on revisions
    for select to authenticated using (
        exists (
            select 1 from designs
            where designs.id = revisions.design_id and designs.owner_id = auth.uid()::text
        )
    );
create policy "owner reads jobs" on jobs
    for select to authenticated using (owner_id = auth.uid()::text);
create policy "owner reads results" on results
    for select to authenticated using (
        exists (
            select 1 from jobs
            where jobs.id = results.job_id and jobs.owner_id = auth.uid()::text
        )
    );
create policy "owner reads artifacts" on artifacts
    for select to authenticated using (
        exists (
            select 1 from jobs
            where jobs.id = artifacts.job_id and jobs.owner_id = auth.uid()::text
        )
    );

insert into storage.buckets (id, name, public)
values ('artifacts', 'artifacts', false)
on conflict (id) do nothing;
