begin;

alter table public.places add column if not exists memo_version integer not null default 0;
alter table public.places add column if not exists memo_updated_by text;
alter table public.sources add column if not exists work_owner text;
alter table public.sources add column if not exists work_until timestamptz;
alter table public.sources add column if not exists analysis_version uuid not null default gen_random_uuid();
alter table public.sources add column if not exists recovery_reason text;
alter table public.sources drop constraint if exists sources_status_check;
alter table public.sources add constraint sources_status_check check(status in ('processing','pending_confirm','done','needs_review','needs_caption','dismissed'));
create index if not exists sources_processing_deadline on public.sources(work_until) where status='processing';

-- Compare and write under the same row lock. Status changes do not conflict with memo edits.
create or replace function public.dm_patch_place(p_board uuid,p_id uuid,p_who text,p_patch jsonb,p_expected integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r places%rowtype;
begin
  select * into r from places where id=p_id and board_id=p_board for update;
  if not found then return jsonb_build_object('code','PLACE_NOT_FOUND'); end if;
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

create or replace function public.dm_recover_sources(p_board uuid)
returns void language sql security definer set search_path=public,pg_temp as $$
  update sources set status='needs_review',recovery_reason='interrupted',work_owner=null,work_until=null,
    analysis_version=gen_random_uuid()
  where board_id=p_board and status='processing' and coalesce(work_until,shared_at+interval '90 seconds')<=now();
$$;

-- Reserve before ANY external request. Unique URL + row lock makes the first arrival win.
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
    return jsonb_build_object('outcome','duplicate','source',to_jsonb(r));
  end if;
  if r.work_until>now() and r.work_owner=p_owner and not p_retry then
    return jsonb_build_object('outcome','resume','source',to_jsonb(r));
  end if;
  update sources set status='processing',work_owner=p_owner,work_until=now()+interval '90 seconds',
    analysis_version=gen_random_uuid(),recovery_reason=null where id=r.id returning * into r;
  return jsonb_build_object('outcome','started','source',to_jsonb(r));
end $$;

-- Keep old candidates intact until the new result commits, and fence off late workers.
create or replace function public.dm_finish_analysis(p_board uuid,p_source uuid,p_owner text,p_version uuid,
  p_status text,p_caption text,p_method text,p_location text,p_rows jsonb,p_auto boolean,p_who text,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r sources%rowtype; item jsonb; eid uuid; pid uuid;
begin
  select * into r from sources where id=p_source and board_id=p_board for update;
  if not found or r.status<>'processing' or r.work_owner is distinct from p_owner or r.analysis_version<>p_version or r.work_until<=now() then
    raise exception 'SOURCE_STALE';
  end if;
  if p_status not in ('needs_caption','needs_review','pending_confirm','done') then raise exception 'Invalid status'; end if;
  if p_rows is not null then
    delete from extractions where source_id=p_source;
    for item in select value from jsonb_array_elements(p_rows) loop
      insert into extractions(source_id,module,raw_name,branch,raw_address,area_hint,category,confidence,evidence,candidates)
      values(p_source,item->>'module',item->>'raw_name',item->>'branch',item->>'raw_address',item->>'area_hint',item->>'category',
        (item->>'confidence')::real,item->>'evidence',coalesce(item->'candidates','[]'::jsonb)) returning id into eid;
      if p_auto then pid:=dm_save_place(p_board,item->'candidates'->0,p_who,p_source,eid); end if;
    end loop;
  end if;
  update sources set status=p_status,caption=p_caption,caption_method=p_method,location_tag=p_location,recovery_reason=p_reason,
    work_until=case when p_status='done' then null else now()+interval '90 seconds' end,
    work_owner=case when p_status='done' then null else p_owner end where id=p_source;
  return jsonb_build_object('place_id',pid);
end $$;

create or replace function public.dm_source_session(p_board uuid,p_source uuid,p_owner text,p_version uuid,p_action text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r sources%rowtype;
begin
  perform dm_recover_sources(p_board);
  select * into r from sources where id=p_source and board_id=p_board for update;
  if not found then return jsonb_build_object('code','SOURCE_NOT_FOUND'); end if;
  if p_action='release' then
    update sources set work_owner=null,work_until=null where id=p_source and work_owner=p_owner and analysis_version=p_version and status<>'processing';
    return jsonb_build_object('ok',true);
  end if;
  if r.status='dismissed' and p_action='dismiss' then return jsonb_build_object('ok',true); end if;
  if r.analysis_version<>p_version or r.status in ('done','dismissed') then return jsonb_build_object('code','SOURCE_STALE'); end if;
  if r.status='processing' or (r.work_until>now() and r.work_owner is distinct from p_owner) then return jsonb_build_object('code','SOURCE_BUSY'); end if;
  if p_action='dismiss' then
    update sources set status='dismissed',work_owner=null,work_until=null,analysis_version=gen_random_uuid() where id=p_source;
  elsif p_action='claim' then
    update sources set work_owner=p_owner,work_until=now()+interval '90 seconds' where id=p_source;
  else raise exception 'Invalid action'; end if;
  return jsonb_build_object('ok',true);
end $$;

-- The server has already resolved each selection against stored candidates or Kakao.
-- Lock the source through the save to close the validate/reanalyse race.
create or replace function public.dm_confirm_source(p_board uuid,p_source uuid,p_owner text,p_version uuid,p_who text,p_selections jsonb,p_direct jsonb)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare r sources%rowtype; item jsonb; n integer:=0;
begin
  select * into r from sources where id=p_source and board_id=p_board for update;
  if not found or r.analysis_version<>p_version or r.status in ('processing','done','dismissed') then raise exception 'SOURCE_STALE'; end if;
  if r.work_owner is distinct from p_owner or r.work_until<=now() then raise exception 'SOURCE_BUSY'; end if;
  for item in select value from jsonb_array_elements(p_selections) loop
    if not exists(select 1 from extractions where id=(item->>'extraction_id')::uuid and source_id=p_source) then raise exception 'SOURCE_STALE'; end if;
    update extractions set excluded=not (item->>'include')::boolean where id=(item->>'extraction_id')::uuid;
    if (item->>'include')::boolean then
      perform dm_save_place(p_board,item->'place',p_who,p_source,(item->>'extraction_id')::uuid); n:=n+1;
    end if;
  end loop;
  if p_direct is not null then perform dm_save_place(p_board,p_direct,p_who,p_source,null); n:=n+1; end if;
  update sources set status='done',work_owner=null,work_until=null where id=p_source;
  return n;
end $$;

revoke all on function public.dm_patch_place(uuid,uuid,text,jsonb,integer),public.dm_recover_sources(uuid),
  public.dm_begin_source(uuid,text,text,text,text,boolean),public.dm_finish_analysis(uuid,uuid,text,uuid,text,text,text,text,jsonb,boolean,text,text),
  public.dm_source_session(uuid,uuid,text,uuid,text),public.dm_confirm_source(uuid,uuid,text,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.dm_patch_place(uuid,uuid,text,jsonb,integer),public.dm_recover_sources(uuid),
  public.dm_begin_source(uuid,text,text,text,text,boolean),public.dm_finish_analysis(uuid,uuid,text,uuid,text,text,text,text,jsonb,boolean,text,text),
  public.dm_source_session(uuid,uuid,text,uuid,text),public.dm_confirm_source(uuid,uuid,text,uuid,text,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
