insert into public.profiles (
  id,
  email,
  login_id,
  name,
  role,
  approved
)
select
  auth_user.id,
  coalesce(auth_user.email, ''),
  nullif(lower(trim(coalesce(auth_user.raw_user_meta_data ->> 'login_id', ''))), ''),
  coalesce(
    nullif(trim(coalesce(auth_user.raw_user_meta_data ->> 'name', '')), ''),
    split_part(coalesce(auth_user.email, ''), '@', 1),
    'User'
  ),
  'member'::public.app_role,
  true
from auth.users as auth_user
left join public.profiles as profile
  on profile.id = auth_user.id
where profile.id is null;
