begin;

drop policy if exists "home_news_issue_sets_approved_select_official" on public.home_news_issue_sets;
create policy "home_news_issue_sets_approved_select_official"
on public.home_news_issue_sets
for select
to authenticated
using (
  public.current_profile_approved() = true
  and status in ('published', 'locked')
);

drop policy if exists "home_news_issue_set_items_approved_select_official" on public.home_news_issue_set_items;
create policy "home_news_issue_set_items_approved_select_official"
on public.home_news_issue_set_items
for select
to authenticated
using (
  public.current_profile_approved() = true
  and exists (
    select 1
    from public.home_news_issue_sets issue_set
    where issue_set.id = home_news_issue_set_items.issue_set_id
      and issue_set.status in ('published', 'locked')
  )
);

commit;
