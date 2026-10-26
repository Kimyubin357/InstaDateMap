import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, afterAll, expect, it } from "vitest";
let pg: PGlite;
const board = "10000000-0000-4000-8000-000000000001", other = "10000000-0000-4000-8000-000000000002";
let p1: string, p2: string, foreign: string;
const migration = readFileSync("supabase/migrations/010_collections.sql", "utf8");
async function change(command: object, op = randomUUID(), b = board) {
  return (await pg.query<any>("select dm_change_collection($1,'유빈',$2,$3) r", [b, op, JSON.stringify(command)])).rows[0].r;
}
function create(id = randomUUID(), name = "부산 주말") { return { action: "create", id, name, description: "바다 보러", color: "red", icon: "map" }; }
async function rows(table: string) { return (await pg.query<any>(`select * from ${table}`)).rows; }
async function revision() { return (await pg.query<any>("select dm_board_revision($1) r", [board])).rows[0].r; }
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec("create role anon; create role authenticated; create role service_role; create function gen_random_bytes(n integer) returns bytea language sql as $$ select decode(repeat('ab',n),'hex') $$;");
  await pg.exec(readFileSync("supabase/schema.sql", "utf8").replace("create extension if not exists pgcrypto;", "").split("-- 보드 하나 만들기")[0]);
  for (const file of ["002_couple_access","003_board_sync","004_place_push","005_reliable_workflows","006_place_trash","007_memo_push","008_memo_push_fixes","009_source_content_sync"]) await pg.exec(readFileSync(`supabase/migrations/${file}.sql`,"utf8"));
  await pg.exec(migration); await pg.exec(migration);
}, 30000);
afterAll(async () => { await pg?.close(); });
beforeEach(async () => {
  await pg.exec("truncate boards cascade");
  for (const b of [board,other]) await pg.query("insert into boards(id,token,name,member_names) values($1::uuid,$1::text,'테스트',array['유빈','수민'])",[b]);
  async function place(b: string, name: string) { return (await pg.query<any>("insert into places(board_id,name,kakao_place_id,address,lat,lng) values($1,$2,$2,'부산',35,129) returning id",[b,name])).rows[0].id; }
  p1 = await place(board,"카페"); p2 = await place(board,"서점"); foreign = await place(other,"다른 보드");
});
it("creates, validates duplicate names and protects concurrent edits with versions", async () => {
  const c = create(); expect(await change(c)).toMatchObject({ok:true,id:c.id});
  expect(await change(create(undefined,"  부산   주말 "))).toEqual({code:"COLLECTION_NAME_EXISTS"});
  expect(await change({...c,action:"update",version:1,name:"주말"})).toMatchObject({ok:true});
  expect(await change({...c,action:"update",version:1,name:"덮어쓰기"})).toEqual({code:"COLLECTION_CONFLICT"});
  expect((await rows("collections"))[0]).toMatchObject({name:"주말",version:2});
});
it("receipt replay cannot duplicate or resurrect a deleted collection", async () => {
  const c=create(), op=randomUUID(); const first=await change(c,op); const rev=await revision();
  expect(await change(c,op)).toEqual(first); expect(await revision()).toBe(rev);
  expect(await change({...c,name:"다름"},op)).toEqual({code:"OPERATION_MISMATCH"});
  await change({action:"delete",id:c.id,version:1});
  expect(await change(c,op)).toEqual(first); expect(await rows("collections")).toHaveLength(0);
});
it("adds many-to-many memberships atomically, rejects other boards and trashed places", async () => {
  const a=create(), b=create(undefined,"비 오는 날"); await change(a); await change(b);
  const before=await revision();
  expect(await change({action:"add",collection_ids:[a.id,b.id],place_ids:[p1,p2]})).toMatchObject({changed:4});
  expect(BigInt(await revision())).toBeGreaterThan(BigInt(before));
  expect(await change({action:"add",collection_ids:[a.id,b.id],place_ids:[p1,p2]})).toMatchObject({changed:0});
  expect(await change({action:"add",collection_ids:[a.id],place_ids:[p1,foreign]})).toEqual({code:"COLLECTION_PLACE_CHANGED"});
  expect(await rows("collection_places")).toHaveLength(4);
  expect(await change({action:"delete",id:a.id,version:1},undefined,other)).toEqual({code:"COLLECTION_NOT_FOUND"});
  await expect(pg.query("insert into collection_places(board_id,collection_id,place_id) values($1,$2,$3)",[board,a.id,foreign])).rejects.toThrow();
  await pg.query("update places set deleted_at=now() where id=$1",[p1]);
  expect(await change({action:"add",collection_ids:[a.id],place_ids:[p1]})).toEqual({code:"COLLECTION_PLACE_CHANGED"});
});
it("deleting a collection preserves saved places and memo; trash restores membership and purge removes it", async () => {
  const a=create(), b=create(undefined,"맛집");await change(a);await change(b);
  await change({action:"add",collection_ids:[a.id,b.id],place_ids:[p1]});
  await pg.query("update places set memo='메모',deleted_at=now() where id=$1",[p1]);
  expect(await rows("collection_places")).toHaveLength(2);
  await pg.query("update places set deleted_at=null where id=$1",[p1]);
  await change({action:"delete",id:a.id,version:1});
  expect(await rows("places")).toHaveLength(3);expect((await rows("places")).find(p=>p.id===p1).memo).toBe("메모");
  expect(await rows("collection_places")).toHaveLength(1);
  await pg.query("delete from places where id=$1",[p1]);expect(await rows("collection_places")).toHaveLength(0);
});
it("undo touches only memberships created by this action, respects partner re-adds and cannot repeat", async () => {
  const c=create();await change(c);
  await change({action:"add",collection_ids:[c.id],place_ids:[p1]});
  const add=await change({action:"add",collection_ids:[c.id],place_ids:[p1,p2]});
  await change({action:"remove",collection_ids:[c.id],place_ids:[p2]});
  await change({action:"add",collection_ids:[c.id],place_ids:[p2]});
  expect(await change({action:"undo",target:add.operation_id})).toMatchObject({changed:0});
  expect(await rows("collection_places")).toHaveLength(2);
  expect(await change({action:"undo",target:add.operation_id})).toEqual({code:"UNDO_UNAVAILABLE"});
  const removal=await change({action:"remove",collection_ids:[c.id],place_ids:[p1,p2]});
  expect(await rows("collection_places")).toHaveLength(0);
  expect(await change({action:"undo",target:removal.operation_id})).toMatchObject({changed:2});
  const removal2=await change({action:"remove",collection_ids:[c.id],place_ids:[p1]});
  await change({action:"delete",id:c.id,version:1});
  expect(await change({action:"undo",target:removal2.operation_id})).toEqual({code:"UNDO_UNAVAILABLE"});
});
it("limits and table privileges reject malformed requests and direct public access",async()=>{
  expect(await change({...create(),name:" "})).toEqual({code:"INVALID_COMMAND"});
  expect(await change({...create(),color:"injected"})).toEqual({code:"INVALID_COMMAND"});
  expect(await change({action:"add",collection_ids:[],place_ids:[p1]})).toEqual({code:"INVALID_COMMAND"});
  await pg.exec("set role anon");
  try { await expect(pg.query("select * from collections")).rejects.toThrow("permission denied"); await expect(change(create())).rejects.toThrow("permission denied"); }
  finally { await pg.exec("reset role"); }
});
