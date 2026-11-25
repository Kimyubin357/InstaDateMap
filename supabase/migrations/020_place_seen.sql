-- 020: 새 장소(NEW)를 "본" 기록(2026-11-25 사용자 결정, 시안 design-lab/rooms-view 9·10번).
-- 019 다음에 적용합니다. 여러 번 실행해도 같은 결과입니다.
--
-- NEW 규칙: 처음 등록한 뒤 24시간 동안 NEW. 그 사이에 내가 그 장소를 보면(장소 카드·상세를 열면) 나에게는 바로 사라집니다.
-- "본" 기록은 사람(계정)마다 따로이고, 기기를 바꿔도 같습니다. 24시간이 지난 장소는 어차피 NEW가 아니어서
-- 기록을 오래 둘 필요가 없습니다: 기록할 때 3일 지난 내 기록을 지워 표를 작게 유지합니다.
begin;

create table if not exists public.place_seen (
  user_id uuid not null references public.app_users(id) on delete cascade,
  place_id uuid not null references public.places(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (user_id, place_id)
);
create index if not exists place_seen_recent on public.place_seen(user_id, seen_at desc);
alter table public.place_seen enable row level security;
revoke all on public.place_seen from anon, authenticated;
grant all on public.place_seen to service_role;

-- 본 장소 기록: 내가 멤버인 방의, 아직 NEW일 수 있는(등록 25시간 안) 장소만 적습니다. 다른 방 장소 id는 조용히 건너뜁니다.
create or replace function public.dm_mark_seen(p_user uuid, p_places uuid[])
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer := 0;
begin
  if p_user is null or p_places is null or cardinality(p_places) = 0 then return 0; end if;
  if cardinality(p_places) > 500 then raise exception '한 번에 500곳까지 확인할 수 있어요.'; end if;
  insert into place_seen(user_id, place_id)
  select p_user, p.id from places p
  where p.id = any(p_places) and p.deleted_at is null and p.created_at > now() - interval '25 hours'
    and exists (select 1 from board_members m where m.board_id = p.board_id and m.user_id = p_user)
  on conflict (user_id, place_id) do nothing;
  get diagnostics n = row_count;
  delete from place_seen where user_id = p_user and seen_at < now() - interval '3 days';
  return n;
end $$;

-- 최근에 본 장소 id(이틀 안). NEW가 될 수 있는 장소는 등록 24시간 안이라 그보다 오래된 기록은 필요 없습니다.
create or replace function public.dm_seen_places(p_user uuid)
returns uuid[] language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(place_id order by seen_at desc), '{}'::uuid[])
  from place_seen where user_id = p_user and seen_at > now() - interval '2 days';
$$;

revoke all on function public.dm_mark_seen(uuid, uuid[]), public.dm_seen_places(uuid) from public, anon, authenticated;
grant execute on function public.dm_mark_seen(uuid, uuid[]), public.dm_seen_places(uuid) to service_role;

notify pgrst, 'reload schema';
commit;
