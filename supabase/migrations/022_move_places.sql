-- 022: 다른 방에 담기(복사) → 다른 방으로 옮기기(2026-11-25 사용자 결정).
-- 옮기면 지금 방에서는 빠집니다. 같은 가게를 두 방에 두고 싶으면 인스타 링크로 다른 방에 한 번 더 저장합니다.
-- 지금 방에서 지우는 일이라 삭제와 같은 규칙: 처음 등록한 사람만(그 사람이 방을 나갔으면 누구나) 옮길 수 있습니다.
-- 옮기기는 삭제가 아니므로 '삭제한 장소'(place_trash_log)에는 남기지 않습니다.
-- 담을 방에 같은 가게가 있으면 그쪽 장소를 두고 메모만 합칩니다(dm_copy_places와 같음).
-- 019 다음(020·021 뒤)에 적용합니다. 여러 번 실행해도 같은 결과입니다.

create or replace function public.dm_move_places(p_user uuid, p_from uuid, p_to uuid, p_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare me text; p record; reg_user uuid; reg_name text; reg_now text; moving uuid[]; result jsonb;
begin
  if p_from = p_to then raise exception '다른 방을 골라 주세요.'; end if;
  if coalesce(array_length(p_ids, 1), 0) not between 1 and 100 then raise exception '장소를 1~100곳 골라 주세요.'; end if;
  select member_name into me from board_members where board_id = p_from and user_id = p_user;
  if me is null or not exists(select 1 from board_members where board_id = p_to and user_id = p_user) then
    raise exception '참여한 방 사이에서만 옮길 수 있어요.';
  end if;
  -- 삭제(dm_delete_place)와 같은 잠금: 옮기는 사이에 같은 장소를 지우거나 고치지 못하게 합니다.
  perform pg_advisory_xact_lock(hashtextextended(p_from::text, 4));

  for p in select id from places where board_id = p_from and id = any(p_ids) and deleted_at is null for update loop
    reg_user := null; reg_name := null; reg_now := null;
    select f.reg_user, f.reg_name into reg_user, reg_name from dm_place_first_saver(p.id) f;
    if reg_user is not null then
      if reg_user <> p_user then
        select member_name into reg_now from board_members where board_id = p_from and user_id = reg_user;
        if reg_now is not null then raise exception '%님이 등록한 장소라 옮길 수 없어요.', reg_now; end if;
      end if;
    elsif reg_name is not null and reg_name <> me and exists(select 1 from board_members where board_id = p_from and member_name = reg_name) then
      raise exception '%님이 등록한 장소라 옮길 수 없어요.', reg_name;
    end if;
    moving := moving || p.id;
  end loop;
  if coalesce(array_length(moving, 1), 0) = 0 then raise exception '옮길 장소를 찾지 못했어요. 목록을 새로 고쳐 주세요.'; end if;

  result := dm_copy_places(p_user, p_from, p_to, moving);
  -- 지금 방에서 뺍니다. 모음·메모·저장 기록·원본 연결은 이 방 것이라 함께 사라집니다(담을 방에는 복사돼 있음).
  delete from places where board_id = p_from and id = any(moving);
  return result || jsonb_build_object('from', p_from, 'moved_ids', to_jsonb(moving));
end $$;
revoke all on function public.dm_move_places(uuid, uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.dm_move_places(uuid, uuid, uuid, uuid[]) to service_role;

notify pgrst, 'reload schema';
