import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
const migration = readFileSync("supabase/migrations/004_place_push.sql", "utf8");
let pg: PGlite;
const board = "10000000-0000-4000-8000-000000000001";
const source = "20000000-0000-4000-8000-000000000001";
const base = { kakao_place_id: "test-1", name: "테스트 카페", address: "검증용 주소", lat: 37, lng: 127, category: "카페", kakao_url: "" };
async function save(who = "유빈", overrides = {}, link: string | null = null) {
  return (await pg.query<{ id: string }>("select dm_save_place($1,$2::jsonb,$3,$4,null) as id", [board, JSON.stringify({ ...base, ...overrides }), who, link])).rows[0].id;
}
async function claim() { return (await pg.query<any>("select * from dm_claim_push_deliveries($1)", [board])).rows; }
async function count(table: string) { return Number((await pg.query<{ n: string }>(`select count(*) as n from ${table}`)).rows[0].n); }
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`
    create role anon; create role authenticated; create role service_role;
    create table boards(id uuid primary key,name text,member_names text[],auth_version integer);
    create table places(id uuid primary key default gen_random_uuid(),board_id uuid references boards(id) on delete cascade,kakao_place_id text,name text,address text,lat double precision,lng double precision,category text,kakao_url text,status text default 'wish',memo text,unique(board_id,kakao_place_id));
    create table sources(id uuid primary key,board_id uuid references boards(id) on delete cascade);
    create table extractions(id uuid primary key,source_id uuid references sources(id) on delete cascade);
    create table source_places(source_id uuid references sources(id) on delete cascade,place_id uuid references places(id) on delete cascade,extraction_id uuid references extractions(id),added_by text,unique(source_id,place_id,added_by));
    create table place_saves(board_id uuid references boards(id) on delete cascade,place_id uuid references places(id) on delete cascade,added_by text,primary key(place_id,added_by));
    create table access_sessions(token_hash text primary key,board_id uuid references boards(id) on delete cascade,purpose text,member_name text,auth_version integer,expires_at timestamptz);
  `);
  await pg.exec(migration); await pg.exec(migration);
}, 30000);
afterAll(async () => { await pg?.close(); });
beforeEach(async () => {
  await pg.exec("truncate boards cascade");
  await pg.query("insert into boards values($1,'검증',array['유빈','수민'],1)", [board]);
  await pg.query("insert into sources values($1,$2)", [source, board]);
  await pg.query("insert into access_sessions values('a',$1,'member','유빈',1,now()+interval '1 day'),('b',$1,'member','수민',1,now()+interval '1 day')", [board]);
  await pg.query(`insert into push_subscriptions(endpoint_hash,endpoint,p256dh,auth,board_id,session_hash,created_at)
    values('own','https://web.push.apple.com/own','key','auth',$1,'a',now()-interval '1 minute'),('partner','https://web.push.apple.com/partner','key','auth',$1,'b',now()-interval '1 minute')`, [board]);
});
describe("Postgres 알림 트랜잭션과 수신 대상", () => {
  it("새 장소는 상대방에게만 알리고 보내는 사람의 다른 기기도 제외함", async () => {
    await pg.query("insert into access_sessions values('a2',$1,'member','유빈',1,now()+interval '1 day')", [board]);
    await pg.query("insert into push_subscriptions(endpoint_hash,endpoint,p256dh,auth,board_id,session_hash,created_at) values('own2','https://web.push.apple.com/own2','key','auth',$1,'a2',now()-interval '1 minute')", [board]);
    const id = await save(); const jobs = await claim();
    expect(jobs).toHaveLength(1); expect(jobs[0]).toMatchObject({ added_by: "유빈", place_id: id, place_name: "테스트 카페", endpoint: "https://web.push.apple.com/partner" });
    expect(await claim()).toHaveLength(0);
  });
  it("수민이 저장하면 반대로 유빈 기기가 수신함", async () => {
    await save("수민"); expect((await claim())[0].endpoint).toBe("https://web.push.apple.com/own");
  });
  it("중복·상대방의 중복 저장은 알림을 추가하지 않고 기존 메모·상태를 보존함", async () => {
    const id = await save();
    await pg.query("update places set memo='창가',status='visited' where id=$1", [id]);
    expect(await save("수민")).toBe(id); expect(await count("place_push_events")).toBe(1);
    expect((await pg.query("select memo,status from places")).rows[0]).toEqual({ memo: "창가", status: "visited" });
  });
  it("링크 연결과 새 장소 알림이 함께 저장됨", async () => {
    await save("유빈", {}, source); expect(await count("source_places")).toBe(1); expect(await count("place_push_events")).toBe(1);
  });
  it("저장자 기록이 실패하면 장소와 알림도 롤백함", async () => {
    await pg.exec("create function test_fail_save() returns trigger language plpgsql as $$ begin raise exception 'test failure'; end $$; create trigger test_fail before insert on place_saves for each row execute function test_fail_save();");
    try { await expect(save()).rejects.toThrow("test failure"); expect(await count("places")).toBe(0); expect(await count("place_push_events")).toBe(0); }
    finally { await pg.exec("drop trigger test_fail on place_saves; drop function test_fail_save()"); }
  });
  it("만료·잘못된 이름·다른 인증 버전의 세션은 수신하지 않음", async () => {
    for (const patch of ["expires_at=now()-interval '1 second'", "member_name='외부인'", "auth_version=2"]) {
      await pg.exec("update access_sessions set expires_at=now()+interval '1 day',member_name='수민',auth_version=1 where token_hash='b'");
      await pg.exec(`update access_sessions set ${patch} where token_hash='b'`); await save(); expect(await claim()).toHaveLength(0);
    }
  });
  it("기기 잠금이나 PIN 변경으로 세션을 지우면 구독도 삭제됨", async () => {
    await save(); await pg.exec("delete from access_sessions where token_hash='b'");
    expect(await count("push_subscriptions")).toBe(1); expect(await claim()).toHaveLength(0);
    await pg.query("update boards set auth_version=2 where id=$1", [board]);
    expect(await claim()).toHaveLength(0);
  });
  it("인증 버전이 바뀌면 남아 있는 예전 구독과 이벤트도 발송에서 제외함", async () => {
    await save(); await pg.query("update boards set auth_version=2 where id=$1", [board]);
    expect(await count("push_subscriptions")).toBe(2); expect(await claim()).toHaveLength(0);
  });
  it("기기 주인 변경 후에는 현재 선택한 이름으로 발송 대상을 결정함", async () => {
    await save(); await pg.exec("update access_sessions set member_name='유빈' where token_hash='b'"); expect(await claim()).toHaveLength(0);
  });
  it("새로 켠 기기에 예전 장소 알림을 소급해 보내지 않음", async () => {
    await save(); await pg.exec("update push_subscriptions set created_at=now()+interval '1 second'"); expect(await claim()).toHaveLength(0);
  });
  it("다른 보드의 구독으로 알림을 보내지 않음", async () => {
    await pg.exec("insert into boards values('10000000-0000-4000-8000-000000000002','다른 보드',array['유빈','수민'],1); update push_subscriptions set board_id='10000000-0000-4000-8000-000000000002' where endpoint_hash='partner'");
    await save(); expect(await claim()).toHaveLength(0);
  });
  it("완료된 발송은 재발송하지 않고 실패·끊긴 발송은 제한된 횟수로 다시 회수함", async () => {
    await save(); const [job] = await claim();
    await pg.exec("update push_deliveries set available_at=now()-interval '1 second'");
    const [retried] = await claim(); expect(retried.lease).not.toBe(job.lease);
    await pg.exec("update push_deliveries set state='sent'"); expect(await claim()).toHaveLength(0);
    await pg.exec("update push_deliveries set state='pending',attempts=3,available_at=now()-interval '1 second'"); expect(await claim()).toHaveLength(0);
  });
  it("장소 삭제 후 재등록하면 새 이벤트가 생기고 이전 이벤트는 정리됨", async () => {
    await save(); await pg.exec("delete from places"); expect(await count("place_push_events")).toBe(0);
    await save(); expect(await count("place_push_events")).toBe(1); expect(await claim()).toHaveLength(1);
  });
  it("브라우저용 DB 역할은 구독·발송 기록과 RPC에 접근할 수 없음", async () => {
    await pg.exec("set role anon");
    try {
      await expect(pg.query("select * from push_subscriptions")).rejects.toThrow("permission denied");
      await expect(claim()).rejects.toThrow("permission denied");
    } finally { await pg.exec("reset role"); }
  });
});
