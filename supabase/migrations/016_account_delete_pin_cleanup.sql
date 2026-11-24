-- 016: 회원 탈퇴 + PIN 입장 방식 정리
-- (1) 회원 탈퇴: 혼자 쓰던 폴더는 장소·메모·모음과 함께 삭제하고, 함께 쓰던 폴더는 나갑니다(방장이면 가장 먼저 참여한 멤버에게 넘김).
--     함께 쓰던 폴더에 남긴 장소·메모의 이름 기록은 그 폴더가 삭제될 때까지 남습니다(개인정보 처리방침 3항).
-- (2) PIN 정리: 두 사람 모두 계정으로 옮겼으므로 PIN 세션·PIN 값·PIN 전용 함수와 시도 제한 표를 지웁니다. 되돌릴 수 없습니다.
begin;

create or replace function public.dm_delete_account(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare m record; heir uuid; removed integer := 0; left_folders integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('account:' || p_user::text, 16));
  if not exists(select 1 from app_users where id = p_user) then raise exception '계정을 찾을 수 없어요. 다시 로그인해 주세요.'; end if;
  for m in select board_id, role from board_members where user_id = p_user order by joined_at loop
    perform 1 from boards where id = m.board_id for update;
    if m.role = 'owner' then
      select user_id into heir from board_members where board_id = m.board_id and user_id <> p_user order by joined_at limit 1;
      if heir is null then
        delete from boards where id = m.board_id;
        removed := removed + 1;
        continue;
      end if;
      update board_members set role = 'owner' where board_id = m.board_id and user_id = heir;
      update boards set owner_id = heir where id = m.board_id;
    end if;
    delete from board_members where board_id = m.board_id and user_id = p_user;
    left_folders := left_folders + 1;
  end loop;
  -- 세션을 지우면 그 기기의 알림 구독도 함께 지워집니다(push_subscriptions on delete cascade).
  delete from access_sessions where user_id = p_user;
  -- 로그인 연결·약관 동의 이력은 계정과 함께 지워집니다(on delete cascade). 만든 초대 링크의 작성자는 비웁니다(on delete set null).
  delete from app_users where id = p_user;
  return jsonb_build_object('deleted_folders', removed, 'left_folders', left_folders);
end $$;
revoke all on function public.dm_delete_account(uuid) from public, anon, authenticated;
grant execute on function public.dm_delete_account(uuid) to service_role;

-- (2) PIN 정리
delete from public.access_sessions where user_id is null;
update public.boards set pin_hash = null where pin_hash is not null;
drop function if exists public.dm_configure_access(uuid, text, text, text, text[], text, timestamptz, boolean);
drop function if exists public.dm_reset_pin(uuid, text);
drop function if exists public.dm_reserve_attempt(uuid, text);
drop function if exists public.dm_clear_attempt(uuid, text);
drop table if exists public.access_limits;

notify pgrst, 'reload schema';
commit;
