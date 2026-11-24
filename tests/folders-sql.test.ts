import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
let pg: PGlite;
const files = ["002_couple_access", "003_board_sync", "004_place_push", "005_reliable_workflows", "006_place_trash", "007_memo_push", "008_memo_push_fixes", "009_source_content_sync", "010_collections", "011_accounts"];
const q = async (sql: string, params: unknown[] = []) => (await pg.query<any>(sql, params)).rows;
const one = async (sql: string, params: unknown[] = []) => (await q(sql, params))[0]?.r;
const login = (subject: string, name = subject) => one("select dm_login('kakao',$1,null,$2,null) r", [subject, name]);
const session = async (user: string, board: string | null, hash: string) =>
  pg.query("insert into access_sessions(token_hash,board_id,purpose,member_name,auth_version,expires_at,user_id) values($1,$2,'member',(select member_name from board_members where board_id=$2 and user_id=$3),0,now()+interval '1 day',$3)", [hash, board, user]);
const sessionBoard = async (hash: string) => (await q("select board_id, member_name from access_sessions where token_hash=$1", [hash]))[0];
const create = (user: string, name = "부산 여행") => one("select dm_create_folder($1,$2,'blue','map') r", [user, name]);
const invite = async (actor: string, board: string, hash = "a".repeat(64)) => { await one("select dm_create_invite($1,$2,$3) r", [actor, board, hash]); return hash; };
const accept = (user: string, hash = "a".repeat(64)) => one("select dm_accept_invite($1,$2) r", [user, hash]);
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec("create role anon; create role authenticated; create role service_role; create function gen_random_bytes(n integer) returns bytea language sql volatile as $$ select decode(substr(repeat(md5(random()::text),4),1,n*2),'hex') $$;");
  await pg.exec(readFileSync("supabase/schema.sql", "utf8").replace("create extension if not exists pgcrypto;", "").split("-- 보드 하나 만들기")[0]);
  for (const f of files) await pg.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"));
  const migration = readFileSync("supabase/migrations/012_folders.sql", "utf8");
  await pg.exec(migration); await pg.exec(migration);
}, 30000);
afterAll(async () => { await pg?.close(); });
beforeEach(async () => { await pg.exec("truncate boards, app_users cascade"); });

it("폴더를 만들면 만든 사람이 방장이고, 이름은 정리·검사하며 목록에 멤버·장소 수가 나온다", async () => {
  const a = await login("a", "유빈");
  const { board_id } = await create(a.user_id, "  부산   여행 ");
  expect((await q("select name,color,icon,is_personal,owner_id from boards where id=$1", [board_id]))[0]).toEqual({ name: "부산 여행", color: "blue", icon: "map", is_personal: false, owner_id: a.user_id });
  await pg.query("insert into places(board_id,name,kakao_place_id,lat,lng) values($1,'카페','1',35,129)", [board_id]);
  const list = await one("select dm_list_folders($1) r", [a.user_id]);
  expect(list.map((f: any) => [f.name, f.role, f.member_count, f.place_count])).toEqual([["내 장소", "owner", 1, 0], ["부산 여행", "owner", 1, 1]]);
  await expect(create(a.user_id, "   ")).rejects.toThrow("1~30자");
  await expect(one("select dm_create_folder($1,'x','purple','map') r", [a.user_id])).rejects.toThrow();
});

it("방장만 이름·표지를 바꾸고, 초대·참여·이름 겹침·인원 상한을 지킨다", async () => {
  const a = await login("a", "유빈"), b = await login("b", "유빈"), c = await login("c", "수민");
  const { board_id } = await create(a.user_id);
  await expect(one("select dm_create_invite($1,$2,$3) r", [b.user_id, board_id, "b".repeat(64)])).rejects.toThrow("만든 사람만 초대");
  const token = await invite(a.user_id, board_id);
  expect(await one("select dm_invite_preview($1,$2) r", [token, b.user_id])).toMatchObject({ code: "OK", name: "부산 여행", owner: "유빈", member_count: 1, member_limit: 8 });
  await accept(b.user_id);
  expect(await q("select member_name, role from board_members where board_id=$1 order by joined_at", [board_id])).toEqual([{ member_name: "유빈", role: "owner" }, { member_name: "유빈 2", role: "member" }]);
  expect((await one("select dm_invite_preview($1,$2) r", [token, b.user_id])).code).toBe("ALREADY_MEMBER");
  await accept(b.user_id); // 다시 수락해도 중복 참여하지 않음
  expect((await q("select count(*)::int n from board_members where board_id=$1", [board_id]))[0].n).toBe(2);
  await expect(one("select dm_update_folder($1,$2,'바꿈','red','heart') r", [b.user_id, board_id])).rejects.toThrow("만든 사람만 바꿀");
  await one("select dm_update_folder($1,$2,'제주','gold','tree') r", [a.user_id, board_id]);
  await pg.query("update boards set member_limit=2 where id=$1", [board_id]);
  expect((await one("select dm_invite_preview($1,$2) r", [token, c.user_id])).code).toBe("FOLDER_FULL");
  await expect(accept(c.user_id)).rejects.toThrow("더 이상 멤버를 받을 수 없어요");
  await expect(invite(a.user_id, board_id, "c".repeat(64))).rejects.toThrow("인원이 가득");
});

it("만료·끊긴 초대는 쓸 수 없다", async () => {
  const a = await login("a"), b = await login("b");
  const { board_id } = await create(a.user_id);
  const token = await invite(a.user_id, board_id);
  expect(await one("select dm_revoke_invites($1,$2) r", [a.user_id, board_id])).toBe(1);
  expect((await one("select dm_invite_preview($1,null) r", [token])).code).toBe("INVITE_INVALID");
  await expect(accept(b.user_id)).rejects.toThrow("만료");
  const second = await invite(a.user_id, board_id, "d".repeat(64));
  await pg.query("update folder_invites set expires_at=now()-interval '1 minute' where token_hash=$1", [second]);
  await expect(accept(b.user_id, second)).rejects.toThrow("만료");
});

it("폴더 전환은 멤버인 폴더만, 세션·알림 구독·마지막 폴더를 함께 옮긴다", async () => {
  const a = await login("a", "유빈"), b = await login("b");
  const { board_id } = await create(a.user_id);
  await session(a.user_id, a.board_id, "s-a");
  await pg.query("insert into push_subscriptions(board_id,session_hash,endpoint,endpoint_hash,p256dh,auth) values($1,'s-a','https://push.test/a','ha','p','x')", [a.board_id]);
  expect(await one("select dm_switch_folder($1,'s-a',$2) r", [a.user_id, board_id])).toMatchObject({ board_id, member_name: "유빈" });
  expect(await sessionBoard("s-a")).toEqual({ board_id, member_name: "유빈" });
  expect((await q("select board_id from push_subscriptions where session_hash='s-a'"))[0].board_id).toBe(board_id);
  expect((await login("a")).board_id).toBe(board_id);
  await expect(one("select dm_switch_folder($1,'s-a',$2) r", [b.user_id, board_id])).rejects.toThrow("참여한 폴더만");
});

it("나가기·내보내기: 방장이 나가면 다음 멤버가 방장, 혼자면 삭제를 안내, 나간 계정의 기기는 다른 폴더로", async () => {
  const a = await login("a", "유빈"), b = await login("b", "수민"), c = await login("c", "철수");
  const { board_id } = await create(a.user_id);
  await invite(a.user_id, board_id); await accept(b.user_id); await accept(c.user_id);
  await session(c.user_id, board_id, "s-c");
  await expect(one("select dm_remove_member($1,$2,$3) r", [b.user_id, board_id, c.user_id])).rejects.toThrow("만든 사람만 내보낼");
  await one("select dm_remove_member($1,$2,$3) r", [a.user_id, board_id, c.user_id]);
  expect(await sessionBoard("s-c")).toEqual({ board_id: c.board_id, member_name: "철수" });
  await one("select dm_remove_member($1,$2,$3) r", [a.user_id, board_id, a.user_id]);
  expect(await q("select user_id, role from board_members where board_id=$1", [board_id])).toEqual([{ user_id: b.user_id, role: "owner" }]);
  expect((await q("select owner_id from boards where id=$1", [board_id]))[0].owner_id).toBe(b.user_id);
  await expect(one("select dm_remove_member($1,$2,$3) r", [b.user_id, board_id, b.user_id])).rejects.toThrow("나가는 대신 삭제");
});

it("방장 넘기기", async () => {
  const a = await login("a"), b = await login("b");
  const { board_id } = await create(a.user_id);
  await invite(a.user_id, board_id); await accept(b.user_id);
  await expect(one("select dm_transfer_owner($1,$2,$3) r", [b.user_id, board_id, a.user_id])).rejects.toThrow("만든 사람만 넘길");
  await expect(one("select dm_transfer_owner($1,$2,$3) r", [a.user_id, board_id, a.user_id])).rejects.toThrow("다른 멤버");
  await one("select dm_transfer_owner($1,$2,$3) r", [a.user_id, board_id, b.user_id]);
  expect(await q("select user_id, role from board_members where board_id=$1 order by role desc", [board_id])).toEqual([{ user_id: b.user_id, role: "owner" }, { user_id: a.user_id, role: "member" }]);
  expect((await q("select owner_id from boards where id=$1", [board_id]))[0].owner_id).toBe(b.user_id);
});

it("폴더 삭제는 방장만, 멤버 기기는 각자의 다른 폴더로 옮기고, 마지막 폴더를 지우면 폴더 없는 로그인이 된다", async () => {
  const a = await login("a", "유빈"), b = await login("b", "수민");
  const { board_id } = await create(a.user_id);
  await invite(a.user_id, board_id); await accept(b.user_id);
  await session(b.user_id, board_id, "s-b"); await session(a.user_id, a.board_id, "s-a");
  await expect(one("select dm_delete_folder($1,$2) r", [b.user_id, board_id])).rejects.toThrow("만든 사람만 삭제");
  await one("select dm_delete_folder($1,$2) r", [a.user_id, board_id]);
  expect(await q("select id from boards where id=$1", [board_id])).toEqual([]);
  expect(await sessionBoard("s-b")).toEqual({ board_id: b.board_id, member_name: "수민" });
  // 마지막 폴더(내 장소)까지 지우면 세션은 남고 폴더만 비어요. 다음 로그인도 새 폴더를 만들지 않습니다.
  await one("select dm_delete_folder($1,$2) r", [a.user_id, a.board_id]);
  expect(await sessionBoard("s-a")).toEqual({ board_id: null, member_name: null });
  expect(await login("a")).toMatchObject({ board_id: null, member_name: null, created: false });
  expect(await one("select dm_list_folders($1) r", [a.user_id])).toEqual([]);
});
