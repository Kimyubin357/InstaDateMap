-- 014: (1) 폴더 멤버 이름 목록 동기화 — 새 폴더·초대 멤버의 장소 저장·삭제·모음·알림이 동작하도록
--      (2) 프로필: 가입 때 이름 확인, 이름·사진 수정(카카오·구글 사진 가져오기, 직접 올리기, 사진 없음)
begin;

-- (1) 기존 함수들(장소 저장·삭제·모음·알림)은 boards.member_names로 사용자를 확인합니다.
--     폴더 멤버가 바뀌면 이 목록도 함께 바꿉니다. 계정에 연결되지 않은 예전 PIN 이름은 그대로 둡니다.
create or replace function public.dm_sync_member_names()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    update boards set member_names = array_append(member_names, new.member_name)
      where id = new.board_id and not (new.member_name = any(member_names));
  elsif tg_op = 'UPDATE' and new.member_name <> old.member_name then
    update boards set member_names = case when old.member_name = any(member_names)
      then array_replace(member_names, old.member_name, new.member_name) else array_append(member_names, new.member_name) end
      where id = new.board_id;
  elsif tg_op = 'DELETE' then
    update boards set member_names = array_remove(member_names, old.member_name) where id = old.board_id;
  end if;
  return null;
end $$;
drop trigger if exists board_members_names on public.board_members;
create trigger board_members_names after insert or update of member_name or delete on public.board_members
  for each row execute function public.dm_sync_member_names();
-- 이미 만들어진 폴더도 맞춥니다.
update public.boards b set member_names = b.member_names || coalesce((
  select array_agg(m.member_name order by m.joined_at) from public.board_members m
  where m.board_id = b.id and not (m.member_name = any(b.member_names))), '{}')
where exists(select 1 from public.board_members m where m.board_id = b.id and not (m.member_name = any(b.member_names)));

-- (2) 프로필
alter table public.app_users add column if not exists name_confirmed boolean not null default true;
alter table public.user_identities add column if not exists profile_name text check (profile_name is null or length(profile_name) <= 60);
alter table public.user_identities add column if not exists profile_avatar text check (profile_avatar is null or profile_avatar ~ '^https://');
-- 사진: 카카오·구글 주소(https) 또는 직접 올린 작은 이미지(data URL, 약 150KB 이하)
alter table public.app_users drop constraint if exists app_users_avatar_url_check;
alter table public.app_users add constraint app_users_avatar_url_check check (avatar_url is null or avatar_url ~ '^https://'
  or (avatar_url ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$' and length(avatar_url) <= 200000));

-- 첫 로그인은 이름 확인 전(name_confirmed=false)으로 만들고, 로그인할 때마다 공급자 프로필을 기록합니다.
create or replace function public.dm_login(p_provider text, p_subject text, p_email text, p_name text, p_avatar text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid; bid uuid; mname text; version integer; created boolean := false; display text; confirmed boolean;
begin
  if p_provider not in ('kakao', 'google') or coalesce(length(p_subject), 0) not between 1 and 255 then
    raise exception '로그인 정보를 확인하지 못했어요.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_provider || ':' || p_subject, 11));
  display := left(coalesce(nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), ''), '나'), 20);
  if p_avatar is not null and p_avatar !~ '^https://' then p_avatar := null; end if;
  select user_id into uid from user_identities where provider = p_provider and subject = p_subject;
  if uid is null then
    insert into app_users(display_name, avatar_url, name_confirmed) values (display, p_avatar, false) returning id into uid;
    insert into user_identities(provider, subject, user_id, email, profile_name, profile_avatar)
      values (p_provider, p_subject, uid, nullif(p_email, ''), left(nullif(btrim(p_name), ''), 60), p_avatar);
    insert into boards(name, owner_id, is_personal, member_names) values ('내 장소', uid, true, '{}') returning id into bid;
    insert into board_members(board_id, user_id, role, member_name) values (bid, uid, 'owner', display);
    created := true;
  else
    update user_identities set last_login_at = now(), email = coalesce(nullif(p_email, ''), email),
      profile_name = left(nullif(btrim(p_name), ''), 60), profile_avatar = p_avatar
      where provider = p_provider and subject = p_subject;
  end if;
  select m.board_id into bid from board_members m join app_users u on u.id = m.user_id
    where m.user_id = uid order by (m.board_id = u.last_board_id) desc nulls last, m.joined_at limit 1;
  update app_users set last_board_id = bid where id = uid returning name_confirmed into confirmed;
  if bid is not null then
    select m.member_name, b.auth_version into mname, version from board_members m join boards b on b.id = m.board_id
      where m.board_id = bid and m.user_id = uid;
  end if;
  return jsonb_build_object('user_id', uid, 'board_id', bid, 'member_name', mname, 'auth_version', coalesce(version, 0),
    'created', created, 'name_confirmed', confirmed);
end $$;

-- 내 프로필(공급자 프로필 포함)
create or replace function public.dm_get_profile(p_user uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('name', u.display_name, 'avatar', u.avatar_url, 'name_confirmed', u.name_confirmed,
    'provider', i.provider, 'provider_name', i.profile_name, 'provider_avatar', i.profile_avatar)
  from app_users u left join lateral (select * from user_identities where user_id = u.id order by last_login_at desc limit 1) i on true
  where u.id = p_user;
$$;

-- 이름·사진 저장. 이름이 바뀌면 참여한 모든 폴더의 기록(저장자·메모·링크·알림·세션)도 새 이름으로 바꿉니다.
-- p_avatar_mode: keep(그대로) | provider(카카오·구글 사진) | custom(p_avatar) | none(사진 없음)
create or replace function public.dm_set_profile(p_user uuid, p_name text, p_avatar_mode text, p_avatar text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare n text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')); m record; provider_avatar text;
begin
  if length(n) not between 1 and 20 then raise exception '이름을 1~20자로 입력해 주세요.'; end if;
  if p_avatar_mode not in ('keep', 'provider', 'custom', 'none') then raise exception '사진 설정을 다시 골라 주세요.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 12));
  if not exists(select 1 from app_users where id = p_user) then raise exception '계정을 찾을 수 없어요. 다시 로그인해 주세요.'; end if;
  for m in select bm.board_id, bm.member_name, b.name as folder from board_members bm join boards b on b.id = bm.board_id
           where bm.user_id = p_user and bm.member_name <> n for update of bm loop
    if exists(select 1 from board_members where board_id = m.board_id and member_name = n and user_id <> p_user)
       or exists(select 1 from boards where id = m.board_id and n = any(member_names)) then
      raise exception '‘%’ 폴더에 이미 같은 이름이 있어요. 다른 이름을 써 주세요.', m.folder;
    end if;
    update board_members set member_name = n where board_id = m.board_id and user_id = p_user;
    update places set memo_updated_by = n where board_id = m.board_id and memo_updated_by = m.member_name;
    update places set deleted_by = n where board_id = m.board_id and deleted_by = m.member_name;
    update sources set shared_by = n where board_id = m.board_id and shared_by = m.member_name;
    update source_places sp set added_by = n from sources s where s.id = sp.source_id and s.board_id = m.board_id and sp.added_by = m.member_name;
    update place_saves set added_by = n where board_id = m.board_id and added_by = m.member_name;
    update place_push_events set added_by = n where board_id = m.board_id and added_by = m.member_name;
    update access_sessions set member_name = n where board_id = m.board_id and member_name = m.member_name;
  end loop;
  if p_avatar_mode = 'provider' then
    select profile_avatar into provider_avatar from user_identities where user_id = p_user order by last_login_at desc limit 1;
  end if;
  update app_users set display_name = n, name_confirmed = true,
    avatar_url = case p_avatar_mode when 'keep' then avatar_url when 'provider' then provider_avatar when 'custom' then p_avatar else null end
    where id = p_user;
  return dm_get_profile(p_user);
end $$;

-- 폴더 멤버 목록에 사진을 함께 보여줍니다.
create or replace function public.dm_folder_members(p_board uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'member_name', m.member_name, 'role', m.role, 'avatar', u.avatar_url) order by m.joined_at), '[]'::jsonb)
  from board_members m join app_users u on u.id = m.user_id where m.board_id = p_board;
$$;

revoke all on function public.dm_sync_member_names(), public.dm_login(text, text, text, text, text), public.dm_get_profile(uuid),
  public.dm_set_profile(uuid, text, text, text), public.dm_folder_members(uuid) from public, anon, authenticated;
grant execute on function public.dm_login(text, text, text, text, text), public.dm_get_profile(uuid),
  public.dm_set_profile(uuid, text, text, text), public.dm_folder_members(uuid) to service_role;

notify pgrst, 'reload schema';
commit;
