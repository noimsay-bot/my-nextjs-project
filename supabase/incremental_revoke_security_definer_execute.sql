-- Purpose: Prevent anonymous RPC access to SECURITY DEFINER helper functions.
-- RLS policies call several helper functions as authenticated users, so those
-- functions must keep EXECUTE for authenticated or data reads will be denied.

do $$
declare
  target_function regprocedure;
  exposed_functions regprocedure[] := array[
    to_regprocedure('public.current_profile_approved()'),
    to_regprocedure('public.current_profile_has_review_access()'),
    to_regprocedure('public.current_profile_role()'),
    to_regprocedure('public.is_admin()'),
    to_regprocedure('public.find_email_by_login_id(text)'),
    to_regprocedure('public.handle_new_user()'),
    to_regprocedure('public.repair_current_member_profile()'),
    to_regprocedure('public.sync_home_news_briefing_dislikes_count()'),
    to_regprocedure('public.sync_home_news_briefing_likes_count()')
  ];
  direct_only_functions regprocedure[] := array[
    to_regprocedure('public.find_email_by_login_id(text)'),
    to_regprocedure('public.handle_new_user()'),
    to_regprocedure('public.repair_current_member_profile()'),
    to_regprocedure('public.sync_home_news_briefing_dislikes_count()'),
    to_regprocedure('public.sync_home_news_briefing_likes_count()')
  ];
begin
  foreach target_function in array exposed_functions loop
    if target_function is not null then
      execute format(
        'revoke execute on function %s from public, anon',
        target_function
      );
    end if;
  end loop;

  foreach target_function in array direct_only_functions loop
    if target_function is not null then
      execute format(
        'revoke execute on function %s from authenticated',
        target_function
      );
    end if;
  end loop;
end;
$$;

grant execute on function public.current_profile_approved() to authenticated;
grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.current_profile_has_review_access() to authenticated;
grant execute on function public.is_admin() to authenticated;
