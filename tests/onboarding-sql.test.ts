import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// 021: 처음 사용법(온보딩)을 본 기록. 계정마다 한 번, 처음 본 시각을 지키고, 이미 쓰던 계정도 한 번 보게 됩니다.
let pg: PGlite;
const files = ["002_couple_access", "003_board_sync", "004_place_push", "005_reliable_workflows", "006_place_trash", "007_memo_push", "008_memo_push_fixes", "009_source_content_sync", "010_collections", "011_accounts", "012_folders", "013_place_details", "014_profiles", "015_terms", "016_account_delete_pin_cleanup", "017_folder_transfer_push", "018_room_look", "019_user_id_records", "020_place_seen"];
const q = async (sql: string, params: unknown[] = []) => (await pg.query<any>(sql, params)).rows;
const one = async (sql: string, params: unknown[] = []) => (await q(sql, params))[0]?.r;
const state = (user: string) => one("select dm_onboarding_state($1) r", [user]);
const mark = (user: string) => one("select dm_mark_onboarded($1) r", [user]);
let before: string;

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec("create role anon; create role authenticated; create role service_role; create function gen_random_bytes(n integer) returns bytea language sql volatile as $$ select decode(substr(repeat(md5(random()::text),4),1,n*2),'hex') $$;");
  await pg.exec(readFileSync("supabase/schema.sql", "utf8").replace("create extension if not exists pgcrypto;", "").split("-- 보드 하나 만들기")[0]);
  for (const f of files) await pg.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"));
  // 021 전에 이미 쓰던 계정
  before = (await one("select dm_login('kakao','old',null,'유빈',null) r")).user_id;
  await expect(q("select dm_onboarding_state($1)", [before])).rejects.toThrow(); // 021 전에는 함수가 없음(API는 "모름"으로 답함)
  const migration = readFileSync("supabase/migrations/021_onboarding.sql", "utf8");
  await pg.exec(migration); await pg.exec(migration); // 두 번 실행해도 같은 결과
}, 30000);
afterAll(async () => { await pg?.close(); });

describe("021 온보딩 기록", () => {
  it("칸은 비어 있을 수 있는 시각이고, 이미 쓰던 계정도 비어 있어 배포 뒤 한 번 보게 된다", async () => {
    const col = (await q("select data_type, is_nullable, column_default from information_schema.columns where table_name = 'app_users' and column_name = 'onboarded_at'"))[0];
    expect(col).toEqual({ data_type: "timestamp with time zone", is_nullable: "YES", column_default: null });
    expect(await state(before)).toEqual({ onboarded_at: null });
  });

  it("새 계정도 비어 있고, 보면 시각이 남으며 두 번째부터는 처음 시각을 지킨다", async () => {
    const u = (await one("select dm_login('google','new',null,'수민',null) r")).user_id;
    expect(await state(u)).toEqual({ onboarded_at: null });
    const first = (await mark(u)).onboarded_at;
    expect(typeof first).toBe("string");
    expect((await state(u)).onboarded_at).toBe(first);
    await q("update app_users set onboarded_at = onboarded_at - interval '1 day' where id = $1", [u]);
    const kept = (await state(u)).onboarded_at;
    expect((await mark(u)).onboarded_at).toBe(kept);
    // 다른 계정에는 영향이 없다
    expect(await state(before)).toEqual({ onboarded_at: null });
  });

  it("없는 계정은 null이고, 탈퇴해도 다른 기록을 막지 않는다", async () => {
    const ghost = "00000000-0000-4000-8000-000000000099";
    expect(await state(ghost)).toBeNull();
    expect(await mark(ghost)).toBeNull();
    const u = (await one("select dm_login('kakao','bye',null,'민호',null) r")).user_id;
    await mark(u);
    await q("delete from app_users where id = $1", [u]);
    expect(await state(u)).toBeNull();
  });

  it("anon·authenticated는 함수를 쓸 수 없다", async () => {
    for (const fn of ["dm_onboarding_state(uuid)", "dm_mark_onboarded(uuid)"]) {
      for (const role of ["anon", "authenticated"]) expect(await one(`select has_function_privilege('${role}', 'public.${fn}', 'execute') r`)).toBe(false);
      expect(await one(`select has_function_privilege('service_role', 'public.${fn}', 'execute') r`)).toBe(true);
    }
  });
});
