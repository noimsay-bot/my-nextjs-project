-- Purpose: Ensure realtime subscribers receive schedule input lock changes.
-- Impact: Adds public.team_lead_schedule_assignment_schedule_input_locks to the supabase_realtime publication only if missing.
-- Rollback: ALTER PUBLICATION supabase_realtime DROP TABLE public.team_lead_schedule_assignment_schedule_input_locks;

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
      and tablename = 'team_lead_schedule_assignment_schedule_input_locks'
  ) then
    execute 'alter publication supabase_realtime add table public.team_lead_schedule_assignment_schedule_input_locks';
  end if;
end
$$;
