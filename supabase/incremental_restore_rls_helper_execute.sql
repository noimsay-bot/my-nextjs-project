-- Purpose: Restore authenticated EXECUTE privileges required by RLS policies.
-- Apply this immediately if schedule/home data disappeared after revoking SECURITY DEFINER function execution.

grant execute on function public.current_profile_approved() to authenticated;
grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.current_profile_has_review_access() to authenticated;
grant execute on function public.is_admin() to authenticated;

revoke execute on function public.current_profile_approved() from anon;
revoke execute on function public.current_profile_role() from anon;
revoke execute on function public.current_profile_has_review_access() from anon;
revoke execute on function public.is_admin() from anon;
