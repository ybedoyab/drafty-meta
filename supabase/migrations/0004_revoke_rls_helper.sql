-- Supabase may install public.rls_auto_enable as a security definer helper.
-- It is not part of the Drafty API. Callers who are not the table owner cannot run it.

do $$
begin
    if exists (
        select 1
        from pg_proc
        join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
        where pg_namespace.nspname = 'public' and pg_proc.proname = 'rls_auto_enable'
    ) then
        revoke all on function public.rls_auto_enable() from public, anon, authenticated;
    end if;
end $$;
