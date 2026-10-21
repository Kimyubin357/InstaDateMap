begin;
alter table public.boards add column if not exists pin_hash text;
alter table public.boards add column if not exists member_names text[] not null default '{}';
alter table public.boards add column if not exists auth_version integer not null default 0;
create table if not exists public.access_sessions (
  token_hash text primary key, board_id uuid not null references public.boards(id) on delete cascade,
  purpose text not null check (purpose in ('setup', 'member')), member_name text,
  auth_version integer not null, remember boolean not null default false,
  expires_at timestamptz not null, created_at timestamptz not null default now()
);
create index if not exists access_sessions_board on public.access_sessions(board_id);
create index if not exists access_sessions_expiry on public.access_sessions(expires_at);
create table if not exists public.access_limits (
  board_id uuid not null references public.boards(id) on delete cascade, bucket text not null,
  attempts integer not null default 0, window_start timestamptz not null default now(), blocked_until timestamptz,
  primary key (board_id, bucket)
);
create table if not exists public.place_saves (
  board_id uuid not null references public.boards(id) on delete cascade,
  place_id uuid not null references public.places(id) on delete cascade,
  added_by text not null, added_at timestamptz not null default now(), primary key (place_id, added_by)
);
create index if not exists place_saves_board on public.place_saves(board_id);
insert into public.place_saves(board_id, place_id, added_by, added_at)
select p.board_id, sp.place_id, sp.added_by, min(sp.added_at)
from public.source_places sp join public.places p on p.id = sp.place_id
group by p.board_id, sp.place_id, sp.added_by on conflict (place_id, added_by) do nothing;
alter table public.access_sessions enable row level security;
alter table public.access_limits enable row level security;
alter table public.place_saves enable row level security;
revoke all on public.access_sessions, public.access_limits, public.place_saves from anon, authenticated;
grant all on public.access_sessions, public.access_limits, public.place_saves to service_role;

-- Reserve before hashing: parallel requests cannot bypass the limits.
create or replace function public.dm_reserve_attempt(p_board uuid, p_ip text)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare k text; lim integer; row public.access_limits; wait_seconds integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_board::text, 1));
  foreach k in array array['board', 'ip:' || p_ip] loop
    insert into access_limits(board_id, bucket) values(p_board, k) on conflict do nothing;
    select * into row from access_limits where board_id = p_board and bucket = k;
    if row.blocked_until > now() then
      wait_seconds := greatest(wait_seconds, ceil(extract(epoch from row.blocked_until - now()))::integer);
    elsif row.window_start <= now() - interval '15 minutes' or row.blocked_until is not null then
      update access_limits set attempts = 0, window_start = now(), blocked_until = null where board_id = p_board and bucket = k;
    end if;
  end loop;
  if wait_seconds > 0 then return wait_seconds; end if;
  foreach k in array array['board', 'ip:' || p_ip] loop
    lim := case when k = 'board' then 30 else 5 end;
    update access_limits set attempts = attempts + 1,
      blocked_until = case when attempts + 1 >= lim then now() + interval '15 minutes' else null end
    where board_id = p_board and bucket = k;
  end loop;
  return 0;
end $$;
create or replace function public.dm_clear_attempt(p_board uuid, p_ip text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_board::text, 1));
  delete from access_limits where board_id = p_board and bucket = 'ip:' || p_ip;
  update access_limits set attempts = greatest(0, attempts - 1), blocked_until = null where board_id = p_board and bucket = 'board';
end $$;
create or replace function public.dm_configure_access(
  p_board uuid, p_session text, p_expected_hash text, p_pin_hash text,
  p_names text[], p_new_session text, p_expires timestamptz, p_remember boolean
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.boards; s public.access_sessions;
begin
  select * into b from boards where id = p_board for update;
  select * into s from access_sessions where token_hash = p_session and board_id = p_board;
  if b.id is null or s.token_hash is null or s.expires_at <= now() or s.auth_version <> b.auth_version then raise exception '입장 상태가 만료되었어요.'; end if;
  if p_expected_hash is null then
    if b.pin_hash is not null or s.purpose <> 'setup' then raise exception '이미 PIN이 설정되어 있어요.'; end if;
    if cardinality(p_names) <> 2 or p_names[1] = p_names[2] or
      coalesce(length(trim(p_names[1])), 0) not between 1 and 20 or
      coalesce(length(trim(p_names[2])), 0) not between 1 and 20 then raise exception '서로 다른 두 이름을 입력해 주세요.'; end if;
  else
    if s.purpose <> 'member' or b.pin_hash is distinct from p_expected_hash then raise exception 'PIN이 변경되었어요. 다시 열어 주세요.'; end if;
    p_names := b.member_names;
  end if;
  update boards set pin_hash = p_pin_hash, member_names = p_names, auth_version = auth_version + 1,
    token = replace(gen_random_uuid()::text, '-', '') where id = p_board;
  delete from access_sessions where board_id = p_board;
  insert into access_sessions(token_hash, board_id, purpose, member_name, auth_version, remember, expires_at)
  values(p_new_session, p_board, 'member', case when s.purpose = 'member' then s.member_name else null end, b.auth_version + 1, p_remember, p_expires);
  delete from access_limits where board_id = p_board;
end $$;
create or replace function public.dm_reset_pin(p_board uuid, p_pin_hash text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update boards set pin_hash = p_pin_hash, auth_version = auth_version + 1, token = replace(gen_random_uuid()::text, '-', '') where id = p_board;
  if not found then raise exception '보드를 찾을 수 없습니다.'; end if;
  delete from access_sessions where board_id = p_board;
  delete from access_limits where board_id = p_board;
end $$;
create or replace function public.dm_save_place(
  p_board uuid, p_place jsonb, p_added_by text, p_source uuid default null, p_extraction uuid default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare result uuid;
begin
  if p_source is not null and not exists(select 1 from sources where id = p_source and board_id = p_board) then raise exception '이 보드의 링크가 아닙니다.'; end if;
  if p_extraction is not null and not exists(select 1 from extractions where id = p_extraction and source_id = p_source) then raise exception '이 링크의 장소 후보가 아닙니다.'; end if;
  insert into places(board_id, kakao_place_id, name, address, lat, lng, category, kakao_url)
  values(p_board, p_place->>'kakao_place_id', p_place->>'name', p_place->>'address',
    (p_place->>'lat')::double precision, (p_place->>'lng')::double precision, p_place->>'category', p_place->>'kakao_url')
  on conflict(board_id, kakao_place_id) do update set name = excluded.name, address = excluded.address,
    lat = excluded.lat, lng = excluded.lng, category = excluded.category, kakao_url = excluded.kakao_url returning id into result;
  insert into place_saves(board_id, place_id, added_by) values(p_board, result, p_added_by) on conflict(place_id, added_by) do nothing;
  if p_source is not null then
    insert into source_places(source_id, place_id, extraction_id, added_by) values(p_source, result, p_extraction, p_added_by) on conflict do nothing;
  end if;
  return result;
end $$;
revoke all on function public.dm_reserve_attempt(uuid,text), public.dm_clear_attempt(uuid,text),
  public.dm_configure_access(uuid,text,text,text,text[],text,timestamptz,boolean), public.dm_reset_pin(uuid,text), public.dm_save_place(uuid,jsonb,text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.dm_reserve_attempt(uuid,text), public.dm_clear_attempt(uuid,text),
  public.dm_configure_access(uuid,text,text,text,text[],text,timestamptz,boolean), public.dm_reset_pin(uuid,text), public.dm_save_place(uuid,jsonb,text,uuid,uuid) to service_role;
notify pgrst, 'reload schema';
commit;
