import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
let pg: PGlite;
const legacy = "20000000-0000-4000-8000-000000000001";
const migration = readFileSync("supabase/migrations/011_accounts.sql", "utf8");
const login = async (subject: string, name: string | null = "유빈", provider = "kakao", avatar: string | null = null) =>
  (await pg.query<any>("select dm_login($1,$2,$3,$4,$5) r", [provider, subject, "a@test.dev", name, avatar])).rows[0].r;
const link = async (user: string, name: string, board = legacy) => (await pg.query<any>("select dm_link_member($1,$2,$3) r", [user, board, name])).rows[0].r;
const rows = async (sql: string, params: unknown[] = []) => (await pg.query<any>(sql, params)).rows;
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec("create role anon; create role authenticated; create role service_role; create function gen_random_bytes(n integer) returns bytea language sql volatile as $$ select decode(substr(repeat(md5(random()::text),4),1,n*2),'hex') $$;");
  await pg.exec(readFileSync("supabase/schema.sql", "utf8").replace("create extension if not exists pgcrypto;", "").split("-- 보드 하나 만들기")[0]);
  for (const file of ["002_couple_access", "003_board_sync", "004_place_push", "005_reliable_workflows", "006_place_trash", "007_memo_push", "008_memo_push_fixes", "009_source_content_sync", "010_collections"]) await pg.exec(readFileSync(`supabase/migrations/${file}.sql`, "utf8"));
  // 같은 마이그레이션을 두 번 실행해도 안전해야 합니다.
  await pg.exec(migration); await pg.exec(migration);
}, 30000);
afterAll(async () => { await pg?.close(); });
beforeEach(async () => {
  await pg.exec("truncate boards, app_users cascade");
  await pg.query("insert into boards(id,token,name,member_names,pin_hash,auth_version) values($1::uuid,$1::text,'우리',array['유빈','수민'],'scrypt$x$y',3)", [legacy]);
});

it("첫 로그인은 계정·1인용 내 장소·방장 멤버를 함께 만들고, 다시 로그인하면 같은 폴더를 연다", async () => {
  const first = await login("100", "  유빈   김 ", "kakao", "https://img.test/a.png");
  expect(first).toMatchObject({ member_name: "유빈 김", created: true, auth_version: 0 });
  const [board] = await rows("select * from boards where id=$1", [first.board_id]);
  expect(board).toMatchObject({ name: "내 장소", is_personal: true, owner_id: first.user_id, member_limit: 8, member_names: ["유빈 김"], pin_hash: null });
  expect(await rows("select role, member_name from board_members where user_id=$1", [first.user_id])).toEqual([{ role: "owner", member_name: "유빈 김" }]);
  const again = await login("100", "다른 닉네임");
  expect(again).toMatchObject({ user_id: first.user_id, board_id: first.board_id, created: false });
  expect(await rows("select count(*)::int n from boards where owner_id=$1", [first.user_id])).toEqual([{ n: 1 }]);
});

it("공급자가 다르면 다른 계정이고, 빈 이름·http 사진·잘못된 공급자를 정리하거나 거절한다", async () => {
  const kakao = await login("same"), google = await login("same", null, "google", "http://insecure.test/a.png");
  expect(google.user_id).not.toBe(kakao.user_id);
  expect(google.member_name).toBe("나");
  expect((await rows("select avatar_url from app_users where id=$1", [google.user_id]))[0].avatar_url).toBeNull();
  await expect(login("x", "이름", "naver")).rejects.toThrow("로그인 정보를 확인하지 못했어요");
});

it("기존 PIN 지도에 이름 하나로 연결하고, 마지막으로 연 폴더가 다음 로그인의 시작 폴더가 된다", async () => {
  const user = await login("200");
  expect(await link(user.user_id, "유빈")).toMatchObject({ board_id: legacy, member_name: "유빈", auth_version: 3 });
  expect(await rows("select role from board_members where board_id=$1", [legacy])).toEqual([{ role: "owner" }]);
  expect((await rows("select owner_id from boards where id=$1", [legacy]))[0].owner_id).toBe(user.user_id);
  expect((await login("200")).board_id).toBe(legacy);
  // 같은 이름으로 다시 연결해도 중복되지 않는다
  await link(user.user_id, "유빈");
  expect(await rows("select count(*)::int n from board_members where board_id=$1", [legacy])).toEqual([{ n: 1 }]);
});

it("다른 계정이 쓰는 이름, 지도에 없는 이름, 이미 다른 이름으로 연결된 계정, PIN 없는 폴더는 연결하지 않는다", async () => {
  const a = await login("300"), b = await login("301", "수민");
  await link(a.user_id, "유빈");
  await expect(link(b.user_id, "유빈")).rejects.toThrow("다른 계정에 연결");
  await expect(link(b.user_id, "철수")).rejects.toThrow("이름 중에서");
  await expect(link(a.user_id, "수민")).rejects.toThrow("이미 유빈");
  await expect(link(b.user_id, "수민", a.board_id)).rejects.toThrow("연결할 수 있는 지도가 아니에요");
  expect((await link(b.user_id, "수민")).member_name).toBe("수민");
  expect(await rows("select role from board_members where board_id=$1 order by joined_at", [legacy])).toEqual([{ role: "owner" }, { role: "member" }]);
});

it("폴더 인원 상한을 넘겨 참여할 수 없다", async () => {
  await pg.query("update boards set member_limit=1 where id=$1", [legacy]);
  const a = await login("400"), b = await login("401", "수민");
  await link(a.user_id, "유빈");
  await expect(link(b.user_id, "수민")).rejects.toThrow("더 이상 멤버를 받을 수 없어요");
  await expect(pg.query("update boards set member_limit=11 where id=$1", [legacy])).rejects.toThrow();
});

it("폴더가 모두 사라진 계정은 다음 로그인에서 내 장소를 다시 받는다", async () => {
  const user = await login("500");
  await pg.query("delete from boards where id=$1", [user.board_id]);
  const again = await login("500");
  expect(again.board_id).not.toBe(user.board_id);
  expect((await rows("select name from boards where id=$1", [again.board_id]))[0].name).toBe("내 장소");
});

it("예약 알림은 보내지 않은 알림이 남은 폴더만 돌려준다", async () => {
  const user = await login("600");
  const place = (b: string) => rows("insert into places(board_id,name,kakao_place_id,lat,lng) values($1,'카페',$2,37,127) returning id", [b, b]).then((r) => r[0].id);
  await pg.query("insert into access_sessions(token_hash,board_id,purpose,member_name,auth_version,expires_at) values('s1',$1,'member','수민',3,now()+interval '1 day')", [legacy]);
  const sub = (await rows("insert into push_subscriptions(board_id,session_hash,endpoint,endpoint_hash,p256dh,auth) values($1,'s1','https://push.test/1','h1','p','a') returning id", [legacy]))[0].id;
  const event = async (b: string, state: string) => {
    const id = (await rows("insert into place_push_events(board_id,place_id,added_by,auth_version) values($1,$2,'유빈',0) returning id", [b, await place(b)]))[0].id;
    await pg.query("insert into push_deliveries(event_id,subscription_id,state) values($1,$2,$3)", [id, sub, state]);
  };
  await event(legacy, "pending"); await event(user.board_id, "sent");
  expect((await rows("select dm_push_board_ids() ids"))[0].ids).toEqual([legacy]);
});
