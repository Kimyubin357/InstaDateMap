  -- 021: 처음 사용법(온보딩)을 본 기록(2026-11-25 사용자 결정, 시안 design-lab/onboarding).
  -- 020 다음에 적용합니다. 여러 번 실행해도 같은 결과입니다.
  --
  -- 로그인·약관 동의 뒤 지도에 처음 들어오면 사용법을 한 번 보여 줍니다. "봤음"은 기기가 아니라 계정에 남겨
  -- 다른 기기에서 다시 뜨지 않게 합니다. 끝까지 보거나 건너뛰면 적고, 설정 → 사용법 다시 보기는 기록을 바꾸지 않습니다.
  -- 이미 쓰던 계정도 비어 있으니(null) 배포 뒤 한 번 보게 됩니다.
  -- 021이 아직 없는 DB에서도 앱은 동작합니다: API가 "모름"으로 답하고 화면은 이 기기 기록(localStorage)으로 판단합니다.
  begin;
  
  alter table public.app_users add column if not exists onboarded_at timestamptz;
  
  -- 이 계정이 사용법을 본 시각(안 봤으면 null)
  create or replace function public.dm_onboarding_state(p_user uuid)
  returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
    select jsonb_build_object('onboarded_at', u.onboarded_at) from app_users u where u.id = p_user;
  $$;
  
  -- 사용법을 봤다고 적습니다. 처음 본 시각을 지키고(두 번째부터는 그대로), 없는 계정이면 null을 돌려줍니다.
  create or replace function public.dm_mark_onboarded(p_user uuid)
  returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
  declare at timestamptz;
  begin
    update app_users set onboarded_at = coalesce(onboarded_at, now()) where id = p_user returning onboarded_at into at;
    if not found then return null; end if;
    return jsonb_build_object('onboarded_at', at);
  end $$;
  
  revoke all on function public.dm_onboarding_state(uuid), public.dm_mark_onboarded(uuid) from public, anon, authenticated;
  grant execute on function public.dm_onboarding_state(uuid), public.dm_mark_onboarded(uuid) to service_role;
  
  notify pgrst, 'reload schema';
  commit;
