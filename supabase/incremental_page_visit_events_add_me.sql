do $$
declare
  constraint_name text;
begin
  select conname
  into constraint_name
  from pg_constraint
  where conrelid = 'public.page_visit_events'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%page_key%'
  limit 1;

  if constraint_name is not null then
    execute format('alter table public.page_visit_events drop constraint %I', constraint_name);
  end if;

  alter table public.page_visit_events
    add constraint page_visit_events_page_key_check
    check (page_key in ('me', 'community', 'work_schedule', 'restaurants'));
end $$;
