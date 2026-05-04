-- Purpose: Prevent exposed API roles from calling SECURITY DEFINER helper functions via RPC.
-- Apply in Supabase SQL Editor. Existing RLS policies can still reference these functions by schema-qualified name.

do $$
declare
  target_function regprocedure;
  target_functions regprocedure[] := array[
    to_regprocedure('public.current_profile_approved()'),
    to_regprocedure('public.current_profile_has_review_access()'),
    to_regprocedure('public.current_profile_role()'),
    to_regprocedure('public.find_email_by_login_id(text)'),
    to_regprocedure('public.handle_new_user()'),
    to_regprocedure('public.is_admin()'),
    to_regprocedure('public.repair_current_member_profile()'),
    to_regprocedure('public.sync_home_news_briefing_dislikes_count()'),
    to_regprocedure('public.sync_home_news_briefing_likes_count()')
  ];
begin
  foreach target_function in array target_functions loop
    if target_function is not null then
      execute format(
        'revoke execute on function %s from public, anon, authenticated',
        target_function
      );
    end if;
  end loop;
end;
$$;
