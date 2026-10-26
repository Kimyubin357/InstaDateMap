import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, afterAll, expect, it } from "vitest";
let pg: PGlite;
const board = "10000000-0000-4000-8000-000000000001";
const place = "20000000-0000-4000-8000-000000000001";
const migration = readFileSync("supabase/migrations/007_memo_push.sql", "utf8");
async function patch(memo: string, version = 0, who = "유빈") {
  return (await pg.query<any>("select dm_patch_place($1,$2,$3,$4,$5) r", [board, place, who, JSON.stringify({ memo }), version])).rows[0].r;
}
async function events() { return (await pg.query<any>("select * from place_push_events")).rows; }
async function claim() { return (await pg.query<any>("select * from dm_claim_push_deliveries($1)", [board])).rows; }
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec("create role anon; create role authenticated; create role service_role; create function gen_random_bytes(n integer) returns bytea language sql as $$ select decode(repeat('ab',n),'hex') $$;");
  await pg.exec(readFileSync("supabase/schema.sql", "utf8").replace("create extension if not exists pgcrypto;", "").split("-- 보드 하나 만들기")[0]);
  for (const name of ["002_couple_access", "004_place_push", "005_reliable_workflows", "006_place_trash"]) await pg.exec(readFileSync(`supabase/migrations/${name}.sql`, "utf8"));
  await pg.exec(migration); await pg.exec(migration);
}, 30000);
afterAll(async () => { await pg?.close(); });
beforeEach(async () => {
  await pg.exec("truncate boards cascade");
  await pg.query("insert into boards(id,name,member_names,auth_version) values($1,'검증',array['유빈','수민'],1)", [board]);
  await pg.query("insert into places(id,board_id,kakao_place_id,name,lat,lng) values($1,$2,'1','우리 카페',37,127)", [place, board]);
  await pg.query("insert into access_sessions(token_hash,board_id,purpose,member_name,auth_version,expires_at) values('a',$1,'member','유빈',1,now()+interval '1 day'),('a2',$1,'member','유빈',1,now()+interval '1 day'),('b',$1,'member','수민',1,now()+interval '1 day')", [board]);
  await pg.query("insert into push_subscriptions(endpoint_hash,endpoint,p256dh,auth,board_id,session_hash,created_at) select s,s,'key','auth',$1,s,now()-interval '1 minute' from unnest(array['a','a2','b']) s", [board]);
});
it("새 메모는 상대방에게만, 수정은 반대편의 모든 기기에 알림", async () => {
  expect(await patch("창가 자리")).toMatchObject({ ok: true, memo_changed: true, memo_version: 1 });
  expect(await events()).toHaveLength(1);
  expect((await claim()).map((j) => [j.endpoint, j.event_kind])).toEqual([["b", "memo_added"]]);
  expect(await claim()).toHaveLength(0);
  await patch("주말에 가자", 1, "수민");
  expect((await claim()).map((j) => [j.endpoint, j.event_kind]).sort()).toEqual([["a", "memo_updated"], ["a2", "memo_updated"]]);
  expect(JSON.stringify(await events())).not.toContain("주말에 가자");
});
it("동일 메모·상태만 수정·충돌·삭제된 장소·재전송은 새 알림을 만들지 않음", async () => {
  await patch("메모");
  expect(await patch("메모", 1)).toMatchObject({ memo_changed: false });
  expect(await patch("재전송", 0)).toMatchObject({ code: "MEMO_CONFLICT" });
  await pg.query("select dm_patch_place($1,$2,'유빈','{\"status\":\"visited\"}',null)", [board, place]);
  expect(await events()).toHaveLength(1);
  await pg.query("select dm_trash_place($1,$2,'유빈','trash')", [board, place]);
  expect(await patch("삭제 후", 3)).toMatchObject({ code: "PLACE_NOT_FOUND" });
  expect(await events()).toHaveLength(0);
});
it("내용 삭제도 수정 알림이며 빈 내용을 다시 저장하면 알리지 않음", async () => {
  await patch("있던 메모"); await patch("", 1);
  expect((await events()).map((e) => e.event_kind).sort()).toEqual(["memo_added", "memo_updated"]);
  await patch("", 2); expect(await events()).toHaveLength(2);
});
it("알림 기록에 실패하면 메모까지 함께 롤백", async () => {
  await pg.exec("create function test_push_fail() returns trigger language plpgsql as $$ begin raise exception 'push record failure'; end $$; create trigger test_fail before insert on place_push_events for each row execute function test_push_fail();");
  try {
    await expect(patch("저장 시도")).rejects.toThrow("push record failure");
    expect((await pg.query<any>("select memo_version from places")).rows[0].memo_version).toBe(0);
    expect(await events()).toHaveLength(0);
  } finally { await pg.exec("drop trigger test_fail on place_push_events; drop function test_push_fail()"); }
});
it("권한 만료 후에는 메모 알림도 발송하지 않음", async () => {
  await patch("메모");
  await pg.exec("update access_sessions set expires_at=now()-interval '1 second' where token_hash='b'");
  expect(await claim()).toHaveLength(0);
});
