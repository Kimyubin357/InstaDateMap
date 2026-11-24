import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
let pg: PGlite;
const files = ["002_couple_access", "003_board_sync", "004_place_push", "005_reliable_workflows", "006_place_trash", "007_memo_push", "008_memo_push_fixes", "009_source_content_sync", "010_collections", "011_accounts", "012_folders", "014_profiles"];
const one = async (sql: string, params: unknown[] = []) => (await pg.query<any>(sql, params)).rows[0]?.r;
const rows = async (sql: string, params: unknown[] = []) => (await pg.query<any>(sql, params)).rows;
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec("create role anon; create role authenticated; create role service_role; create function gen_random_bytes(n integer) returns bytea language sql volatile as $$ select decode(substr(repeat(md5(random()::text),4),1,n*2),'hex') $$;");
  await pg.exec(readFileSync("supabase/schema.sql", "utf8").replace("create extension if not exists pgcrypto;", "").split("-- 보드 하나 만들기")[0]);
  for (const f of files) await pg.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"));
  const migration = readFileSync("supabase/migrations/015_terms.sql", "utf8");
  await pg.exec(migration); await pg.exec(migration);
}, 30000);
afterAll(async () => { await pg?.close(); });
beforeEach(async () => { await pg.exec("truncate boards, app_users cascade"); });
const user = async () => (await one("select dm_login('kakao','s1',null,'유빈',null) r")).user_id;

it("새 계정은 약관 동의 전이고, 필수 3개 중 하나라도 빠지면 저장하지 않는다", async () => {
  const u = await user();
  expect(await one("select dm_terms_state($1) r", [u])).toMatchObject({ terms_version: null, marketing: false });
  await expect(one("select dm_agree_terms($1,'2026-11-24',true,true,false,true) r", [u])).rejects.toThrow("필수 약관");
  expect(await rows("select * from user_consents")).toEqual([]);
  expect(await one("select dm_agree_terms($1,'2026-11-24',true,true,true,false) r", [u])).toEqual({ terms_version: "2026-11-24", marketing: false });
  expect(await one("select dm_terms_state($1) r", [u])).toMatchObject({ terms_version: "2026-11-24", marketing: false });
});

it("광고성 정보 수신은 설정에서 켜고 끌 수 있고, 모든 동의·철회가 이력으로 남는다", async () => {
  const u = await user();
  await one("select dm_agree_terms($1,'2026-11-24',true,true,true,true) r", [u]);
  expect((await one("select dm_set_marketing($1,false) r", [u])).marketing).toBe(false);
  expect((await one("select dm_terms_state($1) r", [u])).marketing).toBe(false);
  expect((await rows("select marketing from user_consents where user_id=$1 order by created_at", [u])).map((r) => r.marketing)).toEqual([true, false]);
  await pg.query("delete from app_users where id=$1", [u]);
  expect(await rows("select * from user_consents")).toEqual([]);
});
