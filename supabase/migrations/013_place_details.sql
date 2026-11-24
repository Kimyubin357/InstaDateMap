-- 013: 가게 정보(전화번호·사진·메뉴·영업시간·예약 링크) 캐시.
-- 폴더와 상관없이 카카오 장소 하나당 한 줄을 두고 여러 폴더가 함께 씁니다. 장소 데이터(메모·상태)와 분리합니다.
begin;
create table if not exists public.place_details (
  kakao_place_id text primary key check (length(kakao_place_id) between 1 and 40),
  status text not null check (status in ('ok', 'not_found', 'error')),
  naver_place_id text check (naver_place_id is null or naver_place_id ~ '^[0-9]{1,15}$'),
  phone text check (phone is null or length(phone) <= 30),
  photos jsonb not null default '[]'::jsonb check (jsonb_typeof(photos) = 'array'),
  menus jsonb not null default '[]'::jsonb check (jsonb_typeof(menus) = 'array'),
  hours jsonb check (hours is null or jsonb_typeof(hours) = 'object'),
  booking_url text check (booking_url is null or booking_url ~ '^https://'),
  catchtable_url text check (catchtable_url is null or catchtable_url ~ '^https://'),
  fetched_at timestamptz not null default now()
);
alter table public.place_details enable row level security;
revoke all on public.place_details from anon, authenticated;
grant all on public.place_details to service_role;
notify pgrst, 'reload schema';
commit;
