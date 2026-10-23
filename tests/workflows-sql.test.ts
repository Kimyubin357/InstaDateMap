import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
let pg: PGlite;
const board = "10000000-0000-4000-8000-000000000001";
const place = { kakao_place_id: "123", name: "어부의딸", address: "서울", lat: 37.5, lng: 127, category: "식당", kakao_url: "" };
const rows = [{ module: "caption", raw_name: place.name, confidence: 0.8, candidates: [place] }];
const migration = readFileSync("supabase/migrations/005_reliable_workflows.sql", "utf8");
async function begin(owner = "a", retry = false) {
  return (await pg.query<any>("select dm_begin_source($1,'https://www.instagram.com/reel/ABC/','reel','유빈',$2,$3) as r", [board, owner, retry])).rows[0].r;
}
async function finish(s: any, owner = "a", status = "pending_confirm", auto = false) {
  return (await pg.query<any>("select dm_finish_analysis($1,$2,$3,$4,$5,'원문','manual',null,$6,$7,'유빈',null) as r", [board, s.id, owner, s.analysis_version, status, JSON.stringify(rows), auto])).rows[0].r;
}
async function session(s: any, owner: string, action: string) {
  return (await pg.query<any>("select dm_source_session($1,$2,$3,$4,$5) as r", [board, s.id, owner, s.analysis_version, action])).rows[0].r;
}
async function source() { return (await pg.query<any>("select * from sources")).rows[0]; }
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec("create role anon; create role authenticated; create role service_role; create function gen_random_bytes(n integer) returns bytea language sql as $$ select decode(repeat('ab',n),'hex') $$;");
  await pg.exec(readFileSync("supabase/schema.sql", "utf8").replace("create extension if not exists pgcrypto;", "").split("-- 보드 하나 만들기")[0]);
  await pg.exec(readFileSync("supabase/migrations/002_couple_access.sql", "utf8"));
  await pg.exec(readFileSync("supabase/migrations/004_place_push.sql", "utf8"));
  await pg.exec(migration); await pg.exec(migration);
}, 30000);
afterAll(async () => { await pg?.close(); });
beforeEach(async () => {
  await pg.exec("truncate boards cascade");
  await pg.query("insert into boards(id,name,member_names,auth_version) values($1,'테스트',array['유빈','수민'],1)", [board]);
});
describe("링크 작업의 DB 소유권과 복구", () => {
  it("동시에 같은 링크를 시작하면 첫 요청만 수락", async () => {
    const results = await Promise.all([begin("a"), begin("b")]);
    expect(results.map((r) => r.outcome)).toEqual(["started", "busy"]);
    expect((await pg.query("select id from sources")).rows).toHaveLength(1);
    expect((await begin("a", true)).outcome).toBe("busy");
  });
  it("지점 선택 중 두 번째 분석·선택·제외를 차단하고 후보를 보존", async () => {
    const { source: s } = await begin(); await finish(s);
    const before = (await pg.query("select * from extractions")).rows;
    expect((await begin("b", true)).outcome).toBe("busy");
    expect(await session(s, "b", "claim")).toMatchObject({ code: "SOURCE_BUSY" });
    expect(await session(s, "b", "dismiss")).toMatchObject({ code: "SOURCE_BUSY" });
    expect((await pg.query("select * from extractions")).rows).toEqual(before);
  });
  it("선택 화면을 떠나면 다른 사람이 같은 주소로 새 작업 가능", async () => {
    const { source: s } = await begin(); await finish(s); await session(s, "a", "release");
    const next = await begin("b"); expect(next.outcome).toBe("started");
    expect(next.source.analysis_version).not.toBe(s.analysis_version);
    expect(await session(s, "a", "claim")).toMatchObject({ code: "SOURCE_STALE" });
    await session(s, "a", "release"); expect((await source()).work_owner).toBe("b");
  });
  it("강제 종료 후 만료 작업을 대기함으로 복구하고 늦은 완료를 거부", async () => {
    const { source: s } = await begin();
    await pg.exec("update sources set work_until=now()-interval '1 second'");
    await pg.query("select dm_recover_sources($1)", [board]);
    expect(await source()).toMatchObject({ status: "needs_review", recovery_reason: "interrupted", work_owner: null });
    await expect(finish(s)).rejects.toThrow("SOURCE_STALE");
    expect((await pg.query("select id from places")).rows).toHaveLength(0);
  });
  it("기존 processing 행도 만료 시 복구하고 아직 살아 있는 작업은 유지", async () => {
    await begin(); await pg.query("select dm_recover_sources($1)", [board]); expect((await source()).status).toBe("processing");
    await pg.exec("update sources set work_until=null,shared_at=now()-interval '2 minutes'");
    await pg.query("select dm_recover_sources($1)", [board]); expect((await source()).status).toBe("needs_review");
  });
  it("새 작업 중에는 이전 후보가 남고 결과를 커밋할 때만 교체", async () => {
    const { source: s } = await begin(); await finish(s); await session(s, "a", "release");
    const old = (await pg.query("select id from extractions")).rows[0];
    const next = await begin("b"); expect((await pg.query("select id from extractions")).rows[0]).toEqual(old);
    await finish(next.source, "b"); expect((await pg.query("select id from extractions")).rows[0]).not.toEqual(old);
  });
  it("제외는 연결된 장소·메모·저장 기록을 보존하고 다시 등록 가능", async () => {
    const { source: s } = await begin(); await finish(s);
    await pg.query("select dm_save_place($1,$2,'유빈',$3,null)", [board, JSON.stringify(place), s.id]);
    await pg.exec("update places set memo='메모 보존'");
    expect(await session(s, "a", "dismiss")).toEqual({ ok: true });
    expect(await session(s, "a", "dismiss")).toEqual({ ok: true });
    expect((await source()).status).toBe("dismissed");
    expect((await pg.query("select memo from places")).rows).toEqual([{ memo: "메모 보존" }]);
    expect((await pg.query("select * from source_places")).rows).toHaveLength(1);
    expect((await begin("b")).outcome).toBe("started");
  });
  it("만료된 화면은 저장할 수 없고 다시 확보한 최신 화면만 저장", async () => {
    const { source: s } = await begin(); await finish(s);
    await pg.exec("update sources set work_until=now()-interval '1 second'");
    const e = (await pg.query<any>("select id from extractions")).rows[0];
    const selections = JSON.stringify([{ extraction_id: e.id, include: true, place }]);
    const save = () => pg.query("select dm_confirm_source($1,$2,'a',$3,'유빈',$4,null)", [board, s.id, s.analysis_version, selections]);
    await expect(save()).rejects.toThrow("SOURCE_BUSY");
    await session(s, "a", "claim"); await save();
    expect((await source()).status).toBe("done");
    expect((await pg.query("select * from places")).rows).toHaveLength(1);
    expect((await pg.query("select * from place_push_events")).rows).toHaveLength(1);
  });
  it("다른 보드에서는 링크에 접근하지 못함", async () => {
    const { source: s } = await begin();
    const result = await pg.query<any>("select dm_source_session('10000000-0000-4000-8000-000000000002',$1,'a',$2,'claim') as r", [s.id, s.analysis_version]);
    expect(result.rows[0].r.code).toBe("SOURCE_NOT_FOUND");
  });
});
describe("메모 충돌의 DB 원자성", () => {
  async function setup() { return (await pg.query<any>("select dm_save_place($1,$2,'유빈') as id", [board, JSON.stringify(place)])).rows[0].id; }
  async function patch(id: string, who: string, memo: string, version: number | null) {
    return (await pg.query<any>("select dm_patch_place($1,$2,$3,$4,$5) as r", [board, id, who, JSON.stringify({ memo }), version])).rows[0].r;
  }
  it("동일 버전의 두 저장 중 하나만 반영하고 충돌한 사람이 정리 후 저장", async () => {
    const id = await setup();
    const [first, second] = await Promise.all([patch(id, "유빈", "토요일 저녁", 0), patch(id, "수민", "주차 가능", 0)]);
    expect(first).toEqual({ ok: true, memo_version: 1 });
    expect(second).toMatchObject({ code: "MEMO_CONFLICT", memo: "토요일 저녁", memo_version: 1, memo_updated_by: "유빈" });
    expect(await patch(id, "수민", "토요일 저녁 · 주차 가능", 1)).toEqual({ ok: true, memo_version: 2 });
  });
  it("충돌 내용을 보는 사이 한 번 더 변경되면 다시 보호", async () => {
    const id = await setup(); await patch(id, "유빈", "첫 내용", 0); await patch(id, "유빈", "새 내용", 1);
    expect(await patch(id, "수민", "합친 초안", 1)).toMatchObject({ code: "MEMO_CONFLICT", memo: "새 내용" });
    expect(await patch(id, "수민", "오래된 앱", null)).toMatchObject({ code: "MEMO_CONFLICT" });
  });
  it("상태만 바꾸면 메모 버전을 올리지 않음", async () => {
    const id = await setup(); await pg.query("select dm_patch_place($1,$2,'유빈','{\"status\":\"visited\"}',null)", [board, id]);
    expect(await patch(id, "수민", "상태와 별도 메모", 0)).toEqual({ ok: true, memo_version: 1 });
  });
  it("anon/authenticated는 내부 쓰기 RPC를 실행할 수 없음", async () => {
    const result = await pg.query<any>("select has_function_privilege('anon','dm_begin_source(uuid,text,text,text,text,boolean)','EXECUTE') as a, has_function_privilege('authenticated','dm_patch_place(uuid,uuid,text,jsonb,integer)','EXECUTE') as b");
    expect(result.rows[0]).toEqual({ a: false, b: false });
  });
});
