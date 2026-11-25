-- 018: 방은 이름 + 색(10가지)만, 모음은 색(10가지) + 이모지 하나. 한 계정의 방은 10개까지(2026-11-25 사용자 결정).
-- 시안: design-lab/room-look. 여러 번 실행해도 같은 결과이고, 지금 있는 행은 모두 그대로 유효합니다.
-- (1) 색: red·orange·gold·olive·forest·teal·blue·navy·plum·taupe (기존 red·forest·gold·blue 키 유지)
-- (2) boards.icon 열은 지우지 않고 더 쓰지 않습니다. 검사도 예전 그대로 둡니다(새 방은 기본값 'heart').
--     방장 수정(dm_update_folder)은 아이콘을 받지 않으면(null) 지금 값을 그대로 둡니다.
-- (3) collections.icon은 이모지 하나(16자 이하)를 받습니다. 예전 선 아이콘 키도 계속 받지만(옛 화면 호환),
--     지금 있는 모음은 모두 비슷한 이모지로 바꿉니다: heart→💞 map→🗺️ cup→☕ food→🍜 tree→🌿 culture→🎨
-- (4) 방 수 상한 30 → 10(만들기·초대 참여). 이미 10개를 넘긴 계정은 그대로 두고 더 늘리지만 못 합니다.
begin;

-- 모음 표지로 받는 값: 예전 키, 또는 이모지처럼 보이는 짧은 글자(글자·숫자·공백·태그 문자 없음).
-- 정확히 "이모지 하나"인지는 서버(src/lib/palette.ts, Intl.Segmenter)가 먼저 검사합니다.
create or replace function public.dm_collection_icon_ok(p_icon text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_icon in ('heart', 'map', 'cup', 'food', 'tree', 'culture')
    or (char_length(p_icon) between 1 and 16
      and regexp_replace(p_icon, '[0-9#*]\uFE0F?\u20E3', '', 'g') !~ '[[:space:][:cntrl:]A-Za-z0-9<>"''&\\/가-힣ㄱ-ㅎㅏ-ㅣ]'
      and p_icon ~ '[^\x01-\x7f]'), false);
$$;

create or replace function public.dm_palette_color_ok(p_color text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_color in ('red', 'orange', 'gold', 'olive', 'forest', 'teal', 'blue', 'navy', 'plum', 'taupe'), false);
$$;

alter table public.boards drop constraint if exists boards_color_check;
alter table public.boards add constraint boards_color_check check (public.dm_palette_color_ok(color));

alter table public.collections drop constraint if exists collections_color_check;
alter table public.collections add constraint collections_color_check check (public.dm_palette_color_ok(color));
alter table public.collections drop constraint if exists collections_icon_check;
alter table public.collections alter column icon set default '💞';
update public.collections set icon = case icon
    when 'heart' then '💞' when 'map' then '🗺️' when 'cup' then '☕'
    when 'food' then '🍜' when 'tree' then '🌿' when 'culture' then '🎨' end
  where icon in ('heart', 'map', 'cup', 'food', 'tree', 'culture');
alter table public.collections add constraint collections_icon_check check (public.dm_collection_icon_ok(icon));

-- 방 만들기: 010~017의 최신 정의(012)에서 상한과 안내만 바꿨습니다.
create or replace function public.dm_create_folder(p_user uuid, p_name text, p_color text, p_icon text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare n text := dm_folder_name(p_name); bid uuid; display text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 12));
  select display_name into display from app_users where id = p_user;
  if display is null then raise exception '계정을 찾을 수 없어요. 다시 로그인해 주세요.'; end if;
  if (select count(*) from board_members where user_id = p_user) >= 10 then raise exception '방은 10개까지 만들 수 있어요. 쓰지 않는 방을 정리한 뒤 다시 만들어 주세요.'; end if;
  insert into boards(name, owner_id, is_personal, color, icon) values (n, p_user, false, p_color, coalesce(p_icon, 'heart')) returning id into bid;
  insert into board_members(board_id, user_id, role, member_name) values (bid, p_user, 'owner', display);
  return jsonb_build_object('board_id', bid);
end $$;

-- 방장 수정: 이름·색만. 아이콘을 보내지 않으면(null) 지금 값을 그대로 둡니다.
create or replace function public.dm_update_folder(p_user uuid, p_board uuid, p_name text, p_color text, p_icon text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare n text := dm_folder_name(p_name);
begin
  if not exists(select 1 from board_members where board_id = p_board and user_id = p_user and role = 'owner') then
    raise exception '방장만 이름과 색을 바꿀 수 있어요.';
  end if;
  update boards set name = n, color = p_color, icon = coalesce(p_icon, icon) where id = p_board;
end $$;

-- 초대 수락: 012의 정의에서 상한과 안내만 바꿨습니다(이미 멤버면 상한과 상관없이 그대로).
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
    if (select count(*) from board_members where user_id = p_user) >= 10 then raise exception '방은 10개까지 들어갈 수 있어요. 쓰지 않는 방에서 나간 뒤 다시 참여해 주세요.'; end if;
    mname := dm_unique_member_name(i.board_id, display);
    insert into board_members(board_id, user_id, role, member_name) values (i.board_id, p_user, 'member', mname);
  end if;
  return jsonb_build_object('board_id', i.board_id);
end $$;

-- 모음 바꾸기: 010의 정의에서 색·표지 검사만 바꿨습니다(10가지 색, 이모지 표지).
create or replace function public.dm_change_collection(p_board uuid,p_who text,p_operation uuid,p_command jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  action text := p_command->>'action'; cid uuid; ids uuid[]; pids uuid[];
  cname text; old public.collections; receipt public.collection_operations;
  target public.collection_operations; result jsonb; edges jsonb := '[]'::jsonb; amount integer := 0;
begin
  if not exists(select 1 from public.boards where id=p_board and p_who=any(member_names)) then raise exception '사용할 이름을 다시 확인해 주세요.'; end if;
  if p_operation is null then return jsonb_build_object('code','INVALID_COMMAND'); end if;
  perform pg_advisory_xact_lock(hashtextextended('collections:'||p_board::text,0));
  select * into receipt from public.collection_operations where board_id=p_board and id=p_operation;
  if found then
    if receipt.command <> p_command then return jsonb_build_object('code','OPERATION_MISMATCH'); end if;
    return receipt.result;
  end if;
  if action in ('create','update','delete') then
    cid := (p_command->>'id')::uuid;
    if cid is null then return jsonb_build_object('code','INVALID_COMMAND'); end if;
    if action <> 'create' then
      select * into old from public.collections where board_id=p_board and id=cid for update;
      if not found then return jsonb_build_object('code','COLLECTION_NOT_FOUND'); end if;
      if old.version is distinct from (p_command->>'version')::integer then return jsonb_build_object('code','COLLECTION_CONFLICT'); end if;
    end if;
    if action <> 'delete' then
      cname := regexp_replace(btrim(p_command->>'name'),'\s+',' ','g');
      if cname is null or length(cname) not between 1 and 40 or p_command->>'description' is null or length(p_command->>'description')>120
        or not public.dm_palette_color_ok(p_command->>'color') or not public.dm_collection_icon_ok(p_command->>'icon') then return jsonb_build_object('code','INVALID_COMMAND'); end if;
      if exists(select 1 from public.collections where board_id=p_board and lower(name)=lower(cname) and id<>cid) then return jsonb_build_object('code','COLLECTION_NAME_EXISTS'); end if;
    end if;
    if action='create' then
      if (select count(*) from public.collections where board_id=p_board)>=100 then return jsonb_build_object('code','COLLECTION_LIMIT'); end if;
      if exists(select 1 from public.collections where id=cid) then return jsonb_build_object('code','COLLECTION_CONFLICT'); end if;
      insert into public.collections(id,board_id,name,description,color,icon) values(cid,p_board,cname,p_command->>'description',p_command->>'color',p_command->>'icon');
    elsif action='update' then
      update public.collections set name=cname,description=p_command->>'description',color=p_command->>'color',icon=p_command->>'icon',version=version+1 where id=cid and board_id=p_board;
    else
      delete from public.collections where id=cid and board_id=p_board;
    end if;
    result := jsonb_build_object('ok',true,'id',cid);
  elsif action in ('add','remove') then
    select array_agg(distinct value::uuid) into ids from jsonb_array_elements_text(p_command->'collection_ids');
    select array_agg(distinct value::uuid) into pids from jsonb_array_elements_text(p_command->'place_ids');
    if coalesce(cardinality(ids),0) not between 1 and 50 or coalesce(cardinality(pids),0) not between 1 and 200 then return jsonb_build_object('code','INVALID_COMMAND'); end if;
    if (select count(*) from public.collections where board_id=p_board and id=any(ids))<>cardinality(ids) then return jsonb_build_object('code','COLLECTION_NOT_FOUND'); end if;
    -- Lock before writing: a simultaneous trash/purge must not accept a stale active place.
    perform id from public.places where board_id=p_board and id=any(pids) order by id for share;
    if (select count(*) from public.places where board_id=p_board and id=any(pids) and deleted_at is null)<>cardinality(pids) then return jsonb_build_object('code','COLLECTION_PLACE_CHANGED'); end if;
    if action='add' then
      with inserted as (
        insert into public.collection_places(board_id,collection_id,place_id) select p_board,c,p from unnest(ids) c cross join unnest(pids) p
        on conflict(collection_id,place_id) do nothing returning id,collection_id,place_id
      ) select coalesce(jsonb_agg(to_jsonb(inserted)),'[]'::jsonb),count(*) into edges,amount from inserted;
    else
      with removed as (
        delete from public.collection_places where board_id=p_board and collection_id=any(ids) and place_id=any(pids) returning id,collection_id,place_id
      ) select coalesce(jsonb_agg(to_jsonb(removed)),'[]'::jsonb),count(*) into edges,amount from removed;
    end if;
    result := jsonb_build_object('ok',true,'changed',amount,'edges',edges);
  elsif action='undo' then
    select * into target from public.collection_operations where board_id=p_board and id=(p_command->>'target')::uuid;
    if not found or target.command->>'action' not in ('add','remove') or target.created_at < now()-interval '10 minutes'
      or exists(select 1 from public.collection_operations where board_id=p_board and command->>'action'='undo' and command->>'target'=p_command->>'target') then return jsonb_build_object('code','UNDO_UNAVAILABLE'); end if;
    edges := target.result->'edges';
    if target.command->>'action'='add' then
      -- Only our exact memberships, never ones removed and re-added by the partner.
      delete from public.collection_places where board_id=p_board and id in (select (e->>'id')::uuid from jsonb_array_elements(edges) e);
      get diagnostics amount = row_count;
    else
      perform p.id from public.places p where p.board_id=p_board and p.id in (select (e->>'place_id')::uuid from jsonb_array_elements(edges) e) order by p.id for share;
      if exists(select 1 from jsonb_array_elements(edges) e where not exists(select 1 from public.collections c where c.board_id=p_board and c.id=(e->>'collection_id')::uuid) or not exists(select 1 from public.places p where p.board_id=p_board and p.id=(e->>'place_id')::uuid and p.deleted_at is null)) then return jsonb_build_object('code','UNDO_UNAVAILABLE'); end if;
      insert into public.collection_places(board_id,collection_id,place_id)
        select p_board,(e->>'collection_id')::uuid,(e->>'place_id')::uuid from jsonb_array_elements(edges) e on conflict(collection_id,place_id) do nothing;
      get diagnostics amount = row_count;
    end if;
    result := jsonb_build_object('ok',true,'changed',amount);
  else return jsonb_build_object('code','INVALID_COMMAND');
  end if;
  result := result || jsonb_build_object('operation_id',p_operation);
  insert into public.collection_operations(board_id,id,command,result) values(p_board,p_operation,p_command,result);
  return result;
end $$;

revoke all on function public.dm_collection_icon_ok(text), public.dm_palette_color_ok(text) from public, anon, authenticated;
grant execute on function public.dm_collection_icon_ok(text), public.dm_palette_color_ok(text) to service_role;
revoke all on function public.dm_create_folder(uuid, text, text, text), public.dm_update_folder(uuid, uuid, text, text, text),
  public.dm_accept_invite(uuid, text), public.dm_change_collection(uuid, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.dm_create_folder(uuid, text, text, text), public.dm_update_folder(uuid, uuid, text, text, text),
  public.dm_accept_invite(uuid, text), public.dm_change_collection(uuid, text, uuid, jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
