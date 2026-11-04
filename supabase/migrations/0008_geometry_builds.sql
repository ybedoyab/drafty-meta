-- Durable geometry build jobs for async Modal generation (service role only).
-- Digests stay content-addressed; this table tracks in-flight / failed builds only.
--
-- SECURITY DEFINER hardening matches 0007:
--   * search_path pinned to pg_catalog
--   * EXECUTE revoked from PUBLIC / anon / authenticated; granted only to service_role

create table if not exists public.geometry_builds (
    digest text primary key,
    owner_id text not null,
    status text not null,
    modal_call_id text,
    profile jsonb not null default '{}'::jsonb,
    error text,
    charged boolean not null default false,
    created_at timestamptz not null default pg_catalog.now(),
    updated_at timestamptz not null default pg_catalog.now(),
    constraint geometry_builds_status_check
        check (status in ('queued', 'running', 'completed', 'failed'))
);

alter table public.geometry_builds enable row level security;

grant select, insert, update, delete on public.geometry_builds to service_role;

create or replace function public.upsert_geometry_build(
    p_digest text,
    p_owner_id text,
    p_status text,
    p_modal_call_id text default null,
    p_profile jsonb default '{}'::jsonb,
    p_error text default null,
    p_charged boolean default false
)
returns void
language plpgsql
security definer
set search_path to pg_catalog
as $$
begin
    if p_digest is null or pg_catalog.length(p_digest) <> 64 then
        raise exception 'invalid geometry digest';
    end if;
    if p_owner_id is null or pg_catalog.length(pg_catalog.btrim(p_owner_id)) = 0 then
        raise exception 'invalid owner';
    end if;
    if p_status is null or p_status not in ('queued', 'running', 'completed', 'failed') then
        raise exception 'invalid geometry build status';
    end if;

    insert into public.geometry_builds (
        digest, owner_id, status, modal_call_id, profile, error, charged, updated_at
    )
    values (
        p_digest,
        p_owner_id,
        p_status,
        p_modal_call_id,
        COALESCE(p_profile, '{}'::jsonb),
        p_error,
        COALESCE(p_charged, false),
        pg_catalog.now()
    )
    on conflict (digest) do update
        set owner_id = excluded.owner_id,
            status = excluded.status,
            modal_call_id = excluded.modal_call_id,
            profile = excluded.profile,
            error = excluded.error,
            charged = public.geometry_builds.charged or excluded.charged,
            updated_at = pg_catalog.now();
end;
$$;

create or replace function public.get_geometry_build(p_digest text)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog
as $$
declare
    row public.geometry_builds%rowtype;
begin
    if p_digest is null or pg_catalog.length(p_digest) <> 64 then
        return null;
    end if;
    select * into row from public.geometry_builds where digest = p_digest;
    if not found then
        return null;
    end if;
    return pg_catalog.jsonb_build_object(
        'digest', row.digest,
        'owner_id', row.owner_id,
        'status', row.status,
        'modal_call_id', row.modal_call_id,
        'profile', row.profile,
        'error', row.error,
        'charged', row.charged,
        'created_at', row.created_at,
        'updated_at', row.updated_at
    );
end;
$$;

revoke all on function public.upsert_geometry_build(text, text, text, text, jsonb, text, boolean) from public;
revoke all on function public.upsert_geometry_build(text, text, text, text, jsonb, text, boolean) from anon, authenticated;
revoke all on function public.get_geometry_build(text) from public;
revoke all on function public.get_geometry_build(text) from anon, authenticated;
grant execute on function public.upsert_geometry_build(text, text, text, text, jsonb, text, boolean) to service_role;
grant execute on function public.get_geometry_build(text) to service_role;
