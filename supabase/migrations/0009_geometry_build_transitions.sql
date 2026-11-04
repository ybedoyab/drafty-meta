-- Conditional geometry-build transitions for durable async Modal generation.
-- Does not alter 0008 table shape. Service role only.
--
-- claim_geometry_build_start: exclusive start or resume of a queued attempt
-- mark_geometry_build_charged: durable charge bit before Modal spawn
-- attach_geometry_build_call: bind Modal call id only onto queued attempts
-- transition_geometry_build: status changes only from allowed prior states

create or replace function public.claim_geometry_build_start(
    p_digest text,
    p_owner_id text,
    p_profile jsonb default '{}'::jsonb,
    p_stale_after_seconds integer default 600,
    p_resume_after_seconds integer default 45
)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog
as $$
declare
    row public.geometry_builds%rowtype;
    ttl integer;
    resume_after integer;
    stale boolean := false;
    resume_ready boolean := false;
begin
    if p_digest is null or pg_catalog.length(p_digest) <> 64 then
        raise exception 'invalid geometry digest';
    end if;
    if p_owner_id is null or pg_catalog.length(pg_catalog.btrim(p_owner_id)) = 0 then
        raise exception 'invalid owner';
    end if;

    ttl := GREATEST(COALESCE(p_stale_after_seconds, 600), 60);
    resume_after := GREATEST(COALESCE(p_resume_after_seconds, 45), 5);

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('drafty.geometry_build'),
        pg_catalog.hashtext(p_digest)
    );

    select * into row from public.geometry_builds where digest = p_digest;

    if found then
        stale := row.updated_at < pg_catalog.now() - pg_catalog.make_interval(secs => ttl);
        resume_ready := row.updated_at < pg_catalog.now() - pg_catalog.make_interval(secs => resume_after);

        if row.status = 'completed' then
            return pg_catalog.jsonb_build_object(
                'claimed', false,
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
        end if;

        -- Active attempt with a Modal call: another worker owns it (unless stale).
        if row.status in ('queued', 'running') and row.modal_call_id is not null and not stale then
            return pg_catalog.jsonb_build_object(
                'claimed', false,
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
        end if;

        -- Crash window: charged/queued but call id never attached.
        -- Fresh rows wait for the starter; only resume after resume_after seconds.
        if row.status = 'queued' and row.modal_call_id is null and not stale then
            if not resume_ready then
                return pg_catalog.jsonb_build_object(
                    'claimed', false,
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
            end if;
            update public.geometry_builds
               set owner_id = p_owner_id,
                   profile = COALESCE(p_profile, row.profile, '{}'::jsonb),
                   error = null,
                   updated_at = pg_catalog.now()
             where digest = p_digest
         returning * into row;
            return pg_catalog.jsonb_build_object(
                'claimed', true,
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
        end if;

        -- Failed or stale: open a new attempt (caller may charge again).
        update public.geometry_builds
           set owner_id = p_owner_id,
               status = 'queued',
               modal_call_id = null,
               profile = COALESCE(p_profile, '{}'::jsonb),
               error = null,
               charged = false,
               updated_at = pg_catalog.now()
         where digest = p_digest
     returning * into row;
        return pg_catalog.jsonb_build_object(
            'claimed', true,
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
    end if;

    insert into public.geometry_builds (
        digest, owner_id, status, modal_call_id, profile, error, charged, updated_at
    ) values (
        p_digest, p_owner_id, 'queued', null, COALESCE(p_profile, '{}'::jsonb), null, false, pg_catalog.now()
    ) returning * into row;

    return pg_catalog.jsonb_build_object(
        'claimed', true,
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

create or replace function public.mark_geometry_build_charged(p_digest text)
returns boolean
language plpgsql
security definer
set search_path to pg_catalog
as $$
declare
    updated text;
begin
    if p_digest is null or pg_catalog.length(p_digest) <> 64 then
        return false;
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('drafty.geometry_build'),
        pg_catalog.hashtext(p_digest)
    );

    update public.geometry_builds
       set charged = true,
           updated_at = pg_catalog.now()
     where digest = p_digest
       and status = 'queued'
    returning digest into updated;

    return updated is not null;
end;
$$;

create or replace function public.attach_geometry_build_call(p_digest text, p_call_id text)
returns boolean
language plpgsql
security definer
set search_path to pg_catalog
as $$
declare
    row public.geometry_builds%rowtype;
begin
    if p_digest is null or pg_catalog.length(p_digest) <> 64 then
        return false;
    end if;
    if p_call_id is null or pg_catalog.length(pg_catalog.btrim(p_call_id)) = 0 then
        return false;
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('drafty.geometry_build'),
        pg_catalog.hashtext(p_digest)
    );

    select * into row from public.geometry_builds where digest = p_digest;
    if not found then
        return false;
    end if;

    if row.modal_call_id is not null then
        return row.modal_call_id = p_call_id and row.status in ('queued', 'running');
    end if;

    if row.status <> 'queued' then
        return false;
    end if;

    update public.geometry_builds
       set status = 'running',
           modal_call_id = p_call_id,
           error = null,
           updated_at = pg_catalog.now()
     where digest = p_digest
       and status = 'queued'
       and modal_call_id is null;

    return found;
end;
$$;

create or replace function public.transition_geometry_build(
    p_digest text,
    p_from_statuses text[],
    p_to_status text,
    p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path to pg_catalog
as $$
declare
    updated text;
begin
    if p_digest is null or pg_catalog.length(p_digest) <> 64 then
        return false;
    end if;
    if p_to_status is null or p_to_status not in ('queued', 'running', 'completed', 'failed') then
        return false;
    end if;
    if p_from_statuses is null or pg_catalog.array_length(p_from_statuses, 1) is null then
        return false;
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('drafty.geometry_build'),
        pg_catalog.hashtext(p_digest)
    );

    update public.geometry_builds
       set status = p_to_status,
           error = case when p_to_status = 'failed' then p_error else null end,
           updated_at = pg_catalog.now()
     where digest = p_digest
       and status = any (p_from_statuses)
    returning digest into updated;

    return updated is not null;
end;
$$;

revoke all on function public.claim_geometry_build_start(text, text, jsonb, integer, integer) from public;
revoke all on function public.claim_geometry_build_start(text, text, jsonb, integer, integer) from anon, authenticated;
revoke all on function public.mark_geometry_build_charged(text) from public;
revoke all on function public.mark_geometry_build_charged(text) from anon, authenticated;
revoke all on function public.attach_geometry_build_call(text, text) from public;
revoke all on function public.attach_geometry_build_call(text, text) from anon, authenticated;
revoke all on function public.transition_geometry_build(text, text[], text, text) from public;
revoke all on function public.transition_geometry_build(text, text[], text, text) from anon, authenticated;

grant execute on function public.claim_geometry_build_start(text, text, jsonb, integer, integer) to service_role;
grant execute on function public.mark_geometry_build_charged(text) to service_role;
grant execute on function public.attach_geometry_build_call(text, text) to service_role;
grant execute on function public.transition_geometry_build(text, text[], text, text) to service_role;
