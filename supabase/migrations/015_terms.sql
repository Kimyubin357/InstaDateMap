-- 015: 약관 동의(처음 로그인 때 한 번, 약관 버전이 바뀌면 다시). 동의 이력은 따로 남깁니다.
begin;

alter table public.app_users add column if not exists terms_version text;
alter table public.app_users add column if not exists terms_agreed_at timestamptz;
alter table public.app_users add column if not exists marketing_opt_in boolean not null default false;
alter table public.app_users add column if not exists marketing_updated_at timestamptz;

-- 동의·철회 이력(분쟁 대비). 계정을 지우면 함께 지워집니다.
create table if not exists public.user_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  terms_version text not null check (length(terms_version) between 1 and 20),
  service boolean not null, privacy boolean not null, location boolean not null, marketing boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists user_consents_user on public.user_consents(user_id, created_at);
alter table public.user_consents enable row level security;
revoke all on public.user_consents from anon, authenticated;
grant all on public.user_consents to service_role;

-- 필수 3개(서비스·개인정보·위치)에 모두 동의해야 저장합니다. 광고성 정보 수신은 선택입니다.
create or replace function public.dm_agree_terms(p_user uuid, p_version text, p_service boolean, p_privacy boolean, p_location boolean, p_marketing boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not (coalesce(p_service, false) and coalesce(p_privacy, false) and coalesce(p_location, false)) then
    raise exception '필수 약관에 모두 동의해 주세요.';
  end if;
  if coalesce(length(p_version), 0) not between 1 and 20 then raise exception '약관 정보를 다시 불러와 주세요.'; end if;
  update app_users set terms_version = p_version, terms_agreed_at = now(),
    marketing_opt_in = coalesce(p_marketing, false), marketing_updated_at = now() where id = p_user;
  if not found then raise exception '계정을 찾을 수 없어요. 다시 로그인해 주세요.'; end if;
  insert into user_consents(user_id, terms_version, service, privacy, location, marketing) values (p_user, p_version, true, true, true, coalesce(p_marketing, false));
  return jsonb_build_object('terms_version', p_version, 'marketing', coalesce(p_marketing, false));
end $$;

-- 설정에서 광고성 정보 수신 동의를 켜고 끕니다(이력 포함).
create or replace function public.dm_set_marketing(p_user uuid, p_opt_in boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v text;
begin
  update app_users set marketing_opt_in = coalesce(p_opt_in, false), marketing_updated_at = now() where id = p_user returning terms_version into v;
  if not found then raise exception '계정을 찾을 수 없어요. 다시 로그인해 주세요.'; end if;
  insert into user_consents(user_id, terms_version, service, privacy, location, marketing) values (p_user, coalesce(v, '-'), v is not null, v is not null, v is not null, coalesce(p_opt_in, false));
  return jsonb_build_object('marketing', coalesce(p_opt_in, false), 'updated_at', now());
end $$;

-- 내 약관 동의 상태
create or replace function public.dm_terms_state(p_user uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('terms_version', terms_version, 'terms_agreed_at', terms_agreed_at, 'marketing', marketing_opt_in, 'marketing_updated_at', marketing_updated_at)
  from app_users where id = p_user;
$$;

revoke all on function public.dm_agree_terms(uuid, text, boolean, boolean, boolean, boolean), public.dm_set_marketing(uuid, boolean), public.dm_terms_state(uuid) from public, anon, authenticated;
grant execute on function public.dm_agree_terms(uuid, text, boolean, boolean, boolean, boolean), public.dm_set_marketing(uuid, boolean), public.dm_terms_state(uuid) to service_role;

notify pgrst, 'reload schema';
commit;
