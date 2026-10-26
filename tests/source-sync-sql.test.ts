import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const board = "10000000-0000-4000-8000-000000000001";
const otherBoard = "10000000-0000-4000-8000-000000000002";
const migration = readFileSync("supabase/migrations/009_source_content_sync.sql", "utf8");
let pg: PGlite;
type Source = { id: string; analysis_version: string };
const place = { kakao_place_id: "123", name: "테스트 식당", address: "서울", lat: 37.5, lng: 127, category: "식당", kakao_url: "" };
async function revision(id = board) {
  return Number((await pg.query<{ revision: string }>("select dm_board_revision($1) as revision", [id])).rows[0].revision);
}
async function broadcasts() { return Number((await pg.query<{ count: string }>("select count(*) from public.test_broadcasts")).rows[0].count); }
async function source(status = "pending_confirm", suffix = "ABC") {
  return (await pg.query<Source>("insert into sources(board_id,url,media_type,shared_by,status) values($1,$2,'reel','유빈',$3) returning id,analysis_version", [board, `https://www.instagram.com/reel/${suffix}/`, status])).rows[0];
}
async function session(s: Source, action: string, owner = "a") {
  return (await pg.query<{ result: { ok?: boolean; code?: string } }>("select dm_source_session($1,$2,$3,$4,$5) as result", [board, s.id, owner, s.analysis_version, action])).rows[0].result;
}

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`
    create role anon; create role authenticated; create role service_role;
    create function gen_random_bytes(n integer) returns bytea language sql as $$ select decode(repeat('ab',n),'hex') $$;
    create schema realtime;
    create table public.test_broadcasts(payload jsonb,event text,topic text,private boolean);
    create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language sql as $$
      insert into public.test_broadcasts values(payload,event,topic,private)
    $$;
  `);
  await pg.exec(readFileSync("supabase/schema.sql", "utf8").replace("create extension if not exists pgcrypto;", "").split("-- 보드 하나 만들기")[0]);
  for (const file of ["002_couple_access", "003_board_sync", "004_place_push", "005_reliable_workflows", "006_place_trash", "007_memo_push", "008_memo_push_fixes"]) {
    await pg.exec(readFileSync(`supabase/migrations/${file}.sql`, "utf8"));
  }
  await pg.exec(migration); await pg.exec(migration);
}, 30000);
afterAll(async () => { await pg?.close(); });
beforeEach(async () => {
  await pg.exec("truncate boards cascade; truncate public.test_broadcasts");
  await pg.query("insert into boards(id,name,token,member_names,auth_version) values($1,'테스트','board-a',array['유빈','수민'],1),($2,'다른 보드','board-b',array['유빈','수민'],1)", [board, otherBoard]);
});

describe("링크 작업 권한과 실제 지도 변경의 동기화 분리", () => {
  it("반복 확보·연장·반납은 권한만 바꾸고 변경 번호·방송을 유지", async () => {
    const s = await source(), before = await revision(), sent = await broadcasts();
    expect(await session(s, "claim")).toEqual({ ok: true });
    await pg.query("update sources set work_until=now()+interval '30 seconds' where id=$1", [s.id]);
    expect(await session(s, "claim")).toEqual({ ok: true });
    expect(await session(s, "claim", "b")).toEqual({ code: "SOURCE_BUSY" });
    expect(await session(s, "release")).toEqual({ ok: true });
    expect((await pg.query("select work_owner,work_until from sources where id=$1", [s.id])).rows[0]).toEqual({ work_owner: null, work_until: null });
    expect(await session(s, "claim", "b")).toEqual({ ok: true });
    expect(await revision()).toBe(before); expect(await broadcasts()).toBe(sent);
  });

  it("새 링크·삭제는 각각 한 번 알리고 재실행한 마이그레이션도 트리거를 중복하지 않음", async () => {
    const before = await revision(), sent = await broadcasts(), s = await source();
    expect(await revision()).toBe(before + 1);
    await pg.query("delete from sources where id=$1", [s.id]);
    expect(await revision()).toBe(before + 2); expect(await broadcasts()).toBe(sent + 2);
  });

  it("NULL과 값의 교체·새 분석 번호는 감지하고 동일한 내용은 다시 알리지 않음", async () => {
    const s = await source(), before = await revision();
    await pg.query("update sources set caption='새 설명',work_owner='a' where id=$1", [s.id]);
    expect(await revision()).toBe(before + 1);
    await pg.query("update sources set caption='새 설명',work_until=now() where id=$1", [s.id]);
    expect(await revision()).toBe(before + 1);
    await pg.query("update sources set caption=null where id=$1", [s.id]);
    expect(await revision()).toBe(before + 2);
    await pg.query("update sources set analysis_version=gen_random_uuid(),recovery_reason='interrupted' where id=$1", [s.id]);
    expect(await revision()).toBe(before + 3);
    await pg.query("update sources set recovery_reason=null where id=$1", [s.id]);
    expect(await revision()).toBe(before + 4);
  });

  it("권한 확인 중 다른 멈춘 작업이 복구되면 대기 목록 변경을 계속 방송", async () => {
    const current = await source(), stalled = await source("processing", "STALE");
    await pg.query("update sources set work_until=now()-interval '1 second' where id=$1", [stalled.id]);
    const before = await revision(), sent = await broadcasts();
    expect(await session(current, "claim")).toEqual({ ok: true });
    expect((await pg.query("select status,recovery_reason from sources where id=$1", [stalled.id])).rows[0]).toEqual({ status: "needs_review", recovery_reason: "interrupted" });
    expect(await revision()).toBe(before + 1); expect(await broadcasts()).toBe(sent + 1);
  });

  it("링크 제외는 대기 개수 변경을 알리고 중복 제외는 추가 방송하지 않음", async () => {
    const s = await source(); await session(s, "claim");
    const before = await revision(), sent = await broadcasts();
    expect(await session(s, "dismiss")).toEqual({ ok: true });
    expect(await session(s, "dismiss")).toEqual({ ok: true });
    expect(await revision()).toBe(before + 1); expect(await broadcasts()).toBe(sent + 1);
  });

  it("분석 결과와 확인 저장·원본 연결·장소 수정은 계속 지도 변경으로 전달", async () => {
    const begun = (await pg.query<{ result: { source: Source } }>("select dm_begin_source($1,'https://www.instagram.com/reel/ABC/','reel','유빈','a',false) as result", [board])).rows[0].result.source;
    const beforeAnalysis = await revision();
    await pg.query("select dm_finish_analysis($1,$2,'a',$3,'pending_confirm','원문','manual',null,$4,false,'유빈',null)", [board, begun.id, begun.analysis_version, JSON.stringify([{ module: "caption", raw_name: place.name, candidates: [place], confidence: 0.8 }])]);
    expect(await revision()).toBeGreaterThan(beforeAnalysis);
    const extraction = (await pg.query<{ id: string }>("select id from extractions where source_id=$1", [begun.id])).rows[0];
    const beforeSave = await revision();
    await pg.query("select dm_confirm_source($1,$2,'a',$3,'유빈',$4,null)", [board, begun.id, begun.analysis_version, JSON.stringify([{ extraction_id: extraction.id, include: true, place }])]);
    expect(await revision()).toBeGreaterThan(beforeSave);
    expect((await pg.query("select status from sources where id=$1", [begun.id])).rows[0]).toEqual({ status: "done" });
    expect((await pg.query("select * from source_places")).rows).toHaveLength(1);
    const beforeEdit = await revision();
    await pg.query("update places set memo='새 메모' where board_id=$1", [board]);
    expect(await revision()).toBe(beforeEdit + 1);
  });

  it("다른 보드로 옮기면 이전 보드와 새 보드 모두 갱신", async () => {
    const s = await source(), before = await revision(), otherBefore = await revision(otherBoard);
    await pg.query("update sources set board_id=$1 where id=$2", [otherBoard, s.id]);
    expect(await revision()).toBe(before + 1); expect(await revision(otherBoard)).toBe(otherBefore + 1);
  });
});
