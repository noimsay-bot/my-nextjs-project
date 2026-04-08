begin;

alter table public.home_news_briefings
add column if not exists dislikes_count integer not null default 0 check (dislikes_count >= 0);

create or replace function public.sync_home_news_briefing_dislikes_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_briefing_id uuid;
begin
  target_briefing_id := coalesce(new.briefing_id, old.briefing_id);

  update public.home_news_briefings
  set dislikes_count = (
    select count(*)
    from public.home_news_briefing_dislikes
    where briefing_id = target_briefing_id
  )
  where id = target_briefing_id;

  return coalesce(new, old);
end;
$$;

drop trigger if exists sync_home_news_briefing_dislikes_count_insert on public.home_news_briefing_dislikes;
create trigger sync_home_news_briefing_dislikes_count_insert
after insert on public.home_news_briefing_dislikes
for each row
execute function public.sync_home_news_briefing_dislikes_count();

drop trigger if exists sync_home_news_briefing_dislikes_count_delete on public.home_news_briefing_dislikes;
create trigger sync_home_news_briefing_dislikes_count_delete
after delete on public.home_news_briefing_dislikes
for each row
execute function public.sync_home_news_briefing_dislikes_count();

update public.home_news_briefings briefing
set dislikes_count = dislike_counts.count_value
from (
  select briefing_id, count(*)::integer as count_value
  from public.home_news_briefing_dislikes
  group by briefing_id
) dislike_counts
where briefing.id = dislike_counts.briefing_id;

update public.home_news_briefings
set dislikes_count = 0
where id not in (
  select distinct briefing_id
  from public.home_news_briefing_dislikes
);

commit;
