# Supabase·Vercel 서울 이전 절차

작성: 2026-11-24. 지금 DB는 Supabase **ap-southeast-2(시드니)**, 서버 함수는 Vercel **iad1(미국 동부)** 에 있습니다. 둘 사이가 멀어 요청마다 태평양을 여러 번 오갑니다. 둘 다 **서울**로 옮깁니다.

- **Vercel**: 이 브랜치의 `vercel.json`(`"regions": ["icn1"]`)이 배포되면 서버 함수가 서울에서 돌아갑니다.
- **Supabase**: 기존 프로젝트의 지역은 바꿀 수 없습니다. 서울에 새 프로젝트를 만들고 구조와 데이터를 옮긴 뒤, 앱의 접속 정보를 바꿉니다.
- 약관(개인정보 처리방침 5항)도 서울 기준으로 고쳐 두었습니다. **이 PR은 아래 이전을 마친 뒤 머지합니다.** 이전 전에 머지하면 처리방침과 실제 서버 지역이 달라집니다.

비밀번호·서비스 키는 대화·파일·Git에 붙여 넣지 말고 대시보드와 본인 터미널에서만 다룹니다.

## 준비 (5분)

1. **기존(시드니) 프로젝트 SQL Editor**에서 `supabase/migrations/016_account_delete_pin_cleanup.sql`을 실행합니다. 이전 스크립트가 016 적용 여부를 확인합니다.
2. Supabase 대시보드에서 **New project**를 만듭니다.
   - Region: **Auto가 아니라** 아래 "Need a specific region?"을 눌러 **Northeast Asia (Seoul)** 를 고릅니다.
   - Data access: **Enable Data API는 켜고**(앱이 이 API로 DB에 접근합니다), "Grant API access to new tables automatically"는 꺼 둡니다(이전 스크립트가 서버 키에만 권한을 줍니다). "Enable RLS on new tables automatically"는 켜도 됩니다.
   - 데이터베이스 비밀번호는 새로 만들어 비밀번호 관리자에 보관합니다.
   - 무료 요금제는 활성 프로젝트가 2개까지라, 기존 프로젝트는 이전이 끝날 때까지 그대로 둡니다.
3. 터미널에서 PostgreSQL 도구를 설치합니다.

   ```bash
   brew install libpq
   ```

4. 두 프로젝트의 **Connect → Session pooler** 접속 주소를 준비합니다.
   - `postgresql://postgres.<프로젝트>:<비밀번호>@aws-0-<지역>.pooler.supabase.com:5432/postgres` 형식입니다.
   - Direct connection 주소는 IPv6 전용이라 집 인터넷에서 연결되지 않을 수 있습니다.

## 데이터 옮기기 (2~3분, 이 동안 앱 사용 멈춤)

수민님께도 몇 분 동안 앱에서 저장하지 말아 달라고 알립니다. 그다음 실행합니다.

```bash
./scripts/move-supabase.sh
```

스크립트는 아래 순서로 진행합니다.
1. 두 프로젝트 연결을 확인하고, 새 프로젝트가 비어 있는지 확인합니다.
2. 새 프로젝트에 `schema.sql`(첫 보드 만들기 전까지)과 `migrations/002~016`을 순서대로 적용합니다.
3. 기존·새 프로젝트의 표·칸·함수 구성을 비교하고, 다르면 멈춰서 물어봅니다.
4. 기존 데이터를 복사합니다. 복사하는 동안에는 트리거를 끕니다(`session_replication_role = replica`).
5. 표마다 행 수가 같은지 비교하고, 하나라도 다르면 멈춥니다.
6. 기존 프로젝트의 예약 작업(알림 재시도·링크 복구)을 끌지 물어봅니다.

로그인 세션도 함께 옮겨서, 이전이 끝나도 다시 로그인할 필요가 없습니다.

## 데이터를 옮긴 뒤

1. **새 프로젝트 Vault**(Project Settings → Vault)에 두 값을 만듭니다. 기존 프로젝트와 같은 값이며, [알림 설정](push-notifications.md)을 참고합니다.
   - `datemap_app_url`
   - `datemap_cron_secret`
2. **새 프로젝트 SQL Editor**에서 `supabase/setup-push-cron.sql`을 실행합니다. 알림 재시도와 링크 복구 예약 작업이 만들어집니다.
3. **Vercel → Project → Settings → Environment Variables**에서 두 값을 새 프로젝트 것으로 바꿉니다. Production·Preview·Development 모두 바꿉니다.
   - `SUPABASE_URL`: 새 프로젝트의 Project URL(`https://<새 프로젝트>.supabase.co`). 끝에 `/rest/v1/`를 붙이지 않습니다.
   - `SUPABASE_SERVICE_ROLE_KEY`: 새 프로젝트의 service_role 키(Project Settings → API Keys)
4. 이 PR을 머지합니다. 함수 지역(서울)과 약관 지역 수정이 함께 배포되고, 바뀐 환경 변수도 이 배포부터 적용됩니다.
5. 로컬 환경도 새 값으로 받습니다.

   ```bash
   npx vercel env pull .env.local
   ```

## 확인

- 앱에서 지도·장소·메모·폴더·프로필이 그대로 보이는지 확인합니다.
- 장소를 하나 저장하고 상대 기기에 알림이 오는지 확인합니다.
- Vercel 응답 헤더 `x-vercel-id`가 `icn1::icn1::…`처럼 두 번째 칸이 `icn1`인지 확인합니다. 지금은 `icn1::iad1`입니다.
- 일주일 정도 문제가 없으면 기존(시드니) 프로젝트를 **Pause**합니다. 그 뒤 필요 없으면 삭제합니다. 삭제는 되돌릴 수 없습니다.

## 되돌리기

새 프로젝트에서 문제가 생기면 Vercel 환경 변수를 기존 프로젝트 값으로 되돌리고 재배포합니다. 그리고 기존 프로젝트 SQL Editor에서 `setup-push-cron.sql`을 다시 실행해 예약 작업을 켭니다. 이전 뒤에 새 프로젝트에만 저장된 데이터는 기존 프로젝트에 없으니 주의합니다.
