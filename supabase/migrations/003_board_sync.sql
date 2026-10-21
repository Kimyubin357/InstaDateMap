begin;
create table if not exists public.board_sync (
  board_id uuid primary key references public.boards(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0)
);
alter table public.board_sync enable row level security;
revoke all on public.board_sync from public, anon, authenticated;
grant all on public.board_sync to service_role;
insert into public.board_sync(board_id) select id from public.boards on conflict do nothing;

create or replace function public.dm_board_revision(p_board uuid) returns text
language sql stable security definer set search_path = '' as $$
  select revision::text from public.board_sync where board_id = p_board
$$;
revoke all on function public.dm_board_revision(uuid) from public, anon, authenticated;
grant execute on function public.dm_board_revision(uuid) to service_role;

create or replace function public.dm_touch_board(p_board uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.board_sync(board_id, revision)
  select id, 1 from public.boards where id = p_board
  on conflict (board_id) do update set revision = public.board_sync.revision + 1
$$;
create or replace function public.dm_track_board_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare previous_board uuid; next_board uuid;
begin
  if TG_TABLE_NAME = 'boards' then
    if TG_OP <> 'INSERT' then previous_board := OLD.id; end if;
    if TG_OP <> 'DELETE' then next_board := NEW.id; end if;
  elsif TG_TABLE_NAME = 'source_places' then
    -- A cascading parent deletion is covered by that parent's own trigger.
    if TG_OP <> 'INSERT' then
      select board_id into previous_board from public.sources where id = OLD.source_id;
      if previous_board is null then select board_id into previous_board from public.places where id = OLD.place_id; end if;
    end if;
    if TG_OP <> 'DELETE' then
      select board_id into next_board from public.sources where id = NEW.source_id;
      if next_board is null then select board_id into next_board from public.places where id = NEW.place_id; end if;
    end if;
  else
    if TG_OP <> 'INSERT' then previous_board := OLD.board_id; end if;
    if TG_OP <> 'DELETE' then next_board := NEW.board_id; end if;
  end if;
  if previous_board is not null then perform public.dm_touch_board(previous_board); end if;
  if next_board is not null and next_board is distinct from previous_board then perform public.dm_touch_board(next_board); end if;
  return null;
end $$;
create or replace function public.dm_broadcast_board_revision() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform realtime.send(jsonb_build_object('revision', NEW.revision::text), 'changed', 'datemap:' || NEW.board_id::text, true);
  exception when others then
    raise warning 'DateMap revision broadcast unavailable (%)', SQLSTATE;
  end;
  return null;
end $$;
revoke all on function public.dm_touch_board(uuid), public.dm_track_board_change(), public.dm_broadcast_board_revision() from public, anon, authenticated;
do $$ declare target text; begin
  foreach target in array array['boards', 'places', 'sources', 'source_places', 'place_saves'] loop
    execute format('drop trigger if exists datemap_track_change on public.%I', target);
    execute format('create trigger datemap_track_change after insert or update or delete on public.%I for each row execute function public.dm_track_board_change()', target);
  end loop;
end $$;
drop trigger if exists datemap_broadcast_revision on public.board_sync;
create trigger datemap_broadcast_revision after insert or update on public.board_sync
for each row execute function public.dm_broadcast_board_revision();
commit;
