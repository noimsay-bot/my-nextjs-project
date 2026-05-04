-- Purpose: Ensure portal users receive celebration event changes immediately.
-- Impact: Adds public.portal_celebration_events to the supabase_realtime publication only if missing.
-- Rollback: ALTER PUBLICATION supabase_realtime DROP TABLE public.portal_celebration_events;

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
      and tablename = 'portal_celebration_events'
  ) then
    execute 'alter publication supabase_realtime add table public.portal_celebration_events';
  end if;
end
$$;
