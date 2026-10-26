begin;
-- Memo updates and their notification events commit atomically. No memo text is stored in events.
alter table public.place_push_events add column if not exists event_kind text not null default 'place_added'
  check (event_kind in ('place_added','memo_added','memo_updated'));
alter table public.place_push_events add column if not exists memo_version integer;
create unique index if not exists place_push_events_memo_version on public.place_push_events(place_id,memo_version) where memo_version is not null;

create or replace function public.dm_patch_place(p_board uuid,p_id uuid,p_who text,p_patch jsonb,p_expected integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r places%rowtype; changed boolean; kind text; version integer;
begin
  select * into r from places where id=p_id and board_id=p_board for update;
  if not found or r.deleted_at is not null then return jsonb_build_object('code','PLACE_NOT_FOUND'); end if;
  if p_patch ? 'memo' and (p_expected is null or p_expected<>r.memo_version) then
    return jsonb_build_object('code','MEMO_CONFLICT','memo',coalesce(r.memo,''),'memo_version',r.memo_version,'memo_updated_by',r.memo_updated_by);
  end if;
  select auth_version into version from boards where id=p_board and p_who=any(member_names);
  if not found then raise exception '이 보드의 사용자가 아닙니다.'; end if;
  changed := p_patch ? 'memo' and coalesce(r.memo,'') is distinct from coalesce(left(p_patch->>'memo',500),'');
  kind := case when coalesce(r.memo,'')='' then 'memo_added' else 'memo_updated' end;
  update places set
    status=case when p_patch ? 'status' then p_patch->>'status' else status end,
    memo=case when p_patch ? 'memo' then left(p_patch->>'memo',500) else memo end,
    memo_version=memo_version+case when p_patch ? 'memo' then 1 else 0 end,
    memo_updated_by=case when p_patch ? 'memo' then p_who else memo_updated_by end
  where id=p_id returning * into r;
  if changed then
    insert into place_push_events(board_id,place_id,added_by,auth_version,event_kind,memo_version)
    values(p_board,p_id,p_who,version,kind,r.memo_version);
  end if;
  return jsonb_build_object('ok',true,'memo_version',r.memo_version,'memo_changed',changed);
end $$;

-- Return type gains event_kind; replace the function and restore its restricted permissions.
drop function public.dm_claim_push_deliveries(uuid);
create or replace function public.dm_claim_push_deliveries(p_board uuid)
returns table(event_id uuid, subscription_id uuid, lease uuid, endpoint text, p256dh text, auth text, added_by text, place_id uuid, place_name text, event_kind text)
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
  select c.event_id,c.subscription_id,c.lease,s.endpoint,s.p256dh,s.auth,e.added_by,p.id,p.name,e.event_kind
  from claimed c join push_subscriptions s on s.id=c.subscription_id
  join place_push_events e on e.id=c.event_id join places p on p.id=e.place_id;
end $$;

revoke all on function public.dm_claim_push_deliveries(uuid),public.dm_patch_place(uuid,uuid,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.dm_claim_push_deliveries(uuid),public.dm_patch_place(uuid,uuid,text,jsonb,integer) to service_role;
notify pgrst, 'reload schema';
commit;
