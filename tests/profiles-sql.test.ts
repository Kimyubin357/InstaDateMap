import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
let pg: PGlite;
let backfilled: string[] = [];
const legacy = "30000000-0000-4000-8000-000000000001";
const files = ["002_couple_access", "003_board_sync", "004_place_push", "005_reliable_workflows", "006_place_trash", "007_memo_push", "008_memo_push_fixes", "009_source_content_sync", "010_collections", "011_accounts", "012_folders"];
const q = async (sql: string, params: unknown[] = []) => (await pg.query<any>(sql, params)).rows;
const one = async (sql: string, params: unknown[] = []) => (await q(sql, params))[0]?.r;
const login = (subject: string, name: string, avatar: string | null = null, provider = "kakao") => one("select dm_login($1,$2,null,$3,$4) r", [provider, subject, name, avatar]);
const setProfile = (user: string, name: string, mode = "keep", avatar: string | null = null) => one("select dm_set_profile($1,$2,$3,$4) r", [user, name, mode, avatar]);
const place = (k: string) => JSON.stringify({ kakao_place_id: k, name: `카페${k}`, address: "서울", lat: 37.5, lng: 127, category: "카페", kakao_url: "https://place.map.kakao.com/1" });
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec("create role anon; create role authenticated; create role service_role; create function gen_random_bytes(n integer) returns bytea language sql volatile as $$ select decode(substr(repeat(md5(random()::text),4),1,n*2),'hex') $$;");
  await pg.exec(readFileSync("supabase/schema.sql", "utf8").replace("create extension if not exists pgcrypto;", "").split("-- 보드 하나 만들기")[0]);
  for (const f of files) await pg.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"));
  // 012까지 적용된 운영 DB처럼, 014 전에 만들어진 폴더도 준비합니다.
  await pg.exec("insert into app_users(id,display_name) values('40000000-0000-4000-8000-000000000001','옛사용자')");
  await pg.exec("select dm_create_folder('40000000-0000-4000-8000-000000000001','014 전 폴더','red','heart')");
  const migration = readFileSync("supabase/migrations/014_profiles.sql", "utf8");
  await pg.exec(migration); await pg.exec(migration);
  backfilled = (await pg.query<any>("select member_names from boards where name='014 전 폴더'")).rows[0].member_names;
}, 30000);
afterAll(async () => { await pg?.close(); });

it("014 이전에 만든 폴더도 멤버 이름 목록이 채워진다", async () => {
  expect(backfilled).toEqual(["옛사용자"]);
});

beforeEach(async () => {
  await pg.exec("truncate boards, app_users cascade");
  await pg.query("insert into boards(id,token,name,member_names,pin_hash,auth_version) values($1::uuid,$1::text,'우리',array['유빈','수민'],'scrypt$x$y',0)", [legacy]);
});

it("새 폴더와 초대 멤버도 장소 저장·삭제·모음이 된다(멤버 이름 목록 동기화)", async () => {
  const a = await login("a", "유빈"), b = await login("b", "철수");
  const { board_id } = await one("select dm_create_folder($1,'부산','blue','map') r", [a.user_id]);
  await one("select dm_create_invite($1,$2,$3) r", [a.user_id, board_id, "a".repeat(64)]);
  await one("select dm_accept_invite($1,$2) r", [b.user_id, "a".repeat(64)]);
  expect((await q("select member_names from boards where id=$1", [board_id]))[0].member_names).toEqual(["유빈", "철수"]);
  const saved = (await q("select dm_save_place($1,$2,'철수') id", [board_id, place("1")]))[0].id;
  expect((await one("select dm_trash_place($1,$2,'철수','trash') r", [board_id, saved])).ok).toBe(true);
  expect(await one("select dm_change_collection($1,'철수',gen_random_uuid(),$2) r", [board_id, JSON.stringify({ action: "create", id: "50000000-0000-4000-8000-000000000001", name: "주말", description: "", color: "red", icon: "heart" })])).toMatchObject({ ok: true });
  await one("select dm_remove_member($1,$2,$3) r", [a.user_id, board_id, b.user_id]);
  expect((await q("select member_names from boards where id=$1", [board_id]))[0].member_names).toEqual(["유빈"]);
  await expect(q("select dm_save_place($1,$2,'철수')", [board_id, place("2")])).rejects.toThrow("저장자가 아닙니다");
});

it("첫 로그인은 이름 확인 전 상태이고, 로그인마다 공급자 프로필을 기록한다", async () => {
  const first = await login("p", "카톡닉네임", "https://k.kakaocdn.net/a.jpg");
  expect(first).toMatchObject({ created: true, name_confirmed: false });
  expect(await one("select dm_get_profile($1) r", [first.user_id])).toEqual({ name: "카톡닉네임", avatar: "https://k.kakaocdn.net/a.jpg", name_confirmed: false, provider: "kakao", provider_name: "카톡닉네임", provider_avatar: "https://k.kakaocdn.net/a.jpg" });
  await setProfile(first.user_id, "유빈");
  const again = await login("p", "바뀐닉네임", "https://k.kakaocdn.net/b.jpg");
  expect(again).toMatchObject({ created: false, name_confirmed: true });
  expect(await one("select dm_get_profile($1) r", [first.user_id])).toMatchObject({ name: "유빈", avatar: "https://k.kakaocdn.net/a.jpg", provider_name: "바뀐닉네임", provider_avatar: "https://k.kakaocdn.net/b.jpg" });
});

it("사진: 공급자 사진 다시 가져오기·직접 올리기·없음, 잘못된 형식은 거절", async () => {
  const u = await login("p", "유빈", "https://k.kakaocdn.net/a.jpg");
  const small = "data:image/webp;base64," + "A".repeat(100);
  expect((await setProfile(u.user_id, "유빈", "custom", small)).avatar).toBe(small);
  expect((await setProfile(u.user_id, "유빈", "provider")).avatar).toBe("https://k.kakaocdn.net/a.jpg");
  expect((await setProfile(u.user_id, "유빈", "none")).avatar).toBeNull();
  await expect(setProfile(u.user_id, "유빈", "custom", "javascript:alert(1)")).rejects.toThrow();
  await expect(setProfile(u.user_id, "유빈", "custom", "data:image/webp;base64," + "A".repeat(200001))).rejects.toThrow();
  await expect(setProfile(u.user_id, " ", "keep")).rejects.toThrow("1~20자");
});

it("이름을 바꾸면 모든 폴더의 저장자·메모·링크·알림·세션 기록이 함께 바뀐다", async () => {
  const a = await login("a", "유빈");
  await one("select dm_link_member($1,$2,'유빈') r", [a.user_id, legacy]);
  const id = (await q("select dm_save_place($1,$2,'유빈') id", [legacy, place("9")]))[0].id;
  await pg.query("update places set memo='메모', memo_updated_by='유빈' where id=$1", [id]);
  await pg.query("insert into sources(board_id,url,media_type,shared_by) values($1,'https://instagram.com/p/x','post','유빈')", [legacy]);
  await pg.query("insert into access_sessions(token_hash,board_id,purpose,member_name,auth_version,expires_at,user_id) values('s1',$1,'member','유빈',0,now()+interval '1 day',$2)", [legacy, a.user_id]);
  await setProfile(a.user_id, "유빈이");
  expect((await q("select member_names from boards where id=$1", [legacy]))[0].member_names).toEqual(["유빈이", "수민"]);
  expect((await q("select added_by from place_saves where place_id=$1", [id]))[0].added_by).toBe("유빈이");
  expect((await q("select memo_updated_by from places where id=$1", [id]))[0].memo_updated_by).toBe("유빈이");
  expect((await q("select shared_by from sources where board_id=$1", [legacy]))[0].shared_by).toBe("유빈이");
  expect((await q("select member_name from access_sessions where token_hash='s1'"))[0].member_name).toBe("유빈이");
  expect((await q("select member_name from board_members where user_id=$1 and board_id=$2", [a.user_id, legacy]))[0].member_name).toBe("유빈이");
  // 같은 폴더의 다른 이름(연결 전 PIN 이름 포함)과 겹치면 거절하고 아무것도 바꾸지 않는다
  await expect(setProfile(a.user_id, "수민")).rejects.toThrow("‘우리’ 폴더에 이미 같은 이름");
  expect((await one("select dm_get_profile($1) r", [a.user_id])).name).toBe("유빈이");
});
