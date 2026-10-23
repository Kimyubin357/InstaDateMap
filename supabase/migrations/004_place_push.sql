begin;
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint_hash text not null unique,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  board_id uuid not null references public.boards(id) on delete cascade,
  session_hash text not null references public.access_sessions(token_hash) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_board on public.push_subscriptions(board_id);
create index if not exists push_subscriptions_session on public.push_subscriptions(session_hash);
create table if not exists public.place_push_events (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  place_id uuid not null references public.places(id) on delete cascade,
  added_by text not null,
  auth_version integer not null,
  created_at timestamptz not null default now()
);
create index if not exists place_push_events_board on public.place_push_events(board_id, created_at);
create table if not exists public.push_deliveries (
  event_id uuid not null references public.place_push_events(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  state text not null default 'pending' check (state in ('pending','sending','sent','failed')),
  attempts integer not null default 0,
  lease uuid,
  available_at timestamptz not null default now(),
  primary key(event_id, subscription_id)
);
create index if not exists push_deliveries_subscription on public.push_deliveries(subscription_id);
alter table public.push_subscriptions enable row level security;
alter table public.place_push_events enable row level security;
alter table public.push_deliveries enable row level security;
revoke all on public.push_subscriptions, public.place_push_events, public.push_deliveries from anon, authenticated;
grant all on public.push_subscriptions, public.place_push_events, public.push_deliveries to service_role;

-- New-place event and place/save/source links commit together; duplicates never notify.
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
    where board_id=p_board and kakao_place_id=p_place->>'kakao_place_id' returning id into result;
  end if;
  insert into place_saves(board_id,place_id,added_by) values(p_board,result,p_added_by) on conflict(place_id,added_by) do nothing;
  if p_source is not null then
    insert into source_places(source_id,place_id,extraction_id,added_by) values(p_source,result,p_extraction,p_added_by) on conflict do nothing;
  end if;
  if is_new then insert into place_push_events(board_id,place_id,added_by,auth_version) values(p_board,result,p_added_by,version); end if;
  return result;
end $$;

create or replace function public.dm_claim_push_deliveries(p_board uuid)
returns table(event_id uuid, subscription_id uuid, lease uuid, endpoint text, p256dh text, auth text, added_by text, place_id uuid, place_name text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_board::text, 4));
  delete from place_push_events where board_id=p_board and created_at < now()-interval '7 days';
  insert into push_deliveries(event_id,subscription_id)
  select e.id,s.id from place_push_events e
  join boards b on b.id=e.board_id and b.auth_version=e.auth_version
  join push_subscriptions s on s.board_id=e.board_id and s.created_at<=e.created_at
  join access_sessions a on a.token_hash=s.session_hash and a.board_id=b.id
    and a.auth_version=b.auth_version and a.purpose='member' and a.expires_at>now()
    and a.member_name=any(b.member_names) and a.member_name<>e.added_by
  where e.board_id=p_board and e.created_at>now()-interval '1 day'
  on conflict do nothing;
  return query
  with eligible as (
    select d.event_id,d.subscription_id from push_deliveries d
    join place_push_events e on e.id=d.event_id
    join boards b on b.id=e.board_id and b.auth_version=e.auth_version
    join push_subscriptions s on s.id=d.subscription_id and s.board_id=b.id
    join access_sessions a on a.token_hash=s.session_hash and a.board_id=b.id
      and a.auth_version=b.auth_version and a.expires_at>now() and a.purpose='member'
      and a.member_name=any(b.member_names) and a.member_name<>e.added_by
    where e.board_id=p_board and e.created_at>now()-interval '1 day'
      and d.state in ('pending','sending') and d.available_at<=now() and d.attempts<3
    order by e.created_at limit 20 for update of d skip locked
  ), claimed as (
    update push_deliveries d set state='sending',attempts=d.attempts+1,lease=gen_random_uuid(),available_at=now()+interval '60 seconds'
    from eligible x where d.event_id=x.event_id and d.subscription_id=x.subscription_id
    returning d.event_id,d.subscription_id,d.lease
  )
  select c.event_id,c.subscription_id,c.lease,s.endpoint,s.p256dh,s.auth,e.added_by,p.id,p.name
  from claimed c join push_subscriptions s on s.id=c.subscription_id
  join place_push_events e on e.id=c.event_id join places p on p.id=e.place_id;
end $$;
revoke all on function public.dm_claim_push_deliveries(uuid),public.dm_save_place(uuid,jsonb,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.dm_claim_push_deliveries(uuid),public.dm_save_place(uuid,jsonb,text,uuid,uuid) to service_role;
notify pgrst, 'reload schema';
commit;
