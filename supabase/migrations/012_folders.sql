-- 012: 폴더 만들기·수정·삭제(0개 허용), 폴더 전환, 초대 링크, 방장 권한.
-- 폴더 = 기존 보드. 방장(owner)만 이름·표지 수정, 초대, 내보내기, 삭제를 합니다.
begin;

alter table public.boards add column if not exists color text not null default 'red';
alter table public.boards add column if not exists icon text not null default 'heart';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'boards_color_check') then
    alter table public.boards add constraint boards_color_check check (color in ('red', 'forest', 'gold', 'blue'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'boards_icon_check') then
    alter table public.boards add constraint boards_icon_check check (icon in ('heart', 'map', 'cup', 'food', 'tree', 'culture'));
  end if;
end $$;

-- 폴더가 0개인 계정도 로그인 상태를 유지합니다(폴더 없는 세션).
alter table public.access_sessions alter column board_id drop not null;

-- 초대 링크: 원문 토큰은 링크에만 있고 DB에는 해시만 남깁니다. 7일 뒤 만료, 방장이 모두 끊을 수 있습니다.
create table if not exists public.folder_invites (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists folder_invites_board on public.folder_invites(board_id);
alter table public.folder_invites enable row level security;
revoke all on public.folder_invites from anon, authenticated;
grant all on public.folder_invites to service_role;

-- 내부 도우미: 폴더 이름 정리와 검사
create or replace function public.dm_folder_name(p_name text)
returns text language plpgsql immutable set search_path = public, pg_temp as $$
declare n text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if length(n) not between 1 and 30 then raise exception '폴더 이름을 1~30자로 입력해 주세요.'; end if;
  return n;
end $$;

-- 내부 도우미: 이 폴더 안에서 겹치지 않는 표시 이름(기존 PIN 이름 포함)
create or replace function public.dm_unique_member_name(p_board uuid, p_name text)
returns text language plpgsql set search_path = public, pg_temp as $$
declare base text := left(coalesce(nullif(btrim(p_name), ''), '나'), 17); candidate text := base; n integer := 1;
begin
  while exists(select 1 from board_members where board_id = p_board and member_name = candidate)
     or exists(select 1 from boards where id = p_board and candidate = any(member_names)) loop
    n := n + 1; candidate := base || ' ' || n;
  end loop;
  return candidate;
end $$;

-- 내부 도우미: 이 계정이 다음에 열 폴더(제외할 폴더 빼고, 가장 먼저 참여한 곳). 없으면 null.
create or replace function public.dm_fallback_folder(p_user uuid, p_exclude uuid)
returns uuid language sql stable set search_path = public, pg_temp as $$
  select board_id from board_members where user_id = p_user and board_id is distinct from p_exclude order by joined_at limit 1;
$$;

-- 내부 도우미: 한 계정의 한 폴더 세션들을 다른 폴더로 옮기거나, 갈 폴더가 없으면 "폴더 없음" 상태로 둡니다.
create or replace function public.dm_move_sessions(p_user uuid, p_from uuid)
returns void language plpgsql set search_path = public, pg_temp as $$
declare target uuid := dm_fallback_folder(p_user, p_from); m public.board_members; v integer;
begin
  if target is null then
    update access_sessions set board_id = null, member_name = null, auth_version = 0 where user_id = p_user and board_id = p_from;
  else
    select * into m from board_members where board_id = target and user_id = p_user;
    select auth_version into v from boards where id = target;
    update access_sessions set board_id = target, member_name = m.member_name, auth_version = v where user_id = p_user and board_id = p_from;
  end if;
  -- 이 폴더 알림은 더 이상 받지 않습니다.
  delete from push_subscriptions where board_id = p_from and session_hash in (select token_hash from access_sessions where user_id = p_user);
  update app_users set last_board_id = target where id = p_user and last_board_id = p_from;
end $$;

-- 첫 로그인만 "내 장소"를 만듭니다. 폴더를 모두 지운 계정은 폴더 없이 로그인합니다.
create or replace function public.dm_login(p_provider text, p_subject text, p_email text, p_name text, p_avatar text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid; bid uuid; mname text; version integer; created boolean := false; display text;
begin
  if p_provider not in ('kakao', 'google') or coalesce(length(p_subject), 0) not between 1 and 255 then
    raise exception '로그인 정보를 확인하지 못했어요.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_provider || ':' || p_subject, 11));
  display := left(coalesce(nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), ''), '나'), 20);
  if p_avatar is not null and p_avatar !~ '^https://' then p_avatar := null; end if;
  select user_id into uid from user_identities where provider = p_provider and subject = p_subject;
  if uid is null then
    insert into app_users(display_name, avatar_url) values (display, p_avatar) returning id into uid;
    insert into user_identities(provider, subject, user_id, email) values (p_provider, p_subject, uid, nullif(p_email, ''));
    insert into boards(name, owner_id, is_personal, member_names) values ('내 장소', uid, true, array[display]) returning id into bid;
    insert into board_members(board_id, user_id, role, member_name) values (bid, uid, 'owner', display);
    created := true;
  else
    update user_identities set last_login_at = now(), email = coalesce(nullif(p_email, ''), email)
      where provider = p_provider and subject = p_subject;
  end if;
  select m.board_id into bid from board_members m join app_users u on u.id = m.user_id
    where m.user_id = uid order by (m.board_id = u.last_board_id) desc nulls last, m.joined_at limit 1;
  update app_users set last_board_id = bid where id = uid;
  if bid is not null then
    select m.member_name, b.auth_version into mname, version from board_members m join boards b on b.id = m.board_id
      where m.board_id = bid and m.user_id = uid;
  end if;
  return jsonb_build_object('user_id', uid, 'board_id', bid, 'member_name', mname, 'auth_version', coalesce(version, 0), 'created', created);
end $$;

-- 내 폴더 목록: 이름·표지·역할·멤버 수·장소 수
create or replace function public.dm_list_folders(p_user uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'name', b.name, 'color', b.color, 'icon', b.icon, 'role', m.role, 'member_name', m.member_name,
    'member_count', (select count(*) from board_members x where x.board_id = b.id),
    'member_limit', b.member_limit,
    'place_count', (select count(*) from places p where p.board_id = b.id and p.deleted_at is null)
  ) order by m.joined_at), '[]'::jsonb)
  from board_members m join boards b on b.id = m.board_id where m.user_id = p_user;
$$;

create or replace function public.dm_create_folder(p_user uuid, p_name text, p_color text, p_icon text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare n text := dm_folder_name(p_name); bid uuid; display text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 12));
  select display_name into display from app_users where id = p_user;
  if display is null then raise exception '계정을 찾을 수 없어요. 다시 로그인해 주세요.'; end if;
  if (select count(*) from board_members where user_id = p_user) >= 30 then raise exception '폴더는 30개까지 만들 수 있어요.'; end if;
  insert into boards(name, owner_id, is_personal, color, icon) values (n, p_user, false, p_color, p_icon) returning id into bid;
  insert into board_members(board_id, user_id, role, member_name) values (bid, p_user, 'owner', display);
  return jsonb_build_object('board_id', bid);
end $$;

create or replace function public.dm_update_folder(p_user uuid, p_board uuid, p_name text, p_color text, p_icon text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare n text := dm_folder_name(p_name);
begin
  if not exists(select 1 from board_members where board_id = p_board and user_id = p_user and role = 'owner') then
    raise exception '폴더를 만든 사람만 바꿀 수 있어요.';
  end if;
  update boards set name = n, color = p_color, icon = p_icon where id = p_board;
end $$;

-- 폴더 삭제: 방장만. 장소·메모·모음이 모든 멤버에게서 사라집니다. 멤버들의 열린 세션은 각자의 다른 폴더로 옮깁니다.
create or replace function public.dm_delete_folder(p_user uuid, p_board uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare member uuid;
begin
  perform 1 from boards where id = p_board for update;
  if not exists(select 1 from board_members where board_id = p_board and user_id = p_user and role = 'owner') then
    raise exception '폴더를 만든 사람만 삭제할 수 있어요.';
  end if;
  for member in select user_id from board_members where board_id = p_board loop
    perform dm_move_sessions(member, p_board);
  end loop;
  delete from boards where id = p_board;
end $$;

-- 내보내기(방장) / 나가기(본인). 방장이 나가면 가장 먼저 참여한 멤버가 방장이 됩니다.
create or replace function public.dm_remove_member(p_actor uuid, p_board uuid, p_member uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare actor_role text; target_role text; heir uuid;
begin
  perform 1 from boards where id = p_board for update;
  select role into actor_role from board_members where board_id = p_board and user_id = p_actor;
  select role into target_role from board_members where board_id = p_board and user_id = p_member;
  if actor_role is null or target_role is null then raise exception '이 폴더의 멤버가 아니에요.'; end if;
  if p_actor <> p_member and actor_role <> 'owner' then raise exception '폴더를 만든 사람만 내보낼 수 있어요.'; end if;
  if target_role = 'owner' then
    select user_id into heir from board_members where board_id = p_board and user_id <> p_member order by joined_at limit 1;
    if heir is null then raise exception '혼자 있는 폴더는 나가는 대신 삭제해 주세요.'; end if;
    update board_members set role = 'owner' where board_id = p_board and user_id = heir;
    update boards set owner_id = heir where id = p_board;
  end if;
  delete from board_members where board_id = p_board and user_id = p_member;
  perform dm_move_sessions(p_member, p_board);
end $$;

-- 방장 넘기기
create or replace function public.dm_transfer_owner(p_actor uuid, p_board uuid, p_member uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from boards where id = p_board for update;
  if not exists(select 1 from board_members where board_id = p_board and user_id = p_actor and role = 'owner') then
    raise exception '폴더를 만든 사람만 넘길 수 있어요.';
  end if;
  if p_actor = p_member or not exists(select 1 from board_members where board_id = p_board and user_id = p_member) then
    raise exception '이 폴더의 다른 멤버를 골라 주세요.';
  end if;
  update board_members set role = 'member' where board_id = p_board and user_id = p_actor;
  update board_members set role = 'owner' where board_id = p_board and user_id = p_member;
  update boards set owner_id = p_member where id = p_board;
end $$;

-- 초대 링크 만들기(방장). 여러 개가 함께 유효하며 7일 뒤 만료됩니다.
create or replace function public.dm_create_invite(p_actor uuid, p_board uuid, p_token_hash text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare expires timestamptz := now() + interval '7 days';
begin
  if not exists(select 1 from board_members where board_id = p_board and user_id = p_actor and role = 'owner') then
    raise exception '폴더를 만든 사람만 초대할 수 있어요.';
  end if;
  if (select count(*) from board_members where board_id = p_board) >= (select member_limit from boards where id = p_board) then
    raise exception '이 폴더는 인원이 가득 찼어요.';
  end if;
  delete from folder_invites where board_id = p_board and (expires_at < now() - interval '30 days');
  insert into folder_invites(board_id, token_hash, created_by, expires_at) values (p_board, p_token_hash, p_actor, expires);
  return jsonb_build_object('expires_at', expires);
end $$;

create or replace function public.dm_revoke_invites(p_actor uuid, p_board uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  if not exists(select 1 from board_members where board_id = p_board and user_id = p_actor and role = 'owner') then
    raise exception '폴더를 만든 사람만 초대 링크를 끊을 수 있어요.';
  end if;
  update folder_invites set revoked_at = now() where board_id = p_board and revoked_at is null and expires_at > now();
  get diagnostics n = row_count;
  return n;
end $$;

-- 초대 미리보기: 링크가 유효하면 폴더 이름·방장·인원, 아니면 사유 코드
create or replace function public.dm_invite_preview(p_token_hash text, p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare i public.folder_invites; b public.boards; owner_name text; members integer;
begin
  select * into i from folder_invites where token_hash = p_token_hash;
  if i.id is null or i.revoked_at is not null or i.expires_at <= now() then return jsonb_build_object('code', 'INVITE_INVALID'); end if;
  select * into b from boards where id = i.board_id;
  select member_name into owner_name from board_members where board_id = b.id and role = 'owner';
  select count(*) into members from board_members where board_id = b.id;
  return jsonb_build_object('code', case
      when p_user is not null and exists(select 1 from board_members where board_id = b.id and user_id = p_user) then 'ALREADY_MEMBER'
      when members >= b.member_limit then 'FOLDER_FULL' else 'OK' end,
    'board_id', b.id, 'name', b.name, 'color', b.color, 'icon', b.icon, 'owner', owner_name,
    'member_count', members, 'member_limit', b.member_limit, 'expires_at', i.expires_at);
end $$;

-- 초대 수락: 이름이 겹치면 "이름 2"처럼 구분합니다. 이미 멤버면 그대로 둡니다.
create or replace function public.dm_accept_invite(p_user uuid, p_token_hash text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare i public.folder_invites; display text; mname text;
begin
  select * into i from folder_invites where token_hash = p_token_hash for update;
  if i.id is null or i.revoked_at is not null or i.expires_at <= now() then raise exception '초대 링크가 만료됐어요. 새 링크를 받아 주세요.'; end if;
  perform 1 from boards where id = i.board_id for update;
  select member_name into mname from board_members where board_id = i.board_id and user_id = p_user;
  if mname is null then
    select display_name into display from app_users where id = p_user;
    if display is null then raise exception '계정을 찾을 수 없어요. 다시 로그인해 주세요.'; end if;
    if (select count(*) from board_members where user_id = p_user) >= 30 then raise exception '폴더는 30개까지 참여할 수 있어요.'; end if;
    mname := dm_unique_member_name(i.board_id, display);
    insert into board_members(board_id, user_id, role, member_name) values (i.board_id, p_user, 'member', mname);
  end if;
  return jsonb_build_object('board_id', i.board_id);
end $$;

-- 폴더 전환: 이 기기의 세션과 알림 구독을 그 폴더로 옮깁니다.
create or replace function public.dm_switch_folder(p_user uuid, p_session text, p_board uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare m public.board_members; v integer; previous uuid;
begin
  select * into m from board_members where board_id = p_board and user_id = p_user;
  if m.user_id is null then raise exception '참여한 폴더만 열 수 있어요.'; end if;
  select board_id into previous from access_sessions where token_hash = p_session and user_id = p_user and purpose = 'member' for update;
  if not found then raise exception '로그인이 만료됐어요. 다시 로그인해 주세요.'; end if;
  select auth_version into v from boards where id = p_board;
  update access_sessions set board_id = p_board, member_name = m.member_name, auth_version = v where token_hash = p_session;
  -- 알림 구독은 지금 연 폴더를 따라갑니다.
  if previous is distinct from p_board then
    update push_subscriptions set board_id = p_board where session_hash = p_session;
  end if;
  update app_users set last_board_id = p_board where id = p_user;
  return jsonb_build_object('board_id', p_board, 'member_name', m.member_name, 'auth_version', v);
end $$;

revoke all on function public.dm_folder_name(text), public.dm_unique_member_name(uuid, text), public.dm_fallback_folder(uuid, uuid),
  public.dm_move_sessions(uuid, uuid), public.dm_list_folders(uuid), public.dm_create_folder(uuid, text, text, text),
  public.dm_update_folder(uuid, uuid, text, text, text), public.dm_delete_folder(uuid, uuid), public.dm_remove_member(uuid, uuid, uuid),
  public.dm_transfer_owner(uuid, uuid, uuid), public.dm_create_invite(uuid, uuid, text), public.dm_revoke_invites(uuid, uuid),
  public.dm_invite_preview(text, uuid), public.dm_accept_invite(uuid, text), public.dm_switch_folder(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.dm_list_folders(uuid), public.dm_create_folder(uuid, text, text, text),
  public.dm_update_folder(uuid, uuid, text, text, text), public.dm_delete_folder(uuid, uuid), public.dm_remove_member(uuid, uuid, uuid),
  public.dm_transfer_owner(uuid, uuid, uuid), public.dm_create_invite(uuid, uuid, text), public.dm_revoke_invites(uuid, uuid),
  public.dm_invite_preview(text, uuid), public.dm_accept_invite(uuid, text), public.dm_switch_folder(uuid, text, uuid) to service_role;

notify pgrst, 'reload schema';
commit;
