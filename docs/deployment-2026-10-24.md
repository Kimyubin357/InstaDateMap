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
