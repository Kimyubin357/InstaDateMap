#!/usr/bin/env bash
# 기존 Supabase 프로젝트(시드니) → 새 Supabase 프로젝트(서울)로 구조와 데이터를 옮깁니다.
# 절차: docs/supabase-seoul-move.md
# - 비밀번호가 든 접속 주소는 화면에 보이지 않게 입력받고, 파일·셸 기록에 남기지 않습니다.
# - 새 프로젝트는 비어 있어야 합니다. 기존 프로젝트는 읽기만 합니다(마지막 예약 작업 끄기는 물어본 뒤에만).
set -euo pipefail
cd "$(dirname "$0")/.."

if command -v pg_dump >/dev/null 2>&1 && command -v psql >/dev/null 2>&1; then PGBIN=""
elif [ -x "$(brew --prefix libpq 2>/dev/null)/bin/pg_dump" ]; then PGBIN="$(brew --prefix libpq)/bin/"
else echo "pg_dump·psql이 없어요. 먼저 터미널에서 brew install libpq 를 실행해 주세요."; exit 1; fi
run_psql() { "${PGBIN}psql" -X -v ON_ERROR_STOP=1 "$@"; }

echo "Supabase 대시보드 → Connect → Session pooler 의 접속 주소(비밀번호 포함)를 붙여 넣어 주세요. 입력한 글자는 보이지 않아요."
read -rsp "기존(시드니) 프로젝트 접속 주소: " OLD_DB; echo
read -rsp "새(서울) 프로젝트 접속 주소: " NEW_DB; echo
[ -n "$OLD_DB" ] && [ -n "$NEW_DB" ] || { echo "접속 주소가 비어 있어요."; exit 1; }
[ "$OLD_DB" != "$NEW_DB" ] || { echo "두 주소가 같아요. 새 프로젝트의 주소를 넣어 주세요."; exit 1; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

echo "1/6 연결 확인"
run_psql "$OLD_DB" -Atqc "select 'old ' || current_setting('server_version')"
run_psql "$NEW_DB" -Atqc "select 'new ' || current_setting('server_version')"
if [ "$(run_psql "$OLD_DB" -Atqc "select count(*) from pg_proc where proname='dm_delete_account'")" = "0" ]; then
  echo "기존 프로젝트에 016_account_delete_pin_cleanup.sql 이 아직 없어요. 기존 프로젝트 SQL Editor에서 016을 먼저 실행한 뒤 다시 실행해 주세요."; exit 1
fi
NEW_TABLES="$(run_psql "$NEW_DB" -Atqc "select count(*) from information_schema.tables where table_schema='public'")"
[ "$NEW_TABLES" = "0" ] || { echo "새 프로젝트의 public에 이미 표가 ${NEW_TABLES}개 있어요. 비어 있는 새 프로젝트에서만 실행해 주세요."; exit 1; }

echo "2/6 새 프로젝트에 구조 만들기(schema.sql + migrations 002~)"
awk '/-- 보드 하나 만들기/{exit} {print}' supabase/schema.sql > "$TMP/schema.sql"
run_psql "$NEW_DB" -q -f "$TMP/schema.sql"
for f in supabase/migrations/0*.sql; do echo "   $f"; run_psql "$NEW_DB" -q -f "$f"; done
# 새 프로젝트에서 'Grant API access to new tables automatically'를 끈 경우에도 서버(service_role)는 모든 표·함수를 쓸 수 있어야 합니다.
# 브라우저용 anon·authenticated 키에는 권한을 주지 않습니다(앱은 서버의 service_role만 씁니다).
run_psql "$NEW_DB" -q -c "grant usage on schema public to service_role;
  grant all on all tables in schema public to service_role;
  grant all on all sequences in schema public to service_role;
  grant execute on all functions in schema public to service_role;"

echo "3/6 기존 프로젝트와 구조 비교(표·칸·함수)"
SHAPE="select table_name||'.'||column_name||':'||data_type from information_schema.columns where table_schema='public'
  union all select 'fn:'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  order by 1"
run_psql "$OLD_DB" -Atqc "$SHAPE" > "$TMP/old-shape"
run_psql "$NEW_DB" -Atqc "$SHAPE" > "$TMP/new-shape"
if ! diff "$TMP/old-shape" "$TMP/new-shape" > "$TMP/shape-diff"; then
  echo "구조가 달라요(< 기존에만 있음, > 새 프로젝트에만 있음):"; cat "$TMP/shape-diff"
  read -rp "이대로 데이터를 옮길까요? 기존에만 있는 표의 데이터는 옮겨지지 않아요. (y/N) " GO; [ "$GO" = "y" ] || exit 1
fi

echo "4/6 데이터 복사(이 동안 앱에서 저장하지 마세요)"
"${PGBIN}pg_dump" "$OLD_DB" --data-only --schema=public --no-owner --no-privileges --quote-all-identifiers -f "$TMP/data.sql"
# 최신 pg_dump가 넣는 설정 중 Supabase(Postgres 15·17)가 모르는 줄은 빼고 적용합니다.
grep -v -E '^SET (transaction_timeout|lock_timeout_scope)' "$TMP/data.sql" > "$TMP/data-clean.sql"
run_psql "$NEW_DB" -q --single-transaction -c "set session_replication_role = replica" -f "$TMP/data-clean.sql"

echo "5/6 표마다 행 수 비교"
COUNTS="select table_name || '=' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text
  from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name"
run_psql "$OLD_DB" -Atqc "$COUNTS" > "$TMP/old-counts"
run_psql "$NEW_DB" -Atqc "$COUNTS" > "$TMP/new-counts"
if diff "$TMP/old-counts" "$TMP/new-counts"; then echo "   모든 표의 행 수가 같아요: $(tr '\n' ' ' < "$TMP/new-counts")"
else echo "행 수가 달라요. 위 차이를 확인해 주세요. 앱 환경 변수는 아직 바꾸지 마세요."; exit 1; fi

echo "6/6 기존 프로젝트의 예약 작업(알림 재시도·링크 복구)"
read -rp "기존 프로젝트의 예약 작업을 끌까요? 환경 변수를 새 프로젝트로 바꾸기 직전에 끄는 게 좋아요. (y/N) " STOP
if [ "$STOP" = "y" ]; then
  run_psql "$OLD_DB" -Atqc "select cron.unschedule(jobname) from cron.job where jobname in ('datemap-push-retry','datemap-recover-links')" || echo "   예약 작업이 없거나 끄지 못했어요(대시보드 Integrations → Cron에서 확인)."
fi
echo "완료. 이제 docs/supabase-seoul-move.md 의 '데이터를 옮긴 뒤' 단계를 진행해 주세요."
