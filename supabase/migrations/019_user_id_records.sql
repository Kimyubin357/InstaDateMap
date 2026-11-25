-- 019: "누가"를 이름 대신 계정 id로 기록합니다(2026-11-25 사용자 결정: 프로필에서 이름을 바꾸면 앱 어디서나 새 이름).
-- 018 다음에 적용합니다. 여러 번 실행해도 같은 결과이고, 지금 있는 행과 예전 서버 코드도 그대로 동작합니다.
--
-- (1) 이름을 적던 칸 옆에 계정 id 칸을 더합니다(이름 칸은 지우지 않고 "그때의 이름"으로 남깁니다).
--     sources.shared_by → shared_by_user_id, source_places.added_by → added_by_user_id,
--     place_saves.added_by → added_by_user_id, places.memo_updated_by → memo_updated_by_user_id,
--     place_push_events.added_by → added_by_user_id
--     계정이 지워지면(탈퇴) id는 비고(on delete set null) 이름 기록만 남습니다(개인정보 처리방침 3항과 같음).
-- (2) 채우기: 지금 방 멤버(board_members)의 이름과 같은 기록에 그 멤버의 id를 넣습니다. 맞는 멤버가 없으면 비워 둡니다
--     (예전 PIN 이름, 나간 멤버). 개인 삭제 기록(place_trash_log)의 장소 내용에도 같은 방식으로 id를 넣습니다.
-- (3) 쓰기: 이름만 넘기는 함수·예전 서버 코드도 id가 채워지도록, 넣을 때 그 방 멤버의 이름으로 id를 찾아 채웁니다(트리거).
--     id를 알고 있는 함수(저장·메모·담기·복구)는 id를 직접 적습니다.
-- (4) 비교: 삭제 권한(처음 등록한 사람), 알림 받는 사람(저장한 사람 본인 제외)은 id로 비교하고, id가 없는 예전 기록만 이름으로 비교합니다.
-- (5) 보여 주기: 알림 제목·메모 충돌 안내는 지금 멤버 이름을 씁니다(앱 화면은 서버가 id로 지금 이름을 찾아 보냅니다).
-- (6) 이름 바꾸기(dm_set_profile)는 더 이상 지난 기록의 이름을 고쳐 쓰지 않습니다. 멤버 이름(board_members)·멤버 이름 목록
--     (boards.member_names, 014 트리거)·로그인 세션의 이름만 바꾸고, 지난 기록은 id로 지금 이름을 찾아 보여 줍니다.
begin;

-- (1) 계정 id 칸
alter table public.sources add column if not exists shared_by_user_id uuid references public.app_users(id) on delete set null;
alter table public.source_places add column if not exists added_by_user_id uuid references public.app_users(id) on delete set null;
alter table public.place_saves add column if not exists added_by_user_id uuid references public.app_users(id) on delete set null;
alter table public.places add column if not exists memo_updated_by_user_id uuid references public.app_users(id) on delete set null;
alter table public.place_push_events add column if not exists added_by_user_id uuid references public.app_users(id) on delete set null;
create index if not exists sources_shared_by_user on public.sources(shared_by_user_id) where shared_by_user_id is not null;
create index if not exists source_places_added_by_user on public.source_places(added_by_user_id, place_id) where added_by_user_id is not null;
create index if not exists place_saves_added_by_user on public.place_saves(added_by_user_id, place_id) where added_by_user_id is not null;
create index if not exists places_memo_updated_by_user on public.places(memo_updated_by_user_id) where memo_updated_by_user_id is not null;
create index if not exists place_push_events_added_by_user on public.place_push_events(added_by_user_id) where added_by_user_id is not null;

-- 내부 도우미: 이 방에서 이 이름을 쓰는 멤버의 id(없으면 null)
create or replace function public.dm_member_id(p_board uuid, p_name text)
returns uuid language sql stable set search_path = public, pg_temp as $$
  select user_id from board_members where board_id = p_board and member_name = p_name;
$$;

-- 내부 도우미: 보여 줄 이름. 지금 이 방 멤버면 지금 이름, 아니면(나갔거나 탈퇴, 예전 기록) 기록된 이름.
create or replace function public.dm_member_name(p_board uuid, p_user uuid, p_recorded text)
returns text language sql stable set search_path = public, pg_temp as $$
  select coalesce((select member_name from board_members where board_id = p_board and user_id = p_user), p_recorded);
$$;

-- 내부 도우미: 아직 있는 계정 id만(삭제 기록 속 id는 그 사이 탈퇴했을 수 있음). 형식이 틀리면 null.
create or replace function public.dm_live_user(p_id text)
returns uuid language sql stable set search_path = public, pg_temp as $$
  select id from app_users
  where id = case when p_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p_id::uuid end;
$$;

-- (3) 넣을 때 id가 비어 있으면 그 방 멤버의 이름으로 찾아 채웁니다. 이름 칸을 바꾸면서 id를 직접 바꾸지 않았으면 다시 찾습니다.
create or replace function public.dm_fill_actor_id()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare bid uuid;
begin
  if tg_table_name = 'sources' then
    if (tg_op = 'INSERT' and new.shared_by_user_id is null)
       or (tg_op = 'UPDATE' and new.shared_by is distinct from old.shared_by and new.shared_by_user_id is not distinct from old.shared_by_user_id) then
      new.shared_by_user_id := dm_member_id(new.board_id, new.shared_by);
    end if;
  elsif tg_table_name = 'source_places' then
    if (tg_op = 'INSERT' and new.added_by_user_id is null)
       or (tg_op = 'UPDATE' and new.added_by is distinct from old.added_by and new.added_by_user_id is not distinct from old.added_by_user_id) then
      select board_id into bid from sources where id = new.source_id;
      new.added_by_user_id := dm_member_id(bid, new.added_by);
    end if;
  elsif tg_table_name = 'place_saves' then
    if (tg_op = 'INSERT' and new.added_by_user_id is null)
       or (tg_op = 'UPDATE' and new.added_by is distinct from old.added_by and new.added_by_user_id is not distinct from old.added_by_user_id) then
      new.added_by_user_id := dm_member_id(new.board_id, new.added_by);
    end if;
  elsif tg_table_name = 'places' then
    if (tg_op = 'INSERT' and new.memo_updated_by_user_id is null)
       or (tg_op = 'UPDATE' and new.memo_updated_by is distinct from old.memo_updated_by and new.memo_updated_by_user_id is not distinct from old.memo_updated_by_user_id) then
      new.memo_updated_by_user_id := dm_member_id(new.board_id, new.memo_updated_by);
    end if;
  elsif tg_table_name = 'place_push_events' then
    if tg_op = 'INSERT' and new.added_by_user_id is null then
      new.added_by_user_id := dm_member_id(new.board_id, new.added_by);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists datemap_fill_actor_id on public.sources;
create trigger datemap_fill_actor_id before insert or update of shared_by on public.sources
  for each row execute function public.dm_fill_actor_id();
drop trigger if exists datemap_fill_actor_id on public.source_places;
create trigger datemap_fill_actor_id before insert or update of added_by on public.source_places
  for each row execute function public.dm_fill_actor_id();
drop trigger if exists datemap_fill_actor_id on public.place_saves;
create trigger datemap_fill_actor_id before insert or update of added_by on public.place_saves
  for each row execute function public.dm_fill_actor_id();
drop trigger if exists datemap_fill_actor_id on public.places;
create trigger datemap_fill_actor_id before insert or update of memo_updated_by on public.places
  for each row execute function public.dm_fill_actor_id();
drop trigger if exists datemap_fill_actor_id on public.place_push_events;
create trigger datemap_fill_actor_id before insert on public.place_push_events
  for each row execute function public.dm_fill_actor_id();

-- (2) 지금 있는 기록 채우기(이미 채운 행은 건드리지 않음)
update public.place_saves ps set added_by_user_id = m.user_id from public.board_members m
  where ps.added_by_user_id is null and m.board_id = ps.board_id and m.member_name = ps.added_by;
update public.source_places sp set added_by_user_id = m.user_id from public.sources s, public.board_members m
  where sp.added_by_user_id is null and s.id = sp.source_id and m.board_id = s.board_id and m.member_name = sp.added_by;
update public.sources s set shared_by_user_id = m.user_id from public.board_members m
  where s.shared_by_user_id is null and m.board_id = s.board_id and m.member_name = s.shared_by;
update public.places p set memo_updated_by_user_id = m.user_id from public.board_members m
  where p.memo_updated_by_user_id is null and p.memo_updated_by is not null and m.board_id = p.board_id and m.member_name = p.memo_updated_by;
update public.place_push_events e set added_by_user_id = m.user_id from public.board_members m
  where e.added_by_user_id is null and m.board_id = e.board_id and m.member_name = e.added_by;
-- 개인 삭제 기록: 등록한 사람·저장 기록·원본 링크의 이름 옆에 id를 넣습니다(한 번만: registrant_user_id 키가 있으면 건너뜀).
update public.place_trash_log l set place = l.place
  || jsonb_build_object('registrant_user_id',
       (select m.user_id from public.board_members m where m.board_id = l.board_id and m.member_name = l.place->>'registrant'))
  || jsonb_build_object('saves', coalesce((
       select jsonb_agg(x.v || jsonb_build_object('added_by_user_id',
         (select m.user_id from public.board_members m where m.board_id = l.board_id and m.member_name = x.v->>'added_by')) order by x.i)
       from jsonb_array_elements(case when jsonb_typeof(l.place->'saves') = 'array' then l.place->'saves' else '[]'::jsonb end) with ordinality x(v, i)), '[]'::jsonb))
  || jsonb_build_object('sources', coalesce((
       select jsonb_agg(x.v || jsonb_build_object(
         'shared_by_user_id', (select m.user_id from public.board_members m where m.board_id = l.board_id and m.member_name = x.v->>'shared_by'),
         'linked_by_user_id', (select m.user_id from public.board_members m where m.board_id = l.board_id and m.member_name = x.v->>'linked_by')) order by x.i)
       from jsonb_array_elements(case when jsonb_typeof(l.place->'sources') = 'array' then l.place->'sources' else '[]'::jsonb end) with ordinality x(v, i)), '[]'::jsonb))
where not (l.place ? 'registrant_user_id');

-- 처음 등록한 사람(가장 먼저 저장한 기록)의 id와 그때 이름. 017의 dm_place_registrant와 같은 기준.
create or replace function public.dm_place_first_saver(p_place uuid)
returns table(reg_user uuid, reg_name text) language sql stable set search_path = public, pg_temp as $$
  select x.added_by_user_id, x.added_by from (
    select added_by_user_id, added_by, added_at from place_saves where place_id = p_place
    union all select added_by_user_id, added_by, added_at from source_places where place_id = p_place
  ) x order by x.added_at limit 1;
$$;

-- 장소 저장: 006의 정의에서 저장한 사람 id를 함께 적고, 이름이 바뀐 같은 사람의 저장 기록을 겹쳐 만들지 않습니다.
create or replace function public.dm_save_place(
  p_board uuid, p_place jsonb, p_added_by text, p_source uuid default null, p_extraction uuid default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare result uuid; is_new boolean; version integer; uid uuid;
begin
  if p_source is not null and not exists(select 1 from sources where id=p_source and board_id=p_board) then raise exception '이 보드의 링크가 아닙니다.'; end if;
  if p_extraction is not null and not exists(select 1 from extractions where id=p_extraction and source_id=p_source) then raise exception '이 링크의 장소 후보가 아닙니다.'; end if;
  select auth_version into version from boards where id=p_board and p_added_by=any(member_names);
  if not found then raise exception '이 보드의 저장자가 아닙니다.'; end if;
  uid := dm_member_id(p_board, p_added_by);
  insert into places(board_id,kakao_place_id,name,address,lat,lng,category,kakao_url)
  values(p_board,p_place->>'kakao_place_id',p_place->>'name',p_place->>'address',(p_place->>'lat')::double precision,(p_place->>'lng')::double precision,p_place->>'category',p_place->>'kakao_url')
  on conflict(board_id,kakao_place_id) do nothing returning id into result;
  is_new := result is not null;
  if not is_new then
    update places set name=p_place->>'name',address=p_place->>'address',lat=(p_place->>'lat')::double precision,lng=(p_place->>'lng')::double precision,category=p_place->>'category',kakao_url=p_place->>'kakao_url'
    where board_id=p_board and kakao_place_id=p_place->>'kakao_place_id' and deleted_at is null returning id into result;
    if result is null then raise exception '삭제한 장소에 있어요. 설정의 삭제한 장소에서 먼저 복구해 주세요.'; end if;
  end if;
  if uid is null or not exists(select 1 from place_saves where place_id=result and added_by_user_id=uid) then
    insert into place_saves(board_id,place_id,added_by,added_by_user_id) values(p_board,result,p_added_by,uid) on conflict(place_id,added_by) do nothing;
  end if;
  if p_source is not null and (uid is null or not exists(select 1 from source_places where source_id=p_source and place_id=result and added_by_user_id=uid)) then
    insert into source_places(source_id,place_id,extraction_id,added_by,added_by_user_id) values(p_source,result,p_extraction,p_added_by,uid) on conflict do nothing;
  end if;
  if is_new then insert into place_push_events(board_id,place_id,added_by,auth_version,added_by_user_id) values(p_board,result,p_added_by,version,uid); end if;
  return result;
end $$;

-- 메모·상태 수정: 008의 정의에서 메모를 쓴 사람 id를 함께 적고, 충돌 안내에는 지금 이름을 보냅니다.
create or replace function public.dm_patch_place(p_board uuid,p_id uuid,p_who text,p_patch jsonb,p_expected integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r places%rowtype; changed boolean; kind text; version integer; uid uuid;
begin
  select * into r from places where id=p_id and board_id=p_board for update;
  if not found or r.deleted_at is not null then return jsonb_build_object('code','PLACE_NOT_FOUND'); end if;
  if p_patch ? 'memo' and (p_expected is null or p_expected<>r.memo_version) then
    return jsonb_build_object('code','MEMO_CONFLICT','memo',coalesce(r.memo,''),'memo_version',r.memo_version,
      'memo_updated_by',dm_member_name(p_board,r.memo_updated_by_user_id,r.memo_updated_by));
  end if;
  select auth_version into version from boards where id=p_board and p_who=any(member_names);
  if not found then raise exception '이 보드의 사용자가 아닙니다.'; end if;
  uid := dm_member_id(p_board, p_who);
  -- Clearing a memo is saved but does not notify the partner.
  changed := p_patch ? 'memo' and coalesce(r.memo,'') is distinct from coalesce(left(p_patch->>'memo',500),'')
    and coalesce(left(p_patch->>'memo',500),'')<>'';
  kind := case when coalesce(r.memo,'')='' then 'memo_added' else 'memo_updated' end;
  update places set
    status=case when p_patch ? 'status' then p_patch->>'status' else status end,
    memo=case when p_patch ? 'memo' then left(p_patch->>'memo',500) else memo end,
    memo_version=memo_version+case when p_patch ? 'memo' then 1 else 0 end,
    memo_updated_by=case when p_patch ? 'memo' then p_who else memo_updated_by end,
    memo_updated_by_user_id=case when p_patch ? 'memo' then uid else memo_updated_by_user_id end
  where id=p_id returning * into r;
  if changed then
    insert into place_push_events(board_id,place_id,added_by,auth_version,event_kind,memo_version,added_by_user_id)
    values(p_board,p_id,p_who,version,kind,r.memo_version,uid);
  end if;
  return jsonb_build_object('ok',true,'memo_version',r.memo_version,'memo_changed',changed);
end $$;

-- 장소 한 곳을 통째로 기록에 남길 내용: 017의 정의에 이름 옆 id를 더했습니다.
create or replace function public.dm_place_snapshot(p_place uuid)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('name', p.name, 'address', p.address, 'lat', p.lat, 'lng', p.lng, 'category', p.category,
    'kakao_url', p.kakao_url, 'status', p.status, 'memo', p.memo, 'created_at', p.created_at,
    'registrant', f.reg_name, 'registrant_user_id', f.reg_user,
    'saves', coalesce((select jsonb_agg(jsonb_build_object('added_by', added_by, 'added_by_user_id', added_by_user_id, 'added_at', added_at) order by added_at) from place_saves where place_id = p.id), '[]'),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('url', so.url, 'media_type', so.media_type, 'caption', so.caption, 'caption_method', so.caption_method,
      'location_tag', so.location_tag, 'shared_by', so.shared_by, 'shared_by_user_id', so.shared_by_user_id, 'shared_at', so.shared_at,
      'linked_by', sp.added_by, 'linked_by_user_id', sp.added_by_user_id))
      from source_places sp join sources so on so.id = sp.source_id where sp.place_id = p.id), '[]'))
  from places p left join lateral dm_place_first_saver(p.id) f on true where p.id = p_place;
$$;

-- 삭제: 017의 정의에서 처음 등록한 사람을 id로 비교합니다(이름이 바뀌어도 등록한 사람은 지울 수 있고, 다른 멤버는 못 지움).
-- id가 없는 예전 기록만 이름으로 비교합니다. 안내에는 등록한 사람의 지금 이름을 씁니다.
create or replace function public.dm_delete_place(p_user uuid, p_board uuid, p_place uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare me text; reg_user uuid; reg_name text; reg_now text; target public.places; folder text; log_id uuid;
begin
  select member_name into me from board_members where board_id = p_board and user_id = p_user;
  if me is null then raise exception '참여한 방의 장소만 지울 수 있어요.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_board::text, 4));
  select * into target from places where id = p_place and board_id = p_board and deleted_at is null for update;
  if target.id is null then return jsonb_build_object('ok', true, 'already_deleted', true, 'deleted_id', p_place); end if;
  select f.reg_user, f.reg_name into reg_user, reg_name from dm_place_first_saver(p_place) f;
  if reg_user is not null then
    if reg_user <> p_user then
      select member_name into reg_now from board_members where board_id = p_board and user_id = reg_user;
      if reg_now is not null then raise exception '%님이 등록한 장소라 지울 수 없어요.', reg_now; end if;
    end if;
  elsif reg_name is not null and reg_name <> me and exists(select 1 from board_members where board_id = p_board and member_name = reg_name) then
    raise exception '%님이 등록한 장소라 지울 수 없어요.', reg_name;
  end if;
  select name into folder from boards where id = p_board;
  insert into place_trash_log(user_id, board_id, board_name, kakao_place_id, place)
  values (p_user, p_board, folder, target.kakao_place_id, dm_place_snapshot(p_place)) returning id into log_id;
  delete from places where id = p_place;
  return jsonb_build_object('ok', true, 'deleted_id', p_place, 'log_id', log_id);
end $$;

-- 복구: 017의 정의에서 기록 속 id(아직 있는 계정만)를 함께 되돌립니다.
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
      update places set memo = dm_merge_memo(memo, l.place->>'memo'), memo_version = memo_version + 1, memo_updated_by = me, memo_updated_by_user_id = p_user where id = resident.id;
    end if;
    restored := resident.id; merged := true;
  else
    insert into places(board_id, kakao_place_id, name, address, lat, lng, category, kakao_url, status, memo, created_at)
    values (l.board_id, l.kakao_place_id, l.place->>'name', l.place->>'address', (l.place->>'lat')::double precision, (l.place->>'lng')::double precision,
      l.place->>'category', l.place->>'kakao_url', coalesce(l.place->>'status', 'wish'), l.place->>'memo', coalesce((l.place->>'created_at')::timestamptz, now()))
    returning id into restored;
    insert into place_saves(board_id, place_id, added_by, added_by_user_id, added_at)
    select l.board_id, restored, x->>'added_by', dm_live_user(x->>'added_by_user_id'), (x->>'added_at')::timestamptz
    from jsonb_array_elements(coalesce(l.place->'saves', '[]'::jsonb)) x on conflict do nothing;
    if not exists(select 1 from place_saves where place_id = restored) then
      insert into place_saves(board_id, place_id, added_by, added_by_user_id) values (l.board_id, restored, me, p_user);
    end if;
    for s in select * from jsonb_array_elements(coalesce(l.place->'sources', '[]'::jsonb)) loop
      insert into sources(board_id, url, media_type, caption, caption_method, location_tag, shared_by, shared_by_user_id, shared_at, status)
      values (l.board_id, s->>'url', coalesce(s->>'media_type', 'unknown'), s->>'caption', s->>'caption_method', s->>'location_tag',
        coalesce(s->>'shared_by', me), case when s->>'shared_by' is null then p_user else dm_live_user(s->>'shared_by_user_id') end,
        coalesce((s->>'shared_at')::timestamptz, now()), 'done')
      on conflict (board_id, url) do nothing returning id into source_id;
      if source_id is null then select id into source_id from sources where board_id = l.board_id and url = s->>'url'; end if;
      insert into source_places(source_id, place_id, extraction_id, added_by, added_by_user_id)
      values (source_id, restored, null, coalesce(s->>'linked_by', me), case when s->>'linked_by' is null then p_user else dm_live_user(s->>'linked_by_user_id') end)
      on conflict do nothing;
      source_id := null;
    end loop;
  end if;
  delete from place_trash_log where id = p_log;
  return jsonb_build_object('ok', true, 'board_id', l.board_id, 'board_name', l.board_name, 'place_id', restored, 'merged', merged);
end $$;

-- 담기(복사): 017의 정의에서 담는 사람 id와, 원래 방의 공유한 사람·연결한 사람 id를 그대로 옮깁니다
-- (원래 방의 이름으로 대상 방 멤버를 다시 찾지 않습니다. 같은 사람도 방마다 이름이 다를 수 있음).
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
      insert into places(board_id, kakao_place_id, name, address, lat, lng, category, kakao_url, status, memo, memo_version, memo_updated_by, memo_updated_by_user_id)
      values (p_to, src.kakao_place_id, src.name, src.address, src.lat, src.lng, src.category, src.kakao_url, src.status, src.memo,
        0, case when coalesce(btrim(src.memo), '') <> '' then to_name end, case when coalesce(btrim(src.memo), '') <> '' then p_user end)
      returning * into dst;
      insert into place_push_events(board_id, place_id, added_by, auth_version, added_by_user_id) values (p_to, dst.id, to_name, to_version, p_user);
      -- 새로 생긴 장소에만 원본 인스타 연결을 대상 방에 같은 링크로 만들어 잇습니다(공유한 사람 기록은 유지).
      for s in select distinct on (so.url) so.*, sp.added_by as linked_by, sp.added_by_user_id as linked_by_user_id
               from source_places sp join sources so on so.id = sp.source_id where sp.place_id = src.id loop
        insert into sources(board_id, url, media_type, caption, caption_method, location_tag, shared_by, shared_by_user_id, shared_at, status)
        values (p_to, s.url, s.media_type, s.caption, s.caption_method, s.location_tag, s.shared_by, s.shared_by_user_id, s.shared_at, 'done')
        on conflict (board_id, url) do nothing returning id into dst_source;
        if dst_source is null then select id into dst_source from sources where board_id = p_to and url = s.url; end if;
        insert into source_places(source_id, place_id, extraction_id, added_by, added_by_user_id) values (dst_source, dst.id, null, s.linked_by, s.linked_by_user_id) on conflict do nothing;
        dst_source := null;
      end loop;
      created := created + 1;
    else
      -- 박힌 돌 유지: 대상 장소의 상태·원본 링크는 그대로, 메모만 합칩니다.
      if dm_merge_memo(dst.memo, src.memo) is distinct from dst.memo then
        update places set memo = dm_merge_memo(memo, src.memo), memo_version = memo_version + 1, memo_updated_by = to_name, memo_updated_by_user_id = p_user
          where id = dst.id returning * into dst;
      end if;
      merged := merged + 1;
    end if;
    if not exists(select 1 from place_saves where place_id = dst.id and added_by_user_id = p_user) then
      insert into place_saves(board_id, place_id, added_by, added_by_user_id) values (p_to, dst.id, to_name, p_user) on conflict (place_id, added_by) do nothing;
    end if;
    ids := ids || dst.id;
  end loop;
  if coalesce(array_length(ids, 1), 0) = 0 then raise exception '담을 장소를 찾지 못했어요. 목록을 새로 고쳐 주세요.'; end if;
  return jsonb_build_object('to', p_to, 'folder', to_folder, 'created', created, 'merged', merged, 'place_ids', to_jsonb(ids));
end $$;

-- 알림: 017의 정의에서 저장한 사람 본인을 id로 빼고(id 없는 예전 기록만 이름), 제목의 이름은 그 사람의 지금 이름을 씁니다.
-- 돌려주는 칸은 017과 같습니다(added_by = 보여 줄 이름).
create or replace function public.dm_claim_push_deliveries(p_board uuid)
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
  join board_members m on m.board_id=e.board_id and m.user_id=a.user_id
    and (case when e.added_by_user_id is not null then m.user_id<>e.added_by_user_id else m.member_name<>e.added_by end)
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
    join board_members m on m.board_id=b.id and m.user_id=a.user_id
      and (case when e.added_by_user_id is not null then m.user_id<>e.added_by_user_id else m.member_name<>e.added_by end)
    where e.board_id=p_board and e.created_at>now()-interval '1 day'
      and d.state in ('pending','sending') and d.available_at<=now() and d.attempts<3
    order by e.created_at limit 20 for update of d skip locked
  ), claimed as (
    update push_deliveries d set state='sending',attempts=d.attempts+1,lease=gen_random_uuid(),available_at=now()+interval '60 seconds'
    from eligible x where d.event_id=x.event_id and d.subscription_id=x.subscription_id
    returning d.event_id,d.subscription_id,d.lease
  )
  select c.event_id,c.subscription_id,c.lease,s.endpoint,s.p256dh,s.auth,coalesce(actor.member_name,e.added_by),p.id,p.name,e.event_kind,b.id,b.name
  from claimed c join push_subscriptions s on s.id=c.subscription_id
  join place_push_events e on e.id=c.event_id join places p on p.id=e.place_id and p.deleted_at is null
  join boards b on b.id=e.board_id
  left join board_members actor on actor.board_id=e.board_id and actor.user_id=e.added_by_user_id;
end $$;

-- 이름·사진 저장: 014의 정의에서 지난 기록(저장자·메모·링크·알림)의 이름을 고쳐 쓰지 않습니다(id로 지금 이름을 찾음).
-- 방 멤버 이름(→ 멤버 이름 목록, 014 트리거)과 로그인 세션의 이름만 바꿉니다.
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
      raise exception '‘%’ 방에 이미 같은 이름이 있어요. 다른 이름을 써 주세요.', m.folder;
    end if;
    update board_members set member_name = n where board_id = m.board_id and user_id = p_user;
    update access_sessions set member_name = n where board_id = m.board_id and user_id = p_user;
  end loop;
  if p_avatar_mode = 'provider' then
    select profile_avatar into provider_avatar from user_identities where user_id = p_user order by last_login_at desc limit 1;
  end if;
  update app_users set display_name = n, name_confirmed = true,
    avatar_url = case p_avatar_mode when 'keep' then avatar_url when 'provider' then provider_avatar when 'custom' then p_avatar else null end
    where id = p_user;
  return dm_get_profile(p_user);
end $$;

revoke all on function public.dm_member_id(uuid, text), public.dm_member_name(uuid, uuid, text), public.dm_live_user(text),
  public.dm_fill_actor_id(), public.dm_place_first_saver(uuid) from public, anon, authenticated;
revoke all on function public.dm_save_place(uuid, jsonb, text, uuid, uuid), public.dm_patch_place(uuid, uuid, text, jsonb, integer),
  public.dm_place_snapshot(uuid), public.dm_delete_place(uuid, uuid, uuid), public.dm_restore_place(uuid, uuid),
  public.dm_copy_places(uuid, uuid, uuid, uuid[]), public.dm_claim_push_deliveries(uuid), public.dm_set_profile(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.dm_save_place(uuid, jsonb, text, uuid, uuid), public.dm_patch_place(uuid, uuid, text, jsonb, integer),
  public.dm_place_snapshot(uuid), public.dm_delete_place(uuid, uuid, uuid), public.dm_restore_place(uuid, uuid),
  public.dm_copy_places(uuid, uuid, uuid, uuid[]), public.dm_claim_push_deliveries(uuid), public.dm_set_profile(uuid, text, text, text)
  to service_role;

notify pgrst, 'reload schema';
commit;
