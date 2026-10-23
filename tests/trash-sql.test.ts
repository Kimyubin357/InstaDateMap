import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, afterAll, expect, it } from "vitest";
let pg: PGlite, id: string;
const board = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const place = { kakao_place_id: "123", name: "어부의딸", address: "서울", lat: 37.5, lng: 127, category: "식당", kakao_url: "" };
const migration = readFileSync("supabase/migrations/006_place_trash.sql", "utf8");
async function change(action: string, expected: string | null = null, b = board) {
  return (await pg.query<any>("select dm_trash_place($1,$2,'유빈',$3,$4) r", [b, id, action, expected])).rows[0].r;
}
async function row() { return (await pg.query<any>("select *,deleted_at::text as stamp from places where id=$1", [id])).rows[0]; }
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec("create role anon; create role authenticated; create role service_role; create function gen_random_bytes(n integer) returns bytea language sql as $$ select decode(repeat('ab',n),'hex') $$;");
  await pg.exec(readFileSync("supabase/schema.sql", "utf8").replace("create extension if not exists pgcrypto;", "").split("-- 보드 하나 만들기")[0]);
  for (const file of ["002_couple_access", "004_place_push", "005_reliable_workflows"]) await pg.exec(readFileSync(`supabase/migrations/${file}.sql`, "utf8"));
  await pg.exec(migration); await pg.exec(migration);
}, 30000);
afterAll(async () => { await pg?.close(); });
beforeEach(async () => {
  await pg.exec("truncate boards cascade");
  for (const b of [board, other]) await pg.query("insert into boards(id,token,name,member_names,auth_version) values($1::uuid,$1::text,'테스트',array['유빈','수민'],1)", [b]);
  const source = (await pg.query<any>("insert into sources(board_id,url,media_type,shared_by,status) values($1,'https://www.instagram.com/p/TRASH/','post','유빈','done') returning id", [board])).rows[0].id;
  id = (await pg.query<any>("select dm_save_place($1,$2,'유빈',$3,null) id", [board, JSON.stringify(place), source])).rows[0].id;
  await pg.query("select dm_save_place($1,$2,'수민',$3,null)", [board, JSON.stringify(place), source]);
  await pg.query("update places set memo='토요일 / 주차 가능',status='again' where id=$1", [id]);
});
it("trash and restore preserve memo, status, both savers and source links without another push", async () => {
  await change("trash"); const deleted = await row();
  expect(deleted.deleted_by).toBe("유빈"); expect(deleted.stamp).toBeTruthy();
  expect((await pg.query("select * from place_saves")).rows).toHaveLength(2);
  expect((await pg.query("select * from source_places")).rows).toHaveLength(2);
  expect((await pg.query("select * from place_push_events")).rows).toHaveLength(0);
  await change("trash"); expect((await row()).stamp).toBe(deleted.stamp);
  await change("restore", deleted.stamp);
  expect(await row()).toMatchObject({ deleted_at: null, memo: "토요일 / 주차 가능", status: "again", memo_version: 2 });
  expect((await pg.query("select * from place_push_events")).rows).toHaveLength(0);
});
it("purge cascades DB place records and leaves original shared source intact", async () => {
  await change("trash"); const stamp = (await row()).stamp;
  expect(await change("purge", stamp)).toMatchObject({ ok: true });
  for (const table of ["places", "place_saves", "source_places", "place_push_events"]) expect((await pg.query(`select * from ${table}`)).rows).toHaveLength(0);
  expect((await pg.query("select * from sources")).rows).toHaveLength(1);
  expect(await change("purge", stamp)).toMatchObject({ ok: true });
  expect(await change("restore", stamp)).toEqual({ code: "PLACE_NOT_FOUND" });
});
it("stale purge cannot remove an active or newly deleted place", async () => {
  expect(await change("purge")).toEqual({ code: "TRASH_CHANGED" });
  await change("trash"); const stamp = (await row()).stamp;
  await change("restore", stamp); expect(await change("purge", stamp)).toEqual({ code: "TRASH_CHANGED" });
  await change("trash"); expect(await change("purge", stamp)).toEqual({ code: "TRASH_CHANGED" });
  expect(await change("restore", stamp)).toEqual({ code: "TRASH_CHANGED" });
  expect(await row()).toBeTruthy();
});
it("other boards and stale memo edits cannot change a trashed place", async () => {
  await change("trash", null, other); expect((await row()).deleted_at).toBeNull();
  await change("trash");
  expect((await pg.query<any>("select dm_patch_place($1,$2,'수민','{\"memo\":\"덮어쓰기\"}',0) r", [board, id])).rows[0].r.code).toBe("PLACE_NOT_FOUND");
  await expect(pg.query("select dm_save_place($1,$2,'수민')", [board, JSON.stringify(place)])).rejects.toThrow("먼저 복구");
  expect((await row()).memo).toBe("토요일 / 주차 가능");
});
it("links to trash guide restoration and permanent deletion permits registering anew", async () => {
  const begin = async () => (await pg.query<any>("select dm_begin_source($1,'https://www.instagram.com/p/TRASH/','post','유빈','a',false) r", [board])).rows[0].r;
  await change("trash"); expect((await begin()).outcome).toBe("trashed");
  await change("purge", (await row()).stamp); expect((await begin()).outcome).toBe("started");
});
