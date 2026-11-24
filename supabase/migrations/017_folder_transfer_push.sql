-- 017: 방(폴더) 사이 장소 담기, 개인 삭제 기록(휴지통), 폴더별 알림
-- (1) 담기(복사)만 있고 옮기기는 없습니다(사용자 결정 2026-11-25). 옮기려면 담은 뒤 원래 방에서 지웁니다.
--     같은 가게가 대상 방에 있으면 대상의 장소를 그대로 둡니다("박힌 돌" 유지: 원본 링크·상태는 대상 것).
--     메모는 깃허브처럼 합칩니다(대상이 비었으면 채우고, 다르면 아래에 덧붙임).
-- (2) 삭제: 처음 등록한 사람만 지울 수 있고, 등록한 사람이 방에 없으면 그 방 멤버 누구나 지울 수 있습니다.
--     지우면 방에서 바로 빠지고, 지운 사람만 보는 개인 삭제 기록(place_trash_log)에 통째로 남습니다(방끼리 공유하는 휴지통 없음).
--     복구하면 지웠던 방으로 돌아가며, 그 방에 같은 가게가 다시 등록돼 있으면 그 장소를 유지하고 메모만 합칩니다.
--     같은 가게를 다시 등록하면 예전 삭제와 상관없이 새로 등록됩니다.
-- (3) 알림 구독을 "기기 × 폴더" 단위로 바꿉니다. 폴더를 바꿔도 구독이 따라 움직이지 않고, 폴더마다 켜고 끕니다.
--     받는 사람: 그 폴더의 멤버(계정)이고, 그 기기의 로그인이 살아 있고, 저장한 사람이 아닌 경우.
begin;

-- 메모 합치기(깃허브처럼): 한쪽이 비었으면 다른 쪽, 이미 들어 있는 내용이면 그대로,
-- 들어온 메모가 기존 메모를 포함하면 들어온 쪽, 그 밖의 충돌은 기존 아래에 덧붙임
create or replace function public.dm_merge_memo(p_resident text, p_incoming text)
returns text language sql immutable as $$
  select case when coalesce(btrim(p_resident), '') = '' then p_incoming
    when coalesce(btrim(p_incoming), '') = '' or position(btrim(p_incoming) in p_resident) > 0 then p_resident
    when position(btrim(p_resident) in p_incoming) > 0 then p_incoming
    else p_resident || E'\n\n' || p_incoming end;
$$;

-- 처음 등록한 사람(가장 먼저 저장한 이름)
create or replace function public.dm_place_registrant(p_place uuid)
returns text language sql stable set search_path = public, pg_temp as $$
  select added_by from (
    select added_by, added_at from place_saves where place_id = p_place
    union all select added_by, added_at from source_places where place_id = p_place
  ) x order by added_at limit 1;
$$;

-- (1) 담기(복사)
create or replace function public.dm_copy_places(p_user uuid, p_from uuid, p_to uuid, p_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare to_name text; to_version integer; to_folder text; src public.places; dst public.places;
  created integer := 0; merged integer := 0; s record; dst_source uuid; ids uuid[] := '{}';
begin
  if p_from = p_to then raise exception '다른 방을 골라 주세요.'; end if;
  if coalesce(array_length(p_ids, 1), 0) not between 1 and 100 then raise exception '장소를 1~100곳 골라 주세요.'; end if;
  if not exists(select 1 from board_members where board_id = p_from and user_id = p_user) then raise exception '참여한 방 사이에서만 담을 수 있어요.'; end if;
  select m.member_name, b.auth_version, b.name into to_name, to_version, to_folder
    from board_members m join boards b on b.id = m.board_id where m.board_id = p_to and m.user_id = p_user;
  if to_name is null then raise exception '참여한 방 사이에서만 담을 수 있어요.'; end if;
  perform 1 from boards where id in (p_from, p_to) order by id for update;

  for src in select * from places where board_id = p_from and id = any(p_ids) and deleted_at is null order by created_at loop
    select * into dst from places where board_id = p_to and kakao_place_id = src.kakao_place_id for update;
    if dst.id is null then
      insert into places(board_id, kakao_place_id, name, address, lat, lng, category, kakao_url, status, memo, memo_version, memo_updated_by)
      values (p_to, src.kakao_place_id, src.name, src.address, src.lat, src.lng, src.category, src.kakao_url, src.status, src.memo,
        0, case when coalesce(btrim(src.memo), '') <> '' then to_name end)
      returning * into dst;
      insert into place_push_events(board_id, place_id, added_by, auth_version) values (p_to, dst.id, to_name, to_version);
      -- 새로 생긴 장소에만 원본 인스타 연결을 대상 방에 같은 링크로 만들어 잇습니다(공유한 사람 기록은 유지).
      for s in select distinct on (so.url) so.*, sp.added_by as linked_by from source_places sp join sources so on so.id = sp.source_id where sp.place_id = src.id loop
        insert into sources(board_id, url, media_type, caption, caption_method, location_tag, shared_by, shared_at, status)
        values (p_to, s.url, s.media_type, s.caption, s.caption_method, s.location_tag, s.shared_by, s.shared_at, 'done')
        on conflict (board_id, url) do nothing returning id into dst_source;
        if dst_source is null then select id into dst_source from sources where board_id = p_to and url = s.url; end if;
        insert into source_places(source_id, place_id, extraction_id, added_by) values (dst_source, dst.id, null, s.linked_by) on conflict do nothing;
        dst_source := null;
      end loop;
      created := created + 1;
    else
      -- 박힌 돌 유지: 대상 장소의 상태·원본 링크는 그대로, 메모만 합칩니다.
      if dm_merge_memo(dst.memo, src.memo) is distinct from dst.memo then
        update places set memo = dm_merge_memo(memo, src.memo), memo_version = memo_version + 1, memo_updated_by = to_name where id = dst.id returning * into dst;
      end if;
      merged := merged + 1;
    end if;
    insert into place_saves(board_id, place_id, added_by) values (p_to, dst.id, to_name) on conflict (place_id, added_by) do nothing;
    ids := ids || dst.id;
  end loop;
  if coalesce(array_length(ids, 1), 0) = 0 then raise exception '담을 장소를 찾지 못했어요. 목록을 새로 고쳐 주세요.'; end if;
  return jsonb_build_object('to', p_to, 'folder', to_folder, 'created', created, 'merged', merged, 'place_ids', to_jsonb(ids));
end $$;
revoke all on function public.dm_copy_places(uuid, uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.dm_copy_places(uuid, uuid, uuid, uuid[]) to service_role;

-- (2) 개인 삭제 기록. 지운 사람만 보고, 방이 지워져도 기록은 남습니다(복구는 불가).
create table if not exists public.place_trash_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  board_id uuid references public.boards(id) on delete set null,
  board_name text not null,
  kakao_place_id text not null,
  place jsonb not null,
  deleted_at timestamptz not null default now()
);
create index if not exists place_trash_log_user on public.place_trash_log(user_id, deleted_at desc);
alter table public.place_trash_log enable row level security;
revoke all on public.place_trash_log from anon, authenticated;
grant all on public.place_trash_log to service_role;

-- 장소 한 곳을 통째로 기록에 남길 내용(상태·메모·원본 링크·저장 기록)
create or replace function public.dm_place_snapshot(p_place uuid)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('name', p.name, 'address', p.address, 'lat', p.lat, 'lng', p.lng, 'category', p.category,
    'kakao_url', p.kakao_url, 'status', p.status, 'memo', p.memo, 'created_at', p.created_at,
    'registrant', dm_place_registrant(p.id),
    'saves', coalesce((select jsonb_agg(jsonb_build_object('added_by', added_by, 'added_at', added_at) order by added_at) from place_saves where place_id = p.id), '[]'),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('url', so.url, 'media_type', so.media_type, 'caption', so.caption, 'caption_method', so.caption_method,
      'location_tag', so.location_tag, 'shared_by', so.shared_by, 'shared_at', so.shared_at, 'linked_by', sp.added_by))
      from source_places sp join sources so on so.id = sp.source_id where sp.place_id = p.id), '[]'))
  from places p where p.id = p_place;
$$;

-- 삭제: 처음 등록한 사람만(등록한 사람이 방에 없으면 멤버 누구나). 방에서 바로 빼고 지운 사람의 기록에 남깁니다.
create or replace function public.dm_delete_place(p_user uuid, p_board uuid, p_place uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare me text; registrant text; target public.places; folder text; log_id uuid;
begin
  select member_name into me from board_members where board_id = p_board and user_id = p_user;
  if me is null then raise exception '참여한 방의 장소만 지울 수 있어요.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_board::text, 4));
  select * into target from places where id = p_place and board_id = p_board and deleted_at is null for update;
  if target.id is null then return jsonb_build_object('ok', true, 'already_deleted', true, 'deleted_id', p_place); end if;
  registrant := dm_place_registrant(p_place);
  if registrant is not null and registrant <> me and exists(select 1 from board_members where board_id = p_board and member_name = registrant) then
    raise exception '%님이 등록한 장소라 지울 수 없어요.', registrant;
  end if;
  select name into folder from boards where id = p_board;
  insert into place_trash_log(user_id, board_id, board_name, kakao_place_id, place)
  values (p_user, p_board, folder, target.kakao_place_id, dm_place_snapshot(p_place)) returning id into log_id;
  delete from places where id = p_place;
  return jsonb_build_object('ok', true, 'deleted_id', p_place, 'log_id', log_id);
end $$;

-- 복구: 지웠던 방으로. 같은 가게가 다시 등록돼 있으면 그 장소를 유지하고 메모만 합칩니다.
create or replace function public.dm_restore_place(p_user uuid, p_log uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.place_trash_log; me text; resident public.places; restored uuid; s jsonb; source_id uuid; merged boolean := false;
begin
  select * into l from place_trash_log where id = p_log and user_id = p_user for update;
  if l.id is null then return jsonb_build_object('code', 'LOG_NOT_FOUND'); end if;
  select member_name into me from board_members where board_id = l.board_id and user_id = p_user;
  if l.board_id is null or me is null then raise exception '방이 없어졌거나 나간 방이라 복구할 수 없어요.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(l.board_id::text, 4));
  select * into resident from places where board_id = l.board_id and kakao_place_id = l.kakao_place_id for update;
  if resident.id is not null then
    if dm_merge_memo(resident.memo, l.place->>'memo') is distinct from resident.memo then
      update places set memo = dm_merge_memo(memo, l.place->>'memo'), memo_version = memo_version + 1, memo_updated_by = me where id = resident.id;
    end if;
    restored := resident.id; merged := true;
  else
    insert into places(board_id, kakao_place_id, name, address, lat, lng, category, kakao_url, status, memo, created_at)
    values (l.board_id, l.kakao_place_id, l.place->>'name', l.place->>'address', (l.place->>'lat')::double precision, (l.place->>'lng')::double precision,
      l.place->>'category', l.place->>'kakao_url', coalesce(l.place->>'status', 'wish'), l.place->>'memo', coalesce((l.place->>'created_at')::timestamptz, now()))
    returning id into restored;
    insert into place_saves(board_id, place_id, added_by, added_at)
    select l.board_id, restored, x->>'added_by', (x->>'added_at')::timestamptz from jsonb_array_elements(l.place->'saves') x on conflict do nothing;
    if not exists(select 1 from place_saves where place_id = restored) then insert into place_saves(board_id, place_id, added_by) values (l.board_id, restored, me); end if;
    for s in select * from jsonb_array_elements(l.place->'sources') loop
      insert into sources(board_id, url, media_type, caption, caption_method, location_tag, shared_by, shared_at, status)
      values (l.board_id, s->>'url', coalesce(s->>'media_type', 'unknown'), s->>'caption', s->>'caption_method', s->>'location_tag',
        coalesce(s->>'shared_by', me), coalesce((s->>'shared_at')::timestamptz, now()), 'done')
      on conflict (board_id, url) do nothing returning id into source_id;
      if source_id is null then select id into source_id from sources where board_id = l.board_id and url = s->>'url'; end if;
      insert into source_places(source_id, place_id, extraction_id, added_by) values (source_id, restored, null, coalesce(s->>'linked_by', me)) on conflict do nothing;
      source_id := null;
    end loop;
  end if;
  delete from place_trash_log where id = p_log;
  return jsonb_build_object('ok', true, 'board_id', l.board_id, 'board_name', l.board_name, 'place_id', restored, 'merged', merged);
end $$;

-- 기록에서 지우기(되돌릴 수 없음)
create or replace function public.dm_purge_trash_log(p_user uuid, p_log uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from place_trash_log where id = p_log and user_id = p_user;
  return jsonb_build_object('ok', true, 'purged', found);
end $$;

revoke all on function public.dm_merge_memo(text, text), public.dm_place_registrant(uuid), public.dm_place_snapshot(uuid),
  public.dm_delete_place(uuid, uuid, uuid), public.dm_restore_place(uuid, uuid), public.dm_purge_trash_log(uuid, uuid) from public, anon, authenticated;
grant execute on function public.dm_merge_memo(text, text), public.dm_place_registrant(uuid), public.dm_place_snapshot(uuid),
  public.dm_delete_place(uuid, uuid, uuid), public.dm_restore_place(uuid, uuid), public.dm_purge_trash_log(uuid, uuid) to service_role;

-- 지금 방마다 휴지통에 있던 장소는 지운 사람의 개인 기록으로 옮깁니다(지운 사람을 못 찾으면 방장, 그것도 없으면 그대로 삭제).
insert into public.place_trash_log(user_id, board_id, board_name, kakao_place_id, place, deleted_at)
select coalesce(m.user_id, b.owner_id), p.board_id, b.name, p.kakao_place_id, public.dm_place_snapshot(p.id), p.deleted_at
from public.places p join public.boards b on b.id = p.board_id
left join public.board_members m on m.board_id = p.board_id and m.member_name = p.deleted_by
where p.deleted_at is not null and coalesce(m.user_id, b.owner_id) is not null;
delete from public.places where deleted_at is not null;
-- 방끼리 공유하던 휴지통 함수는 더 쓰지 않습니다.
drop function if exists public.dm_trash_place(uuid, uuid, text, text, timestamptz);

-- (3) 폴더별 알림: 한 기기(endpoint)가 폴더마다 구독 한 줄을 가집니다.
alter table public.push_subscriptions drop constraint if exists push_subscriptions_endpoint_hash_key;
create unique index if not exists push_subscriptions_endpoint_board on public.push_subscriptions(endpoint_hash, board_id);

-- 폴더를 바꿔도 알림 구독은 그대로 둡니다(폴더별로 켜고 끔).
create or replace function public.dm_switch_folder(p_user uuid, p_session text, p_board uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare m public.board_members; v integer;
begin
  select * into m from board_members where board_id = p_board and user_id = p_user;
  if m.user_id is null then raise exception '참여한 폴더만 열 수 있어요.'; end if;
  perform 1 from access_sessions where token_hash = p_session and user_id = p_user and purpose = 'member' for update;
  if not found then raise exception '로그인이 만료됐어요. 다시 로그인해 주세요.'; end if;
  select auth_version into v from boards where id = p_board;
  update access_sessions set board_id = p_board, member_name = m.member_name, auth_version = v where token_hash = p_session;
  update app_users set last_board_id = p_board where id = p_user;
  return jsonb_build_object('board_id', p_board, 'member_name', m.member_name, 'auth_version', v);
end $$;

-- 받는 사람: 폴더 멤버(계정)의 살아 있는 로그인 기기 중 그 폴더 알림을 켠 기기. 저장한 사람 본인은 뺍니다.
-- 결과에 폴더 이름을 넣어 다른 폴더의 알림도 어느 폴더인지 보이게 합니다.
drop function if exists public.dm_claim_push_deliveries(uuid);
create function public.dm_claim_push_deliveries(p_board uuid)
returns table(event_id uuid, subscription_id uuid, lease uuid, endpoint text, p256dh text, auth text, added_by text, place_id uuid, place_name text, event_kind text, folder_id uuid, folder_name text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_board::text, 4));
  delete from place_push_events x where x.board_id=p_board and x.created_at < now()-interval '7 days';
  insert into push_deliveries(event_id,subscription_id)
  select e.id,s.id from place_push_events e
  join boards b on b.id=e.board_id and b.auth_version=e.auth_version
  join push_subscriptions s on s.board_id=e.board_id and s.created_at<=e.created_at
  join access_sessions a on a.token_hash=s.session_hash and a.purpose='member' and a.expires_at>now() and a.user_id is not null
  join board_members m on m.board_id=e.board_id and m.user_id=a.user_id and m.member_name<>e.added_by
  where e.board_id=p_board and e.created_at>now()-interval '1 day'
  on conflict do nothing;
  return query
  with eligible as (
    select d.event_id,d.subscription_id from push_deliveries d
    join place_push_events e on e.id=d.event_id
    join boards b on b.id=e.board_id and b.auth_version=e.auth_version
    join push_subscriptions s on s.id=d.subscription_id and s.board_id=b.id
    join places p on p.id=e.place_id and p.deleted_at is null
    join access_sessions a on a.token_hash=s.session_hash and a.purpose='member' and a.expires_at>now() and a.user_id is not null
    join board_members m on m.board_id=b.id and m.user_id=a.user_id and m.member_name<>e.added_by
    where e.board_id=p_board and e.created_at>now()-interval '1 day'
      and d.state in ('pending','sending') and d.available_at<=now() and d.attempts<3
    order by e.created_at limit 20 for update of d skip locked
  ), claimed as (
    update push_deliveries d set state='sending',attempts=d.attempts+1,lease=gen_random_uuid(),available_at=now()+interval '60 seconds'
    from eligible x where d.event_id=x.event_id and d.subscription_id=x.subscription_id
    returning d.event_id,d.subscription_id,d.lease
  )
  select c.event_id,c.subscription_id,c.lease,s.endpoint,s.p256dh,s.auth,e.added_by,p.id,p.name,e.event_kind,b.id,b.name
  from claimed c join push_subscriptions s on s.id=c.subscription_id
  join place_push_events e on e.id=c.event_id join places p on p.id=e.place_id and p.deleted_at is null
  join boards b on b.id=e.board_id;
end $$;
revoke all on function public.dm_claim_push_deliveries(uuid) from public, anon, authenticated;
grant execute on function public.dm_claim_push_deliveries(uuid) to service_role;

-- 새 폴더를 만들거나 초대로 참여하면, 알림을 켜 둔 그 계정의 기기들은 새 폴더 알림도 켜진 상태로 시작합니다.
create or replace function public.dm_member_push_follow()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into push_subscriptions(endpoint_hash, endpoint, p256dh, auth, board_id, session_hash)
  select distinct on (s.endpoint_hash) s.endpoint_hash, s.endpoint, s.p256dh, s.auth, new.board_id, s.session_hash
  from push_subscriptions s join access_sessions a on a.token_hash = s.session_hash and a.user_id = new.user_id
  order by s.endpoint_hash, s.created_at desc
  on conflict (endpoint_hash, board_id) do nothing;
  return new;
end $$;
drop trigger if exists board_members_push_follow on public.board_members;
create trigger board_members_push_follow after insert on public.board_members for each row execute function public.dm_member_push_follow();

-- 지금 기기들의 구독은 그 기기가 연 폴더 한 곳에만 있습니다. 같은 계정의 다른 폴더에도 켜 줍니다(폴더별로 끌 수 있음).
insert into public.push_subscriptions(endpoint_hash, endpoint, p256dh, auth, board_id, session_hash, created_at)
select s.endpoint_hash, s.endpoint, s.p256dh, s.auth, m.board_id, s.session_hash, s.created_at
from public.push_subscriptions s
join public.access_sessions a on a.token_hash = s.session_hash and a.user_id is not null
join public.board_members m on m.user_id = a.user_id and m.board_id <> s.board_id
on conflict (endpoint_hash, board_id) do nothing;

notify pgrst, 'reload schema';
commit;
