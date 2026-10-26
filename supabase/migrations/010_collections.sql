begin;
-- Board-scoped foreign keys prevent memberships from ever crossing couple boards.
create unique index if not exists places_board_id_id_key on public.places(board_id,id);
create table if not exists public.collections (
  id uuid primary key,
  board_id uuid not null references public.boards(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 40),
  description text not null default '' check (length(description) <= 120),
  color text not null default 'red' check (color in ('red','forest','gold','blue')),
  icon text not null default 'heart' check (icon in ('heart','map','cup','food','tree','culture')),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  unique(board_id,id)
);
create unique index if not exists collections_board_name_key on public.collections(board_id,lower(regexp_replace(btrim(name),'\s+',' ','g')));
create table if not exists public.collection_places (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null,
  collection_id uuid not null,
  place_id uuid not null,
  added_at timestamptz not null default now(),
  foreign key(board_id,collection_id) references public.collections(board_id,id) on delete cascade,
  foreign key(board_id,place_id) references public.places(board_id,id) on delete cascade,
  unique(collection_id,place_id)
);
create index if not exists collection_places_board_idx on public.collection_places(board_id);
create index if not exists collection_places_place_idx on public.collection_places(board_id,place_id);
-- Receipts survive collection deletion so a delayed create retry cannot resurrect it.
create table if not exists public.collection_operations (
  board_id uuid not null references public.boards(id) on delete cascade,
  id uuid not null,
  command jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(board_id,id)
);
create index if not exists collection_operations_undo_idx on public.collection_operations(board_id,(command->>'target')) where command->>'action'='undo';
alter table public.collections enable row level security;
alter table public.collection_places enable row level security;
alter table public.collection_operations enable row level security;
revoke all on public.collections, public.collection_places, public.collection_operations from public, anon, authenticated;
grant all on public.collections, public.collection_places, public.collection_operations to service_role;
drop trigger if exists datemap_track_change on public.collections;
create trigger datemap_track_change after insert or update or delete on public.collections for each row execute function public.dm_track_board_change();
drop trigger if exists datemap_track_change on public.collection_places;
create trigger datemap_track_change after insert or update or delete on public.collection_places for each row execute function public.dm_track_board_change();

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
        or coalesce(p_command->>'color','') not in ('red','forest','gold','blue') or coalesce(p_command->>'icon','') not in ('heart','map','cup','food','tree','culture') then return jsonb_build_object('code','INVALID_COMMAND'); end if;
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
revoke all on function public.dm_change_collection(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.dm_change_collection(uuid,text,uuid,jsonb) to service_role;
commit;
