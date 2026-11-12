-- DESK > 모바일 라이브: 목록에 표시할 조회수(수집 시점 값).
-- incremental_youtube_lives.sql 적용 후 실행한다.
-- 조회수가 비공개이거나 아직 다시 수집되지 않은 행은 null이다.

alter table public.youtube_lives
add column if not exists view_count bigint;

notify pgrst, 'reload schema';
