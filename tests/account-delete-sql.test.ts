import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
let pg: PGlite;
const files = ["002_couple_access", "003_board_sync", "004_place_push", "005_reliable_workflows", "006_place_trash", "007_memo_push", "008_memo_push_fixes", "009_source_content_sync", "010_collections", "011_accounts", "012_folders", "013_place_details", "014_profiles", "015_terms"];
const q = async (sql: string, params: unknown[] = []) => (await pg.query<any>(sql, params)).rows;
const one = async (sql: string, params: unknown[] = []) => (await q(sql, params))[0]?.r;
const place = (k: string) => JSON.stringify({ kakao_place_id: k, name: `카페${k}`, address: "서울", lat: 37.5, lng: 127, category: "카페", kakao_url: "https://place.map.kakao.com/1" });
let legacy: string; let pinSessionsBefore = 0;
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec("create role anon; create role authenticated; create role service_role; create function gen_random_bytes(n integer) returns bytea language sql volatile as $$ select decode(substr(repeat(md5(random()::text),4),1,n*2),'hex') $$;");
  await pg.exec(readFileSync("supabase/schema.sql", "utf8").replace("create extension if not exists pgcrypto;", "").split("-- 보드 하나 만들기")[0]);
  for (const f of files) await pg.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"));
  // 016 전 운영 DB처럼: PIN이 걸린 기존 지도와 PIN 세션
  legacy = (await q("insert into boards(name, pin_hash, member_names, auth_version) values('우리 데이트맵','scrypt$aa$bb','{유빈,수민}',2) returning id"))[0].id;
  await q("insert into access_sessions(token_hash,board_id,purpose,member_name,auth_version,expires_at) values('pin1',$1,'member','수민',2,now()+interval '1 day')", [legacy]);
  pinSessionsBefore = (await q("select count(*)::int n from access_sessions where user_id is null"))[0].n;
  const migration = readFileSync("supabase/migrations/016_account_delete_pin_cleanup.sql", "utf8");
  await pg.exec(migration); await pg.exec(migration);
}, 30000);
afterAll(async () => { await pg?.close(); });

it("016은 PIN 세션·PIN 값·PIN 전용 함수와 시도 제한 표를 지운다", async () => {
  expect(pinSessionsBefore).toBe(1);
  expect((await q("select count(*)::int n from access_sessions where user_id is null"))[0].n).toBe(0);
  expect((await q("select pin_hash from boards where id=$1", [legacy]))[0].pin_hash).toBeNull();
  for (const fn of ["dm_configure_access", "dm_reset_pin", "dm_reserve_attempt", "dm_clear_attempt"]) expect((await q("select count(*)::int n from pg_proc where proname=$1", [fn]))[0].n).toBe(0);
  expect((await q("select to_regclass('public.access_limits') t"))[0].t).toBeNull();
});

it("탈퇴하면 혼자 쓰던 폴더는 삭제, 함께 쓰던 폴더는 나가고 방장은 다음 멤버에게 넘어간다", async () => {
  const a = await one("select dm_login('kakao','a',null,'유빈',null) r"); const b = await one("select dm_login('kakao','b',null,'수민',null) r");
  const userA = a.user_id, userB = b.user_id, soloA = a.board_id;
  // 기존 지도: A가 방장, B가 멤버(연결된 상태)
  await q("insert into board_members(board_id,user_id,role,member_name) values($1,$2,'owner','유빈'),($1,$3,'member','수민')", [legacy, userA, userB]);
  await q("update boards set owner_id=$2 where id=$1", [legacy, userA]);
  await q("select dm_save_place($1,$2,'유빈')", [soloA, place("1")]);
  await q("select dm_save_place($1,$2,'유빈')", [legacy, place("2")]);
  await q("select dm_agree_terms($1,'v1',true,true,true,true)", [userA]);
  await q("insert into access_sessions(token_hash,board_id,purpose,member_name,auth_version,expires_at,user_id) values('sa1',$1,'member','유빈',2,now()+interval '1 day',$2),('sa2',null,'member',null,0,now()+interval '1 day',$2),('sb1',$1,'member','수민',2,now()+interval '1 day',$3)", [legacy, userA, userB]);
  await q("insert into push_subscriptions(board_id,session_hash,endpoint,endpoint_hash,p256dh,auth) values($1,'sa1','https://push.test/a','ha','p','a'),($1,'sb1','https://push.test/b','hb','p','a')", [legacy]);

  expect(await one("select dm_delete_account($1) r", [userA])).toEqual({ deleted_folders: 1, left_folders: 1 });

  expect((await q("select id from boards where id=$1", [soloA]))).toHaveLength(0);
  expect((await q("select count(*)::int n from places where board_id=$1", [soloA]))[0].n).toBe(0);
  expect((await q("select user_id, role from board_members where board_id=$1", [legacy]))).toEqual([{ user_id: userB, role: "owner" }]);
  expect((await q("select owner_id, member_names from boards where id=$1", [legacy]))[0]).toEqual({ owner_id: userB, member_names: ["수민"] });
  // 함께 쓰던 폴더의 장소는 남습니다.
  expect((await q("select count(*)::int n from places where board_id=$1", [legacy]))[0].n).toBe(1);
  expect((await q("select token_hash from access_sessions order by token_hash")).map((r) => r.token_hash)).toEqual(["sb1"]);
  expect((await q("select endpoint_hash from push_subscriptions")).map((r) => r.endpoint_hash)).toEqual(["hb"]);
  for (const table of ["app_users", "user_identities", "user_consents"]) expect((await q(`select count(*)::int n from ${table} where ${table === "app_users" ? "id" : "user_id"}=$1`, [userA]))[0].n).toBe(0);
  await expect(q("select dm_delete_account($1)", [userA])).rejects.toThrow("계정을 찾을 수 없어요");
  // 같은 카카오 계정으로 다시 로그인하면 새 계정과 새 내 장소로 시작합니다.
  const again = await one("select dm_login('kakao','a',null,'유빈',null) r");
  expect(again.user_id).not.toBe(userA); expect(again.created).toBe(true);
});

it("마지막 멤버가 탈퇴하면 함께 쓰던 폴더도 지워진다", async () => {
  const b = (await q("select user_id from user_identities where subject='b'"))[0].user_id;
  expect(await one("select dm_delete_account($1) r", [b])).toEqual({ deleted_folders: 2, left_folders: 0 });
  expect((await q("select id from boards where id=$1", [legacy]))).toHaveLength(0);
});
