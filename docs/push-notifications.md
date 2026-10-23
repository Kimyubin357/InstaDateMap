# 새 장소 알림

유빈이 새 장소를 저장하면 수민이 알림을 켠 기기들에, 수민이 저장하면 유빈 기기들에 보냅니다. 같은 사람의 다른 기기는 제외합니다. 직접 검색·링크 자동 저장·확인 후 저장이 같은 경로를 사용합니다. 중복 저장·메모·상태 변경은 새 장소 알림을 만들지 않습니다.

## 운영에 처음 적용할 때

1. Supabase SQL Editor에서 `supabase/migrations/004_place_push.sql`을 실행합니다. 기존 장소·메모·상태·원본 연결은 보존하며, 재실행할 수 있습니다. 브라우저에 테이블이나 DB 키를 공개하지 않습니다.
2. `npm run push:keys -- https://실제-배포-도메인`을 한 번 실행합니다. 생성한 세 값은 Git에서 제외한 `.env.local`과 `.env.push.local`에 저장됩니다. 이미 있는 키는 유지합니다.
3. Vercel 프로젝트의 운영 환경 변수에 `.env.push.local`의 `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` 세 값을 같은 내용으로 추가하고 앱을 다시 배포합니다. 개인키는 공개 변수(`NEXT_PUBLIC_…`)로 만들지 않습니다. 키를 교체하면 기기에서 알림을 다시 켜야 합니다.
4. 각 기기에서 설정 → 새 장소 알림 → 이 기기에서 알림 받기 → 시스템 권한 허용을 진행합니다. 아이폰은 홈 화면에 추가한 앱에서 실행해야 합니다. 별도 APNs 인증서·유료 알림 서비스는 필요하지 않습니다.
5. 두 실기기에서 서로 새 장소를 등록하고, 앱이 닫혀 있을 때도 알림이 도착하는지 확인합니다. 알림을 누르면 해당 장소 상세를 열며, 입장이 만료됐다면 PIN 입력 후 같은 장소로 돌아갑니다.

운영 DB 관리 권한과 Vercel 환경 변수 관리 권한이 없는 환경에서는 1~3단계를 대신 적용할 수 없습니다. 키가 없거나 DB가 아직 준비되지 않았다면 설정 화면에서 준비 중으로 표시합니다. 장소 저장은 계속 동작합니다.

## 동작과 복구

- 기기 구독은 현재 PIN 세션에 연결됩니다. 잠금·세션 만료·PIN 변경 후에는 알림을 중지하며, 다시 입장한 뒤 설정에서 켤 수 있습니다. 기기 주인을 바꾸면 현재 선택한 이름을 따릅니다.
- 새 장소와 발송 이벤트가 같은 DB 트랜잭션에서 커밋됩니다. 기기별 발송 기록을 원자적으로 회수하여 동시 요청이 중복 발송하지 않게 합니다. 저장 완료 응답 이후의 발송 작업은 Vercel `waitUntil`로 유지합니다.
- 일시적인 발송 오류는 즉시 한 번 재시도합니다. 그래도 실패하거나 작업이 중단되면 5분 간격의 독립 예약 작업과 이후 장소 저장·알림 설정 조회 때 미완료 기록을 회수합니다(최대 3회 회수, 생성 후 24시간 이내). 완료된 기기는 재발송하지 않습니다. 만료된 구독(404·410)은 정리하고 이벤트 기록은 7일 후 다음 발송 조회 때 정리합니다. 동시 회수 잠금과 완료 기록으로 중복 발송을 막고, 같은 이벤트의 Web Push topic·알림 tag를 유지합니다. 제공자 접수 직후 응답이 유실되는 경우의 완전한 exactly-once 전송까지 보장하는 것은 아닙니다.
- 브라우저 푸시 제공자가 접수한 알림도 네트워크·집중 모드·기기 알림 설정에 따라 표시가 늦어질 수 있습니다. 서비스 워커는 알림 표시와 클릭 이동만 담당하고 PIN·API·지도·페이지를 캐시하지 않습니다.
- 발송 내용은 등록자 이름과 장소명, 해당 장소의 앱 내부 주소입니다. PIN·토큰·메모·주소·좌표는 알림에 넣지 않습니다.

## 독립 예약 재시도 (R07)

Supabase Cron에서 5분마다 앱의 `POST /api/jobs/push`를 호출합니다. 앱 쿠키나 화면 조회는 필요하지 않습니다. Vercel Hobby의 Cron은 하루 한 번 제한이 있어 이 구현은 Supabase Cron을 사용합니다. [Vercel 제한](https://vercel.com/docs/cron-jobs/usage-and-pricing), [Supabase Cron](https://supabase.com/docs/guides/cron).

1. 004 다음에 `005_reliable_workflows.sql`을 적용하고 앱을 배포합니다.
2. 충분히 긴 무작위 비밀값(32자 이상)을 생성해 서버 환경 변수 `CRON_SECRET`에 저장하고 재배포합니다. 브라우저 공개 변수로 지정하지 않습니다. 보드가 여러 개이면 `APP_BOARD_ID`도 지정합니다.
3. Supabase Vault에 `datemap_app_url`(https://배포주소)과 `datemap_cron_secret`(서버 CRON_SECRET과 같은 값)을 생성합니다. 비밀값은 SQL 파일·Git에 적지 않습니다.
4. Supabase SQL Editor에서 [setup-push-cron.sql](../supabase/setup-push-cron.sql)을 실행합니다. `datemap-push-retry`는 5분마다, `datemap-recover-links`는 1분마다 실행합니다. 같은 이름으로 다시 실행하면 기존 예약을 갱신합니다. [Vault를 이용한 예약 호출](https://supabase.com/docs/guides/functions/schedule-functions).
5. `cron.job`에서 활성 상태와 예약식을, `cron.job_run_details`와 `net._http_response`에서 실행 및 HTTP 200 결과를 확인합니다. 작업 접수만 성공하고 HTTP는 실패할 수도 있으므로 두 결과를 함께 봅니다. 배포 보호가 켜진 환경이면 이 서버 호출을 허용하도록 설정해야 합니다.

예약 API는 비밀키가 없거나 틀리면 401, 설정·DB 조회에 문제가 있으면 503을 반환합니다. 별도의 사용자용 알림 진단 화면(R06)은 추가하지 않습니다. 일시 발송 장애는 기존 발송 큐에 남고 다음 예약이 회수합니다. 24시간이 지난 이벤트와 회수 3회를 소진한 이벤트는 더 보내지 않습니다. 성공한 발송은 다시 회수하지 않습니다. 취소하려면 Supabase Cron에서 두 이름의 작업을 비활성화하거나 `cron.unschedule`로 제거합니다.

## 검증

회귀 테스트는 실제 PostgreSQL 엔진(PGlite)으로 새 저장/중복/롤백, 상대방만 수신, 세션 만료·잠금·인증 버전·기기 주인·다른 보드 분리, 재시도·동시 회수·삭제 후 재등록·브라우저 역할 접근 거절을 확인합니다. API 구독의 Origin·인증·키·외부 URL 제한, 발송 실패의 저장 격리, 서비스 워커 알림 표시·안전한 클릭 이동도 검사합니다.

실제 iPhone PWA의 시스템 권한 창과 잠금 화면 수신은 배포 후 두 실기기에서 확인해야 합니다.

참고: [Apple Web Push 안내](https://webkit.org/blog/13878/), [Next.js PWA 안내](https://nextjs.org/docs/app/guides/progressive-web-apps), [Vercel waitUntil](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package).
