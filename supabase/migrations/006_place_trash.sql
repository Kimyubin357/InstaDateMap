begin;
alter table public.places add column if not exists deleted_at timestamptz;
alter table public.places add column if not exists deleted_by text;
create index if not exists places_trash on public.places(board_id,deleted_at desc) where deleted_at is not null;

create or replace function public.dm_save_place(
  p_board uuid, p_place jsonb, p_added_by text, p_source uuid default null, p_extraction uuid default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare result uuid; is_new boolean; version integer;
begin
  if p_source is not null and not exists(select 1 from sources where id=p_source and board_id=p_board) then raise exception '이 보드의 링크가 아닙니다.'; end if;
  if p_extraction is not null and not exists(select 1 from extractions where id=p_extraction and source_id=p_source) then raise exception '이 링크의 장소 후보가 아닙니다.'; end if;
  select auth_version into version from boards where id=p_board and p_added_by=any(member_names);
  if not found then raise exception '이 보드의 저장자가 아닙니다.'; end if;
  insert into places(board_id,kakao_place_id,name,address,lat,lng,category,kakao_url)
  values(p_board,p_place->>'kakao_place_id',p_place->>'name',p_place->>'address',(p_place->>'lat')::double precision,(p_place->>'lng')::double precision,p_place->>'category',p_place->>'kakao_url')
  on conflict(board_id,kakao_place_id) do nothing returning id into result;
  is_new := result is not null;
  if not is_new then
    update places set name=p_place->>'name',address=p_place->>'address',lat=(p_place->>'lat')::double precision,lng=(p_place->>'lng')::double precision,category=p_place->>'category',kakao_url=p_place->>'kakao_url'
    where board_id=p_board and kakao_place_id=p_place->>'kakao_place_id' and deleted_at is null returning id into result;
    if result is null then raise exception '삭제한 장소에 있어요. 설정의 삭제한 장소에서 먼저 복구해 주세요.'; end if;
  end if;
  insert into place_saves(board_id,place_id,added_by) values(p_board,result,p_added_by) on conflict(place_id,added_by) do nothing;
  if p_source is not null then
    insert into source_places(source_id,place_id,extraction_id,added_by) values(p_source,result,p_extraction,p_added_by) on conflict do nothing;
  end if;
  if is_new then insert into place_push_events(board_id,place_id,added_by,auth_version) values(p_board,result,p_added_by,version); end if;
  return result;
end $$;

create or replace function public.dm_patch_place(p_board uuid,p_id uuid,p_who text,p_patch jsonb,p_expected integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r places%rowtype;
begin
  select * into r from places where id=p_id and board_id=p_board for update;
  if not found or r.deleted_at is not null then return jsonb_build_object('code','PLACE_NOT_FOUND'); end if;
  if p_patch ? 'memo' and (p_expected is null or p_expected<>r.memo_version) then
    return jsonb_build_object('code','MEMO_CONFLICT','memo',coalesce(r.memo,''),'memo_version',r.memo_version,'memo_updated_by',r.memo_updated_by);
  end if;
  update places set
    status=case when p_patch ? 'status' then p_patch->>'status' else status end,
    memo=case when p_patch ? 'memo' then left(p_patch->>'memo',500) else memo end,
    memo_version=memo_version+case when p_patch ? 'memo' then 1 else 0 end,
    memo_updated_by=case when p_patch ? 'memo' then p_who else memo_updated_by end
  where id=p_id returning * into r;
  return jsonb_build_object('ok',true,'memo_version',r.memo_version);
end $$;

create or replace function public.dm_begin_source(p_board uuid,p_url text,p_media text,p_who text,p_owner text,p_retry boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r sources%rowtype;
begin
  insert into sources(board_id,url,media_type,shared_by,status,work_until)
  values(p_board,p_url,p_media,p_who,'needs_review',null) on conflict(board_id,url) do nothing;
  select * into r from sources where board_id=p_board and url=p_url for update;
  if r.work_until>now() and (r.status='processing' or r.work_owner is distinct from p_owner) then
    return jsonb_build_object('outcome','busy');
  end if;
  if r.status='done' and exists(select 1 from source_places where source_id=r.id) then
    if not exists(select 1 from source_places sp join places p on p.id=sp.place_id where sp.source_id=r.id and p.deleted_at is null) then
      return jsonb_build_object('outcome','trashed','source',to_jsonb(r));
    end if;
    return jsonb_build_object('outcome','duplicate','source',to_jsonb(r));
  end if;
  if r.work_until>now() and r.work_owner=p_owner and not p_retry then
    return jsonb_build_object('outcome','resume','source',to_jsonb(r));
  end if;
  update sources set status='processing',work_owner=p_owner,work_until=now()+interval '90 seconds',
    analysis_version=gen_random_uuid(),recovery_reason=null where id=r.id returning * into r;
  return jsonb_build_object('outcome','started','source',to_jsonb(r));
end $$;

create or replace function public.dm_trash_place(p_board uuid,p_id uuid,p_who text,p_action text,p_expected timestamptz default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r places%rowtype;
begin
  if p_action not in ('trash','restore','purge') then raise exception 'Invalid trash action'; end if;
  if not exists(select 1 from boards where id=p_board and p_who=any(member_names)) then raise exception '이 보드의 사용자가 아닙니다.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_board::text,4));
  select * into r from places where id=p_id and board_id=p_board for update;
  if not found then
    if p_action='restore' then return jsonb_build_object('code','PLACE_NOT_FOUND'); end if;
    return jsonb_build_object('ok',true,'deleted_id',p_id,'already_deleted',true);
  end if;
  if p_action='trash' then
    if r.deleted_at is null then
      update places set deleted_at=clock_timestamp(),deleted_by=p_who,memo_version=memo_version+1 where id=p_id;
      delete from place_push_events where place_id=p_id and board_id=p_board;
    end if;
  else
    if r.deleted_at is null then
      if p_action='restore' then return jsonb_build_object('ok',true,'restored_id',p_id); end if;
      return jsonb_build_object('code','TRASH_CHANGED');
    end if;
    if p_expected is null or r.deleted_at<>p_expected then return jsonb_build_object('code','TRASH_CHANGED'); end if;
    if p_action='restore' then
      update places set deleted_at=null,deleted_by=null,memo_version=memo_version+1 where id=p_id;
    else
      delete from places where id=p_id and board_id=p_board;
    end if;
  end if;
  return jsonb_build_object('ok',true,'deleted_id',p_id,'already_deleted',p_action='trash' and r.deleted_at is not null,'restored_id',case when p_action='restore' then p_id end);
end $$;
revoke all on function public.dm_trash_place(uuid,uuid,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.dm_trash_place(uuid,uuid,text,text,timestamptz) to service_role;
notify pgrst, 'reload schema';
commit;
