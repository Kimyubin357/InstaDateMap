import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
// 019: "누가"를 이름 대신 계정 id로. 이름을 바꿔도 기록·권한·알림이 같은 사람을 가리키고 지금 이름으로 보입니다.
let pg: PGlite;
const files = ["002_couple_access", "003_board_sync", "004_place_push", "005_reliable_workflows", "006_place_trash", "007_memo_push", "008_memo_push_fixes", "009_source_content_sync", "010_collections", "011_accounts", "012_folders", "013_place_details", "014_profiles", "015_terms", "016_account_delete_pin_cleanup", "017_folder_transfer_push", "018_room_look"];
const migration = readFileSync("supabase/migrations/019_user_id_records.sql", "utf8");
const q = async (sql: string, params: unknown[] = []) => (await pg.query<any>(sql, params)).rows;
const one = async (sql: string, params: unknown[] = []) => (await q(sql, params))[0]?.r;
const place = (k: string) => JSON.stringify({ kakao_place_id: k, name: `카페${k}`, address: "서울", lat: 37.5, lng: 127, category: "카페", kakao_url: "https://place.map.kakao.com/1" });
const save = (board: string, who: string, k: string, source: string | null = null) => one("select dm_save_place($1,$2,$3,$4) r", [board, place(k), who, source]);
const rename = (user: string, name: string) => one("select dm_set_profile($1,$2,'keep',null) r", [user, name]);
const del = (user: string, board: string, id: string) => one("select dm_delete_place($1,$2,$3) r", [user, board, id]);
const shown = (board: string, user: string | null, recorded: string) => one("select dm_member_name($1,$2,$3) r", [board, user, recorded]);
let yubin: string, sumin: string, mine: string, ours: string;
const before: Record<string, any> = {};

async function people() {
  const a = await one("select dm_login('kakao','a',null,'유빈',null) r"); const b = await one("select dm_login('kakao','b',null,'수민',null) r");
  yubin = a.user_id; sumin = b.user_id; mine = a.board_id;
  ours = (await one("select dm_create_folder($1,'우리 데이트맵','red','heart') r", [yubin])).board_id;
  await q("insert into board_members(board_id,user_id,role,member_name) values($1,$2,'member','수민')", [ours, sumin]);
}

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec("create role anon; create role authenticated; create role service_role; create function gen_random_bytes(n integer) returns bytea language sql volatile as $$ select decode(substr(repeat(md5(random()::text),4),1,n*2),'hex') $$;");
  await pg.exec(readFileSync("supabase/schema.sql", "utf8").replace("create extension if not exists pgcrypto;", "").split("-- 보드 하나 만들기")[0]);
  for (const f of files) await pg.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"));
  // 018까지 적용된 운영 DB처럼 이름만 있는 기록을 만듭니다(예전 PIN 이름 '옛이름'은 계정이 없음).
  await people();
  await q("update boards set member_names = member_names || array['옛이름'] where id=$1", [ours]);
  const src = (await q("insert into sources(board_id,url,media_type,shared_by,status) values($1,'https://www.instagram.com/p/OLD/','post','수민','done') returning id", [ours]))[0].id;
  before.place = await save(ours, "수민", "100", src);
  await save(ours, "유빈", "100");
  before.legacy = await save(ours, "옛이름", "101");
  await q("update places set memo='창가', memo_updated_by='유빈' where id=$1", [before.place]);
  const gone = await save(ours, "유빈", "102", src);
  await del(yubin, ours, gone);
  await pg.exec(migration); await pg.exec(migration); // 두 번 실행해도 같은 결과
}, 30000);
afterAll(async () => { await pg?.close(); });

describe("019 채우기(운영 DB에 이미 있는 기록)", () => {
  it("지금 멤버의 이름 기록에는 그 계정 id를 넣고, 맞는 멤버가 없는 예전 이름은 비워 둔다", async () => {
    expect(await q("select added_by, added_by_user_id from place_saves where place_id=$1 order by added_at", [before.place])).toEqual([
      { added_by: "수민", added_by_user_id: sumin }, { added_by: "유빈", added_by_user_id: yubin }]);
    expect(await q("select added_by, added_by_user_id from source_places where place_id=$1", [before.place])).toEqual([{ added_by: "수민", added_by_user_id: sumin }]);
    expect((await q("select shared_by_user_id from sources where board_id=$1", [ours]))[0].shared_by_user_id).toBe(sumin);
    expect((await q("select memo_updated_by_user_id from places where id=$1", [before.place]))[0].memo_updated_by_user_id).toBe(yubin);
    expect((await q("select added_by_user_id from place_saves where place_id=$1", [before.legacy]))[0].added_by_user_id).toBeNull();
    expect((await q("select added_by, added_by_user_id from place_push_events where place_id=$1", [before.place]))[0]).toEqual({ added_by: "수민", added_by_user_id: sumin });
  });
  it("개인 삭제 기록의 장소 내용에도 이름 옆에 id를 넣는다", async () => {
    const [log] = await q("select place from place_trash_log where user_id=$1", [yubin]);
    expect(log.place).toMatchObject({ registrant: "유빈", registrant_user_id: yubin });
    expect(log.place.saves).toEqual([expect.objectContaining({ added_by: "유빈", added_by_user_id: yubin })]);
    expect(log.place.sources).toEqual([expect.objectContaining({ shared_by: "수민", shared_by_user_id: sumin, linked_by: "유빈", linked_by_user_id: yubin })]);
  });
});

describe("019 이후 쓰기·이름 바꾸기·권한·알림", () => {
  beforeEach(async () => {
    await pg.exec("truncate boards, app_users cascade");
    await people();
  });

  it("저장·링크·메모·알림 기록에 이름과 함께 계정 id를 적는다(이름만 넘기는 함수도)", async () => {
    const begun = await one("select dm_begin_source($1,'https://www.instagram.com/p/N/','post','수민','owner',false) r", [ours]);
    expect((await q("select shared_by, shared_by_user_id from sources where id=$1", [begun.source.id]))[0]).toEqual({ shared_by: "수민", shared_by_user_id: sumin });
    const id = await save(ours, "수민", "1", begun.source.id);
    expect((await q("select added_by_user_id from place_saves where place_id=$1", [id]))[0].added_by_user_id).toBe(sumin);
    expect((await q("select added_by_user_id from source_places where place_id=$1", [id]))[0].added_by_user_id).toBe(sumin);
    expect((await q("select added_by_user_id from place_push_events where place_id=$1", [id]))[0].added_by_user_id).toBe(sumin);
    await one("select dm_patch_place($1,$2,'유빈',$3,0) r", [ours, id, JSON.stringify({ memo: "웨이팅" })]);
    expect((await q("select memo_updated_by, memo_updated_by_user_id from places where id=$1", [id]))[0]).toEqual({ memo_updated_by: "유빈", memo_updated_by_user_id: yubin });
    // 상태만 바꾸면 메모 쓴 사람은 그대로
    await one("select dm_patch_place($1,$2,'수민',$3,null) r", [ours, id, JSON.stringify({ status: "visited" })]);
    expect((await q("select memo_updated_by_user_id from places where id=$1", [id]))[0].memo_updated_by_user_id).toBe(yubin);
    // 서버 코드가 직접 넣는 기록(같은 링크 다시 공유)도 트리거가 채운다
    await q("insert into place_saves(board_id,place_id,added_by) values($1,$2,'유빈')", [ours, id]);
    expect((await q("select added_by_user_id from place_saves where place_id=$1 and added_by='유빈'", [id]))[0].added_by_user_id).toBe(yubin);
  });

  it("이름을 바꿔도 지난 기록은 고쳐 쓰지 않고, 같은 계정의 지금 이름으로 보인다", async () => {
    const id = await save(ours, "유빈", "2");
    await one("select dm_patch_place($1,$2,'유빈',$3,0) r", [ours, id, JSON.stringify({ memo: "첫 메모" })]);
    await q("insert into access_sessions(token_hash,board_id,purpose,member_name,auth_version,expires_at,user_id) values('s1',$1,'member','유빈',0,now()+interval '1 day',$2)", [ours, yubin]);
    const revision = Number(await one("select dm_board_revision($1) r", [ours]));
    await rename(yubin, "유빈이");
    expect((await q("select added_by, added_by_user_id from place_saves where place_id=$1", [id]))[0]).toEqual({ added_by: "유빈", added_by_user_id: yubin });
    expect(await shown(ours, yubin, "유빈")).toBe("유빈이");
    expect(Number(await one("select dm_board_revision($1) r", [ours]))).toBeGreaterThan(revision); // 지도 목록이 새 이름으로 다시 받아짐
    expect((await q("select member_names from boards where id=$1", [ours]))[0].member_names).toEqual(["유빈이", "수민"]);
    expect((await q("select member_name from access_sessions where token_hash='s1'"))[0].member_name).toBe("유빈이");
    // 충돌 안내도 지금 이름
    expect(await one("select dm_patch_place($1,$2,'수민',$3,0) r", [ours, id, JSON.stringify({ memo: "다른 메모" })])).toMatchObject({ code: "MEMO_CONFLICT", memo_updated_by: "유빈이" });
    // 새 이름으로 다시 저장해도 같은 사람의 저장 기록이 하나 더 생기지 않는다
    await save(ours, "유빈이", "2");
    expect(await q("select added_by from place_saves where place_id=$1", [id])).toEqual([{ added_by: "유빈" }]);
    // 방에서 나가면 그때 기록된 이름으로 보인다
    await one("select dm_remove_member($1,$2,$3) r", [yubin, ours, yubin]);
    expect(await shown(ours, yubin, "유빈")).toBe("유빈");
    await expect(rename(sumin, "유빈이")).resolves.toMatchObject({ name: "유빈이" });
  });

  it("처음 등록한 사람은 이름을 바꿔도 지울 수 있고, 다른 멤버는 그 옛 이름을 가져가도 못 지운다", async () => {
    const id = await save(ours, "유빈", "3");
    await save(ours, "수민", "3");
    await rename(yubin, "유빈이");
    await rename(sumin, "유빈"); // 수민이 유빈의 옛 이름을 씀
    await expect(del(sumin, ours, id)).rejects.toThrow("유빈이님이 등록한 장소라 지울 수 없어요");
    expect(await del(yubin, ours, id)).toMatchObject({ ok: true, deleted_id: id });
  });

  it("id가 없는 예전 기록은 이름으로 비교한다(멤버가 아닌 예전 이름이면 누구나 지움)", async () => {
    await q("update boards set member_names = member_names || array['옛이름'] where id=$1", [ours]);
    const legacy = await save(ours, "옛이름", "4");
    expect((await q("select added_by_user_id from place_saves where place_id=$1", [legacy]))[0].added_by_user_id).toBeNull();
    expect(await del(sumin, ours, legacy)).toMatchObject({ ok: true });
  });

  it("알림: 이름을 바꾼 저장한 사람 본인은 받지 않고, 다른 멤버가 받는 제목에는 지금 이름이 나온다", async () => {
    for (const [user, token] of [[yubin, "y1"], [sumin, "s1"]]) {
      await q("insert into access_sessions(token_hash,board_id,purpose,member_name,auth_version,expires_at,user_id) values($1,$2,'member',null,0,now()+interval '1 day',$3)", [token, ours, user]);
      await q("insert into push_subscriptions(endpoint_hash,endpoint,p256dh,auth,board_id,session_hash,created_at) values($1,$2,'k','a',$3,$1,now()-interval '1 minute')", [token, `https://web.push.apple.com/${token}`, ours]);
    }
    await save(ours, "유빈", "5");
    await rename(yubin, "유빈이");
    await rename(sumin, "유빈"); // 옛 이름이 다른 사람 것이 돼도 받는 사람은 id로 고른다
    const claimed = await q("select * from dm_claim_push_deliveries($1)", [ours]);
    expect(claimed.map((c) => c.endpoint)).toEqual(["https://web.push.apple.com/s1"]);
    expect(claimed[0]).toMatchObject({ added_by: "유빈이", folder_name: "우리 데이트맵" });
  });

  it("삭제 기록에서 복구하면 저장한 사람·공유한 사람 id도 돌아오고, 그 사이 탈퇴한 계정은 이름만 남는다", async () => {
    const src = (await q("insert into sources(board_id,url,media_type,shared_by,status) values($1,'https://www.instagram.com/p/R/','post','수민','done') returning id", [ours]))[0].id;
    const id = await save(ours, "유빈", "6", src);
    await save(ours, "수민", "6");
    await del(yubin, ours, id);
    await rename(yubin, "유빈이");
    await one("select dm_delete_account($1) r", [sumin]);
    const [log] = await q("select id from place_trash_log where user_id=$1", [yubin]);
    const restored = await one("select dm_restore_place($1,$2) r", [yubin, log.id]);
    expect(await q("select added_by, added_by_user_id from place_saves where place_id=$1 order by added_at", [restored.place_id])).toEqual([
      { added_by: "유빈", added_by_user_id: yubin }, { added_by: "수민", added_by_user_id: null }]);
    expect(await q("select so.shared_by, so.shared_by_user_id, sp.added_by_user_id from source_places sp join sources so on so.id=sp.source_id where sp.place_id=$1", [restored.place_id]))
      .toEqual([{ shared_by: "수민", shared_by_user_id: null, added_by_user_id: yubin }]);
  });

  it("담기는 담은 사람과 원래 방의 공유한 사람 id를 그대로 옮긴다(대상 방에서 이름으로 다시 찾지 않음)", async () => {
    const src = (await q("insert into sources(board_id,url,media_type,shared_by,status) values($1,'https://www.instagram.com/p/C/','post','수민','done') returning id", [ours]))[0].id;
    const id = await save(ours, "수민", "7", src);
    const result = await one("select dm_copy_places($1,$2,$3,$4::uuid[]) r", [yubin, ours, mine, [id]]);
    const copied = result.place_ids[0];
    expect(await q("select added_by, added_by_user_id from place_saves where place_id=$1", [copied])).toEqual([{ added_by: "유빈", added_by_user_id: yubin }]);
    expect(await q("select so.shared_by_user_id, sp.added_by, sp.added_by_user_id from source_places sp join sources so on so.id=sp.source_id where sp.place_id=$1", [copied]))
      .toEqual([{ shared_by_user_id: sumin, added_by: "수민", added_by_user_id: sumin }]);
  });

  it("탈퇴하면 id는 비고 이름 기록은 남는다", async () => {
    const id = await save(ours, "수민", "8");
    await one("select dm_delete_account($1) r", [sumin]);
    expect(await q("select added_by, added_by_user_id from place_saves where place_id=$1", [id])).toEqual([{ added_by: "수민", added_by_user_id: null }]);
    expect(await shown(ours, null, "수민")).toBe("수민");
    expect(await del(yubin, ours, id)).toMatchObject({ ok: true });
  });
});
