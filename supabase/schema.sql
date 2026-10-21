-- 데이트맵 1단계 스키마. Supabase SQL Editor에 그대로 붙여넣고 실행하세요.
create extension if not exists pgcrypto;

-- 커플 공동 보드. 1단계는 하나만 씁니다.
create table if not exists boards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  token text not null unique default encode(gen_random_bytes(18), 'hex'),
  created_at timestamptz not null default now()
);

-- 공유한 링크 하나 = source 하나
create table if not exists sources (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards(id) on delete cascade,
  url text not null,
  media_type text not null check (media_type in ('post', 'carousel', 'reel', 'unknown')),
  caption text,
  caption_method text check (caption_method in ('og', 'oembed', 'manual')),
  location_tag text,
  shared_by text not null,
  shared_at timestamptz not null default now(),
  status text not null default 'processing'
    check (status in ('processing', 'pending_confirm', 'done', 'needs_review', 'needs_caption')),
  unique (board_id, url)
);

-- 추출 모듈이 뽑은 장소 후보 (원문 그대로 보관)
create table if not exists extractions (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete cascade,
  module text not null check (module in ('caption', 'location_tag', 'image', 'video')),
  raw_name text not null,
  branch text,
  raw_address text,
  area_hint text,
  category text,
  confidence real not null default 0,
  evidence text,
  candidates jsonb not null default '[]'::jsonb, -- 카카오 검색 후보 (최대 3개)
  excluded boolean not null default false,       -- 추리기에서 뺀 후보
  created_at timestamptz not null default now()
);

-- 지도에 찍히는 장소
create table if not exists places (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards(id) on delete cascade,
  kakao_place_id text not null,
  name text not null,
  address text,
  lat double precision not null,
  lng double precision not null,
  category text,
  kakao_url text,
  status text not null default 'wish' check (status in ('wish', 'visited', 'again', 'meh')),
  memo text,
  created_at timestamptz not null default now(),
  unique (board_id, kakao_place_id)
);

-- 링크 ↔ 장소 (다대다)
create table if not exists source_places (
  source_id uuid not null references sources(id) on delete cascade,
  place_id uuid not null references places(id) on delete cascade,
  extraction_id uuid references extractions(id) on delete set null,
  added_by text not null,
  added_at timestamptz not null default now(),
  primary key (source_id, place_id, added_by)
);

create index if not exists sources_board_status on sources (board_id, status);
create index if not exists extractions_source on extractions (source_id);
create index if not exists places_board on places (board_id);

-- 서버(service role)만 접근하도록 RLS를 켜고 정책은 만들지 않습니다.
alter table boards enable row level security;
alter table sources enable row level security;
alter table extractions enable row level security;
alter table places enable row level security;
alter table source_places enable row level security;

-- 보드 하나 만들기. 실행 후 나오는 token을 단축어와 지도 주소에 씁니다.
insert into boards (name) values ('우리 데이트맵') returning id, token;
