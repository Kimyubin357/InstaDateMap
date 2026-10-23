# 2026-10-24 운영 반영

시간 기준: Asia/Seoul. 범위는 R01·R02·R03·R04·R05·R07이며 R06 및 R08~R12는 변경하지 않았다.

## 적용 대상

- 운영 주소: https://insta-date-map.vercel.app
- Vercel 프로젝트: `yubins-projects-0df59590/insta-date-map`
- 배포: `dpl_6YE78QhPPoyAFQQZhrFiC2qgik3N`, 상태 `READY`, 대상 `production`
- Supabase 프로젝트: `InstaDateMap` (`prlvhmqconzyutydmagn`)

## 적용 내용

- 기존 004 적용 상태를 확인한 뒤 `005_reliable_workflows.sql`을 Supabase CLI `db query --linked --project-ref ... --file ...`로 실행했다. DB 초기화나 이전 마이그레이션의 재실행은 하지 않았다.
- 적용 전후 장소 6개, 원본 링크 11개, 장소-원본 연결 4개의 개수와 기존 열의 데이터 지문이 일치했다.
- 기존 VAPID 키를 유지했다. Vault에서 예약 전용 비밀값을 생성하고 Vercel 운영 `CRON_SECRET`에 등록했다. 비밀값은 Git이나 로컬 파일에 저장하지 않았다.
- `setup-push-cron.sql`로 아래 두 작업을 활성화했다.

| 작업 | 예약식 | 동작 |
| --- | --- | --- |
| `datemap-push-retry` | `*/5 * * * *` | 5분마다 미발송 알림 재시도 |
| `datemap-recover-links` | `* * * * *` | 1분마다 만료된 분석 작업을 확인 대기로 복구 |

## 검증

- 로컬 사전 검증: 테스트 412개, 타입 검사, 운영 빌드 통과. 브라우저 시나리오 29개 통과.
- 운영 홈페이지와 PWA manifest HTTP 200. 새 브라우저에서 PIN 입장 화면과 제목이 정상 표시됐다.
- 인증 없는 `POST /api/jobs/push`는 HTTP 401.
- Supabase `pg_net`에서 Vault 인증을 사용한 실제 운영 호출은 HTTP 200, `{"ok":true}`를 반환했다.
- 2026-10-24 00:15(한국 시간)에 알림 재시도와 링크 복구 예약이 모두 자동으로 실행돼 `succeeded`로 확인됐다. 자동 알림 호출의 HTTP 응답도 200, `{"ok":true}`였다.
- 실제 iPhone의 잠금 화면 수신은 이번 배포 검증에서 새로 시험하지 않았다. 테스트를 위해 운영 장소를 추가하거나 기존 PIN을 바꾸지 않았다.

## 로컬 관리 도구

두 CLI는 사용자 폴더 `.codex/tools/deployment-cli/node_modules/.bin/`에 설치했다. Vercel은 Windows 기본 설정 경로의 파일 이동 오류 때문에 `--global-config C:/Users/Kong/.codex/tools/deployment-cli/vercel-auth`를 지정해야 한다. Supabase는 기본 로그인 저장소를 사용한다.

최초 운영 반영은 현재 작업 폴더의 수정본을 Vercel CLI로 업로드해 수행했다.


## 추가 운영 반영: 삭제한 장소와 Gemini 사용 한도

- 사용자 추가 요청에 따라 설정의 삭제한 장소·복구·영구 삭제, Gemini 한도 거부 사유 안내를 구현했다. B01은 제외로 기록했고 R08–R12 보류를 유지했다.
- `006_place_trash.sql`을 운영 Supabase에 적용했다. 적용 전후 장소 6개·저장자 기록 6개·원본 연결 4개와 각 데이터 지문이 일치했다. 테스트를 위해 운영 장소를 삭제하거나 추가하지 않았다.
- `dm_trash_place`는 service_role만 실행할 수 있고 anon 실행 권한이 없음을 확인했다. 삭제한 장소 수는 적용 직후 0개였다.
- Vercel 배포 `dpl_7Qo71fce44AnfDTx5AnSiudKMQVN`은 `READY`, `production`이며 `https://insta-date-map.vercel.app`에 연결했다.
- 홈페이지와 manifest HTTP 200, 인증 없는 `/api/trash` HTTP 401을 확인했다. 기존 `datemap-push-retry`(5분)와 `datemap-recover-links`(1분)는 활성 상태를 유지한다.
- 자동 테스트 433개·타입 검사·운영 빌드 통과. 로컬 운영 빌드와 합성 Postgres DB를 연결한 모바일·데스크톱 브라우저 점검 26개를 통과했다. 삭제→목록 숨김→설정 복구→메모·상태 유지→영구 삭제, 확인 취소, Gemini 사유의 대기함·확인 화면·응답 유실 재조회 보존을 확인했다. 브라우저 예외와 모의 DB 오류는 없었다.
- 브라우저 검증은 설치된 Playwright/Chrome과 로컬 테스트 DB를 연결하는 기존 QA 도구를 재사용했다. 실제 Gemini 무료 한도를 소진시키거나 iPhone PWA 실기기 검증을 수행하지는 않았다.


## 추가 운영 반영: 삭제 목록 전용 페이지와 즉시 복구

- `/settings/trash` 페이지를 추가하고 설정의 삭제한 장소 링크는 데이터 개수에 관계없이 항상 표시했다. 새로고침·직접 접속에서도 PIN 인증을 확인하며 재입장 후 돌아올 주소를 보존한다. 헤더 뒤로가기는 설정으로 돌아간다.
- 복구 API에 서버 확인 장소(메모·상태·저장자·원본·변경 번호)를 포함하고, 앱이 기존 `acceptSavedPlace` 경로로 지도·목록·기기 캐시에 바로 반영하도록 변경했다. 전체 목록 갱신은 이어서 진행하며 오래된 응답이 복구 장소를 덮지 못한다. 미리보기 조회 실패 시 이미 커밋된 복구는 성공으로 유지하고 전체 조회로 보완한다.
- DB 스키마 변경은 없다. Vercel 배포 `dpl_9M8VMMs3z4iVS5zhkH7c6mGzSTPw`의 상태는 `READY`, 대상은 `production`이며 기존 운영 주소에 연결했다.
- 관련 자동 테스트 52개와 타입 검사·운영 빌드를 통과했다. Browser 플러그인이 제공되지 않아 기존 Playwright/Chrome와 합성 Postgres DB 도구로 `http://localhost:43100`을 검증했다. 모바일 390×844·데스크톱 1440×900에서 브라우저 점검 31개 통과: 삭제 0개 설정 진입, 독립 페이지와 빈 목록, 삭제 목록·메모 표시, 설정/지도 복귀, 전체 목록 요청을 보류한 상태에서 복구 장소 즉시 표시, 직접 URL·새로고침·인증 복귀 주소, 의미 있는 화면·가로 넘침·브라우저 오류 없음.
- QA 임시 스크립트와 화면 캡처는 저장소 밖 `trash-page-qa.cjs`, `trash-page-results.json`, `mobile-trash-empty-page.png`, `mobile-trash-separate-page.png`, `mobile-restored-before-refresh.png` 등에 보관했다. 실제 운영 장소는 QA를 위해 수정하지 않았다. iPhone PWA 실기기 확인은 별도로 남는다.
