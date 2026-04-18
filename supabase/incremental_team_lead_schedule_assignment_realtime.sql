-- Purpose: Ensure desk/team-lead/admin clients receive realtime changes for schedule assignment rows.
-- Impact: Adds public.team_lead_schedule_assignments to the supabase_realtime publication only if missing.
-- Rollback: ALTER PUBLICATION supabase_realtime DROP TABLE public.team_lead_schedule_assignments;

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'team_lead_schedule_assignments'
  ) then
    execute 'alter publication supabase_realtime add table public.team_lead_schedule_assignments';
  end if;
end
$$;
