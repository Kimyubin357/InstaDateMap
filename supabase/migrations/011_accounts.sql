-- 011: 카카오·구글 계정 로그인과 폴더(보드) 멤버.
-- 지금의 보드를 그대로 "폴더"로 사용합니다. 기존 PIN 보드는 계정을 연결할 때까지 그대로 동작합니다.
begin;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (length(btrim(display_name)) between 1 and 20),
  avatar_url text check (avatar_url is null or avatar_url ~ '^https://'),
  last_board_id uuid references public.boards(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.user_identities (
  provider text not null check (provider in ('kakao', 'google')),
  subject text not null check (length(subject) between 1 and 255),
  user_id uuid not null references public.app_users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now(),
  last_login_at timestamptz not null default now(),
  primary key (provider, subject)
);
create index if not exists user_identities_user on public.user_identities(user_id);

alter table public.boards add column if not exists owner_id uuid references public.app_users(id) on delete set null;
alter table public.boards add column if not exists is_personal boolean not null default false;
-- 기술 상한 10명, 운영 기본값 8명.
alter table public.boards add column if not exists member_limit integer not null default 8;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'boards_member_limit_check') then
    alter table public.boards add constraint boards_member_limit_check check (member_limit between 1 and 10);
  end if;
end $$;

-- member_name은 이 폴더 안의 기존 기록(저장자·메모 수정자 등)에 남는 이름입니다.
create table if not exists public.board_members (
  board_id uuid not null references public.boards(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  member_name text not null check (length(btrim(member_name)) between 1 and 20),
  joined_at timestamptz not null default now(),
  primary key (board_id, user_id),
  unique (board_id, member_name)
);
create index if not exists board_members_user on public.board_members(user_id, joined_at);

alter table public.access_sessions add column if not exists user_id uuid references public.app_users(id) on delete cascade;
create index if not exists access_sessions_user on public.access_sessions(user_id);

alter table public.app_users enable row level security;
alter table public.user_identities enable row level security;
alter table public.board_members enable row level security;
revoke all on public.app_users, public.user_identities, public.board_members from anon, authenticated;
grant all on public.app_users, public.user_identities, public.board_members to service_role;

-- 동시에 참여해도 폴더 인원 상한을 넘지 않습니다.
create or replace function public.dm_board_member_limit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare lim integer;
begin
  select member_limit into lim from boards where id = new.board_id for update;
  if lim is null then raise exception '지도를 찾을 수 없어요.'; end if;
  if (select count(*) from board_members where board_id = new.board_id) >= lim then
    raise exception '이 지도는 더 이상 멤버를 받을 수 없어요.';
  end if;
  return new;
end $$;
drop trigger if exists board_members_limit on public.board_members;
create trigger board_members_limit before insert on public.board_members
  for each row execute function public.dm_board_member_limit();

-- 처음 로그인하면 계정과 1인용 "내 장소" 폴더를 함께 만듭니다.
-- 돌려주는 폴더: 마지막으로 연 폴더 → 가장 먼저 참여한 폴더.
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
    created := true;
  else
    update user_identities set last_login_at = now(), email = coalesce(nullif(p_email, ''), email)
      where provider = p_provider and subject = p_subject;
  end if;
  select m.board_id into bid from board_members m join app_users u on u.id = m.user_id
    where m.user_id = uid order by (m.board_id = u.last_board_id) desc nulls last, m.joined_at limit 1;
  -- 폴더 관리(삭제·0개)는 다음 단계입니다. 지금은 폴더가 없으면 "내 장소"를 다시 만듭니다.
  if bid is null then
    select display_name into display from app_users where id = uid;
    insert into boards(name, owner_id, is_personal, member_names) values ('내 장소', uid, true, array[display]) returning id into bid;
    insert into board_members(board_id, user_id, role, member_name) values (bid, uid, 'owner', display);
  end if;
  update app_users set last_board_id = bid where id = uid;
  select m.member_name, b.auth_version into mname, version from board_members m join boards b on b.id = m.board_id
    where m.board_id = bid and m.user_id = uid;
  return jsonb_build_object('user_id', uid, 'board_id', bid, 'member_name', mname, 'auth_version', version, 'created', created);
end $$;

-- 기존 PIN 보드의 이름 하나에 계정을 연결합니다. PIN 확인은 서버에서 먼저 합니다.
create or replace function public.dm_link_member(p_user uuid, p_board uuid, p_name text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.boards; existing public.board_members; taken uuid;
begin
  select * into b from boards where id = p_board for update;
  if b.id is null or b.pin_hash is null then raise exception '연결할 수 있는 지도가 아니에요.'; end if;
  if not (p_name = any(b.member_names)) then raise exception '이 지도의 이름 중에서 골라 주세요.'; end if;
  select * into existing from board_members where board_id = p_board and user_id = p_user;
  if existing.user_id is not null and existing.member_name <> p_name then
    raise exception '이미 %(으)로 이 지도에 연결되어 있어요.', existing.member_name;
  end if;
  select user_id into taken from board_members where board_id = p_board and member_name = p_name;
  if taken is not null and taken <> p_user then raise exception '이 이름은 이미 다른 계정에 연결되어 있어요.'; end if;
  if existing.user_id is null then
    insert into board_members(board_id, user_id, role, member_name)
      values (p_board, p_user, case when b.owner_id is null then 'owner' else 'member' end, p_name);
    if b.owner_id is null then update boards set owner_id = p_user where id = p_board; end if;
  end if;
  update app_users set last_board_id = p_board where id = p_user;
  return jsonb_build_object('board_id', p_board, 'member_name', p_name, 'auth_version', b.auth_version);
end $$;

-- 예약 알림 재시도: 보낼 알림이 남은 폴더만 돌려줍니다.
create or replace function public.dm_push_board_ids()
returns uuid[] language sql security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct e.board_id), '{}') from place_push_events e join push_deliveries d on d.event_id = e.id
  where d.state in ('pending', 'sending', 'failed');
$$;

revoke all on function public.dm_board_member_limit(), public.dm_login(text, text, text, text, text),
  public.dm_link_member(uuid, uuid, text), public.dm_push_board_ids() from public, anon, authenticated;
grant execute on function public.dm_login(text, text, text, text, text),
  public.dm_link_member(uuid, uuid, text), public.dm_push_board_ids() to service_role;

notify pgrst, 'reload schema';
commit;
