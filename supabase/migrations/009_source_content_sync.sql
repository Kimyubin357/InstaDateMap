begin;

-- Work ownership and its deadline protect confirmation/analysis, but neither is
-- part of the map snapshot. Renewing/releasing a lease must not invalidate it.
-- Keep every other column (including NULL changes and future content columns)
-- in the comparison so pending counts, recovery and source links still sync.
drop trigger if exists datemap_track_change on public.sources;
drop trigger if exists datemap_track_content_change on public.sources;

create trigger datemap_track_change
after insert or delete on public.sources
for each row execute function public.dm_track_board_change();

create trigger datemap_track_content_change
after update on public.sources
for each row
when (
  (to_jsonb(OLD) - array['work_owner', 'work_until'])
    is distinct from
  (to_jsonb(NEW) - array['work_owner', 'work_until'])
)
execute function public.dm_track_board_change();

commit;
