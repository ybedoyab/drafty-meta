-- Scenario history and owner write policies.
-- The API may use the service role. Authenticated clients can touch only their rows.
-- Authorization uses auth.uid(), never user-editable metadata.

alter table jobs add column if not exists scenario_id uuid;
alter table jobs add column if not exists optimization jsonb;
alter table artifacts add column if not exists sha256 text;
alter table artifacts add column if not exists byte_length bigint;

create table if not exists scenarios (
    id uuid primary key,
    owner_id text not null,
    name text not null default 'Untitled',
    version integer not null default 1,
    state jsonb not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists scenario_versions (
    id uuid primary key default gen_random_uuid(),
    scenario_id uuid not null references scenarios (id) on delete cascade,
    owner_id text not null,
    version integer not null,
    inputs jsonb not null,
    studio_spec jsonb,
    studio_approval text,
    created_at timestamptz not null default now(),
    unique (scenario_id, version)
);

create table if not exists sources (
    id uuid primary key default gen_random_uuid(),
    scenario_id uuid not null references scenarios (id) on delete cascade,
    owner_id text not null,
    evidence_class text not null,
    title text,
    url text,
    created_at timestamptz not null default now()
);

create table if not exists images (
    id uuid primary key,
    scenario_id uuid references scenarios (id) on delete cascade,
    owner_id text not null,
    storage_path text not null,
    content_type text,
    sha256 text,
    created_at timestamptz not null default now()
);

create table if not exists reports (
    id uuid primary key default gen_random_uuid(),
    job_id uuid not null references jobs (id) on delete cascade,
    owner_id text not null,
    name text not null,
    storage_path text not null,
    sha256 text,
    created_at timestamptz not null default now()
);

alter table scenarios enable row level security;
alter table scenario_versions enable row level security;
alter table sources enable row level security;
alter table images enable row level security;
alter table reports enable row level security;

create policy "owner reads scenarios" on scenarios
    for select to authenticated using (owner_id = (select auth.uid())::text);
create policy "owner inserts scenarios" on scenarios
    for insert to authenticated with check (owner_id = (select auth.uid())::text);
create policy "owner updates scenarios" on scenarios
    for update to authenticated
    using (owner_id = (select auth.uid())::text)
    with check (owner_id = (select auth.uid())::text);
create policy "owner deletes scenarios" on scenarios
    for delete to authenticated using (owner_id = (select auth.uid())::text);

create policy "owner reads scenario versions" on scenario_versions
    for select to authenticated using (owner_id = (select auth.uid())::text);
create policy "owner inserts scenario versions" on scenario_versions
    for insert to authenticated with check (
        owner_id = (select auth.uid())::text
        and exists (
            select 1 from scenarios
            where scenarios.id = scenario_versions.scenario_id
              and scenarios.owner_id = (select auth.uid())::text
        )
    );

create policy "owner reads sources" on sources
    for select to authenticated using (owner_id = (select auth.uid())::text);
create policy "owner inserts sources" on sources
    for insert to authenticated with check (owner_id = (select auth.uid())::text);

create policy "owner reads images" on images
    for select to authenticated using (owner_id = (select auth.uid())::text);
create policy "owner inserts images" on images
    for insert to authenticated with check (owner_id = (select auth.uid())::text);

create policy "owner reads reports" on reports
    for select to authenticated using (owner_id = (select auth.uid())::text);
create policy "owner inserts reports" on reports
    for insert to authenticated with check (owner_id = (select auth.uid())::text);

create policy "owner inserts projects" on projects
    for insert to authenticated with check (owner_id = (select auth.uid())::text);
create policy "owner updates projects" on projects
    for update to authenticated
    using (owner_id = (select auth.uid())::text)
    with check (owner_id = (select auth.uid())::text);
create policy "owner deletes projects" on projects
    for delete to authenticated using (owner_id = (select auth.uid())::text);

create policy "owner inserts designs" on designs
    for insert to authenticated with check (owner_id = (select auth.uid())::text);
create policy "owner updates designs" on designs
    for update to authenticated
    using (owner_id = (select auth.uid())::text)
    with check (owner_id = (select auth.uid())::text);
create policy "owner deletes designs" on designs
    for delete to authenticated using (owner_id = (select auth.uid())::text);

create policy "owner inserts revisions" on revisions
    for insert to authenticated with check (
        exists (
            select 1 from designs
            where designs.id = revisions.design_id
              and designs.owner_id = (select auth.uid())::text
        )
    );

create policy "owner inserts jobs" on jobs
    for insert to authenticated with check (owner_id = (select auth.uid())::text);
create policy "owner updates jobs" on jobs
    for update to authenticated
    using (owner_id = (select auth.uid())::text)
    with check (owner_id = (select auth.uid())::text);
create policy "owner deletes jobs" on jobs
    for delete to authenticated using (owner_id = (select auth.uid())::text);

create policy "owner inserts results" on results
    for insert to authenticated with check (
        exists (
            select 1 from jobs
            where jobs.id = results.job_id and jobs.owner_id = (select auth.uid())::text
        )
    );

create policy "owner inserts artifacts" on artifacts
    for insert to authenticated with check (
        exists (
            select 1 from jobs
            where jobs.id = artifacts.job_id and jobs.owner_id = (select auth.uid())::text
        )
    );

create policy "owner reads own artifact files" on storage.objects
    for select to authenticated using (
        bucket_id = 'artifacts'
        and (storage.foldername(name))[1] = (select auth.uid())::text
    );
create policy "owner uploads own artifact files" on storage.objects
    for insert to authenticated with check (
        bucket_id = 'artifacts'
        and (storage.foldername(name))[1] = (select auth.uid())::text
    );
create policy "owner updates own artifact files" on storage.objects
    for update to authenticated
    using (
        bucket_id = 'artifacts'
        and (storage.foldername(name))[1] = (select auth.uid())::text
    )
    with check (
        bucket_id = 'artifacts'
        and (storage.foldername(name))[1] = (select auth.uid())::text
    );
create policy "owner deletes own artifact files" on storage.objects
    for delete to authenticated using (
        bucket_id = 'artifacts'
        and (storage.foldername(name))[1] = (select auth.uid())::text
    );
