-- RLS does not grant table privileges. Authenticated users need DML grants;
-- anon stays without them. Policies still limit every row to auth.uid().

grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.designs to authenticated;
grant select, insert on public.revisions to authenticated;
grant select, insert, update, delete on public.jobs to authenticated;
grant select, insert on public.results to authenticated;
grant select, insert on public.artifacts to authenticated;
grant select, insert, update, delete on public.scenarios to authenticated;
grant select, insert on public.scenario_versions to authenticated;
grant select, insert on public.sources to authenticated;
grant select, insert on public.images to authenticated;
grant select, insert on public.reports to authenticated;
