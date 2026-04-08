begin;

drop policy if exists "home_news_briefings_manage_privileged" on public.home_news_briefings;
create policy "home_news_briefings_manage_admin_only"
on public.home_news_briefings
for all
to authenticated
using (
  public.current_profile_role() = 'admin'
  and public.current_profile_approved() = true
)
with check (
  public.current_profile_role() = 'admin'
  and public.current_profile_approved() = true
);

commit;
