-- Distributed preview quota and short-lived geometry build locks for serverless API hosts.
-- Service role only. The API fails closed when these RPCs are unavailable in production.
--
-- SECURITY DEFINER hardening:
--   * search_path pinned to pg_catalog only (no writable schemas)
--   * all relations/functions schema-qualified
--   * EXECUTE revoked from PUBLIC / anon / authenticated; granted only to service_role

create table if not exists public.preview_charges (
    id bigserial primary key,
    owner_id text not null,
    charged_at timestamptz not null default pg_catalog.now()
);

create index if not exists preview_charges_owner_recent_idx
    on public.preview_charges (owner_id, charged_at desc);

alter table public.preview_charges enable row level security;

grant select, insert, delete on public.preview_charges to service_role;
grant usage, select on sequence public.preview_charges_id_seq to service_role;

create or replace function public.charge_preview_quota(p_owner_id text, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path to pg_catalog
as $$
declare
    inserted bigint;
begin
    if p_owner_id is null or pg_catalog.length(pg_catalog.btrim(p_owner_id)) = 0 then
        return false;
    end if;
    if p_limit is null or p_limit < 1 then
        return false;
    end if;

    -- Serialize concurrent charges for the same owner across independent transactions.
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('drafty.preview_quota'),
        pg_catalog.hashtext(p_owner_id)
    );

    delete from public.preview_charges
    where owner_id = p_owner_id
      and charged_at < pg_catalog.now() - interval '1 hour';

    with recent as (
        select pg_catalog.count(*)::integer as n
        from public.preview_charges
        where owner_id = p_owner_id
          and charged_at >= pg_catalog.now() - interval '1 hour'
    ),
    ins as (
        insert into public.preview_charges (owner_id)
        select p_owner_id
        from recent
        where recent.n < p_limit
        returning id
    )
    select pg_catalog.count(*) into inserted from ins;

    return inserted > 0;
end;
$$;

revoke all on function public.charge_preview_quota(text, integer) from public;
revoke all on function public.charge_preview_quota(text, integer) from anon, authenticated;
grant execute on function public.charge_preview_quota(text, integer) to service_role;

create table if not exists public.geometry_build_locks (
    digest text primary key,
    owner_id text not null,
    expires_at timestamptz not null,
    created_at timestamptz not null default pg_catalog.now()
);

alter table public.geometry_build_locks enable row level security;

grant select, insert, update, delete on public.geometry_build_locks to service_role;

create or replace function public.claim_geometry_build_lock(
    p_digest text,
    p_owner_id text,
    p_ttl_seconds integer default 120
)
returns boolean
language plpgsql
security definer
set search_path to pg_catalog
as $$
declare
    claimed text;
    ttl integer;
begin
    if p_digest is null or pg_catalog.length(p_digest) <> 64 then
        return false;
    end if;
    if p_owner_id is null or pg_catalog.length(pg_catalog.btrim(p_owner_id)) = 0 then
        return false;
    end if;

    -- GREATEST/COALESCE are SQL constructs, not pg_catalog functions.
    ttl := GREATEST(COALESCE(p_ttl_seconds, 120), 15);

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('drafty.geometry_lock'),
        pg_catalog.hashtext(p_digest)
    );

    delete from public.geometry_build_locks
    where expires_at < pg_catalog.now();

    insert into public.geometry_build_locks (digest, owner_id, expires_at)
    values (
        p_digest,
        p_owner_id,
        pg_catalog.now() + pg_catalog.make_interval(secs => ttl)
    )
    on conflict (digest) do update
        set owner_id = excluded.owner_id,
            expires_at = excluded.expires_at,
            created_at = pg_catalog.now()
        where public.geometry_build_locks.expires_at < pg_catalog.now()
    returning digest into claimed;

    return claimed is not null;
end;
$$;

create or replace function public.release_geometry_build_lock(p_digest text, p_owner_id text)
returns void
language plpgsql
security definer
set search_path to pg_catalog
as $$
begin
    delete from public.geometry_build_locks
    where digest = p_digest
      and owner_id = p_owner_id;
end;
$$;

revoke all on function public.claim_geometry_build_lock(text, text, integer) from public;
revoke all on function public.claim_geometry_build_lock(text, text, integer) from anon, authenticated;
revoke all on function public.release_geometry_build_lock(text, text) from public;
revoke all on function public.release_geometry_build_lock(text, text) from anon, authenticated;
grant execute on function public.claim_geometry_build_lock(text, text, integer) to service_role;
grant execute on function public.release_geometry_build_lock(text, text) to service_role;
