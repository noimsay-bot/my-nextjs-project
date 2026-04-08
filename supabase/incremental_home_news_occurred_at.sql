begin;

alter table public.home_news_briefings
add column if not exists occurred_at timestamptz null;

create index if not exists home_news_briefings_occurred_idx
on public.home_news_briefings (occurred_at desc);

commit;
