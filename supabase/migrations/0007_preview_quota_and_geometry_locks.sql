-- Distributed preview quota and short-lived geometry build locks for serverless API hosts.
-- Service role only. The API fails closed when charge_preview_quota is unavailable in production.

create table if not exists preview_charges (
    id bigserial primary key,
    owner_id text not null,
    charged_at timestamptz not null default now()
);

create index if not exists preview_charges_owner_recent_idx
    on preview_charges (owner_id, charged_at desc);

alter table preview_charges enable row level security;

grant select, insert, delete on preview_charges to service_role;
grant usage, select on sequence preview_charges_id_seq to service_role;

create or replace function public.charge_preview_quota(p_owner_id text, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    inserted bigint;
begin
    if p_owner_id is null or length(trim(p_owner_id)) = 0 then
        return false;
    end if;
    if p_limit is null or p_limit < 1 then
        return false;
    end if;

    delete from preview_charges
    where owner_id = p_owner_id
      and charged_at < now() - interval '1 hour';

    with recent as (
        select count(*)::integer as n
        from preview_charges
        where owner_id = p_owner_id
          and charged_at >= now() - interval '1 hour'
    ),
    ins as (
        insert into preview_charges (owner_id)
        select p_owner_id
        from recent
        where recent.n < p_limit
        returning id
    )
    select count(*) into inserted from ins;

    return inserted > 0;
end;
$$;

revoke all on function public.charge_preview_quota(text, integer) from public;
grant execute on function public.charge_preview_quota(text, integer) to service_role;

create table if not exists geometry_build_locks (
    digest text primary key,
    owner_id text not null,
    expires_at timestamptz not null,
    created_at timestamptz not null default now()
);

alter table geometry_build_locks enable row level security;

grant select, insert, update, delete on geometry_build_locks to service_role;

create or replace function public.claim_geometry_build_lock(
    p_digest text,
    p_owner_id text,
    p_ttl_seconds integer default 120
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    claimed text;
begin
    if p_digest is null or length(p_digest) <> 64 then
        return false;
    end if;
    if p_owner_id is null or length(trim(p_owner_id)) = 0 then
        return false;
    end if;

    delete from geometry_build_locks where expires_at < now();

    insert into geometry_build_locks (digest, owner_id, expires_at)
    values (
        p_digest,
        p_owner_id,
        now() + make_interval(secs => greatest(coalesce(p_ttl_seconds, 120), 15))
    )
    on conflict (digest) do update
        set owner_id = excluded.owner_id,
            expires_at = excluded.expires_at,
            created_at = now()
        where geometry_build_locks.expires_at < now()
    returning digest into claimed;

    return claimed is not null;
end;
$$;

create or replace function public.release_geometry_build_lock(p_digest text, p_owner_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    delete from geometry_build_locks
    where digest = p_digest
      and owner_id = p_owner_id;
end;
$$;

revoke all on function public.claim_geometry_build_lock(text, text, integer) from public;
revoke all on function public.release_geometry_build_lock(text, text) from public;
grant execute on function public.claim_geometry_build_lock(text, text, integer) to service_role;
grant execute on function public.release_geometry_build_lock(text, text) to service_role;
