begin;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('admin', 'team_lead')
      and approved = true
  );
$$;

drop policy if exists "profiles_admin_delete_all" on public.profiles;
create policy "profiles_admin_delete_all"
on public.profiles
for delete
to authenticated
using (public.is_admin());

drop policy if exists "home_news_issue_sets_admin_only" on public.home_news_issue_sets;
drop policy if exists "home_news_issue_sets_manage_privileged" on public.home_news_issue_sets;
create policy "home_news_issue_sets_manage_privileged"
on public.home_news_issue_sets
for all
to authenticated
using (
  public.current_profile_role() in ('team_lead', 'admin')
  and public.current_profile_approved() = true
)
with check (
  public.current_profile_role() in ('team_lead', 'admin')
  and public.current_profile_approved() = true
);

drop policy if exists "home_news_issue_set_items_admin_only" on public.home_news_issue_set_items;
drop policy if exists "home_news_issue_set_items_manage_privileged" on public.home_news_issue_set_items;
create policy "home_news_issue_set_items_manage_privileged"
on public.home_news_issue_set_items
for all
to authenticated
using (
  public.current_profile_role() in ('team_lead', 'admin')
  and public.current_profile_approved() = true
)
with check (
  public.current_profile_role() in ('team_lead', 'admin')
  and public.current_profile_approved() = true
);

commit;
