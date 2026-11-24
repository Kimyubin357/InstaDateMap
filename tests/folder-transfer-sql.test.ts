import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
let pg: PGlite;
const files = ["002_couple_access", "003_board_sync", "004_place_push", "005_reliable_workflows", "006_place_trash", "007_memo_push", "008_memo_push_fixes", "009_source_content_sync", "010_collections", "011_accounts", "012_folders", "013_place_details", "014_profiles", "015_terms", "016_account_delete_pin_cleanup", "017_folder_transfer_push"];
const q = async (sql: string, params: unknown[] = []) => (await pg.query<any>(sql, params)).rows;
const one = async (sql: string, params: unknown[] = []) => (await q(sql, params))[0]?.r;
const place = (k: string, name = `카페${k}`) => JSON.stringify({ kakao_place_id: k, name, address: "서울", lat: 37.5, lng: 127, category: "카페", kakao_url: "https://place.map.kakao.com/1" });
let yubin: string, sumin: string, mine: string, ours: string, theirs: string;
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec("create role anon; create role authenticated; create role service_role; create function gen_random_bytes(n integer) returns bytea language sql volatile as $$ select decode(substr(repeat(md5(random()::text),4),1,n*2),'hex') $$;");
  await pg.exec(readFileSync("supabase/schema.sql", "utf8").replace("create extension if not exists pgcrypto;", "").split("-- 보드 하나 만들기")[0]);
  for (const f of files) await pg.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"));
  await pg.exec(readFileSync("supabase/migrations/017_folder_transfer_push.sql", "utf8"));
}, 30000);
afterAll(async () => { await pg?.close(); });
beforeEach(async () => {
  await pg.exec("truncate boards, app_users cascade");
  const a = await one("select dm_login('kakao','a',null,'유빈',null) r"); const b = await one("select dm_login('kakao','b',null,'수민',null) r");
  yubin = a.user_id; sumin = b.user_id; mine = a.board_id;
  ours = (await one("select dm_create_folder($1,'우리 데이트맵','red','heart') r", [yubin])).board_id;
  await q("insert into board_members(board_id,user_id,role,member_name) values($1,$2,'member','수민')", [ours, sumin]);
  theirs = b.board_id;
});
const copy = (ids: string[], from = ours, to = mine, user = yubin) => one("select dm_copy_places($1,$2,$3,$4::uuid[]) r", [user, from, to, ids]);
const del = (place: string, board = ours, user = yubin) => one("select dm_delete_place($1,$2,$3) r", [user, board, place]);
const logs = (user = yubin) => q("select id, board_id, board_name, kakao_place_id, place from place_trash_log where user_id=$1 order by deleted_at", [user]);

describe("방 사이 담기(복사)", () => {
  it("담기는 상태·메모·원본 링크를 대상 방에 복사하고 원래 장소는 그대로 둔다", async () => {
    const src = (await q("insert into sources(board_id,url,media_type,shared_by,status) values($1,'https://www.instagram.com/p/A/','post','수민','done') returning id", [ours]))[0].id;
    const id = await one("select dm_save_place($1,$2,'수민',$3) r", [ours, place("1"), src]);
    await q("update places set status='visited', memo='창가 자리' where id=$1", [id]);
    expect(await copy([id])).toMatchObject({ to: mine, created: 1, merged: 0 });
    const made = (await q("select * from places where board_id=$1", [mine]))[0];
    expect(made).toMatchObject({ kakao_place_id: "1", status: "visited", memo: "창가 자리" });
    expect(await q("select s.url, sp.added_by from source_places sp join sources s on s.id=sp.source_id where sp.place_id=$1", [made.id])).toEqual([{ url: "https://www.instagram.com/p/A/", added_by: "수민" }]);
    expect(await q("select id from places where id=$1", [id])).toHaveLength(1);
    expect((await q("select added_by from place_saves where place_id=$1", [made.id])).map((r) => r.added_by)).toEqual(["유빈"]);
  });
  it("같은 가게가 있으면 대상 장소를 그대로 두고(박힌 돌) 메모만 깃허브처럼 합친다", async () => {
    const a = (await q("insert into sources(board_id,url,media_type,shared_by,status) values($1,'https://www.instagram.com/p/A/','post','수민','done') returning id", [ours]))[0].id;
    const b = (await q("insert into sources(board_id,url,media_type,shared_by,status) values($1,'https://www.instagram.com/p/B/','post','유빈','done') returning id", [mine]))[0].id;
    const incoming = await one("select dm_save_place($1,$2,'수민',$3) r", [ours, place("2"), a]);
    const resident = await one("select dm_save_place($1,$2,'유빈',$3) r", [mine, place("2"), b]);
    await q("update places set status='visited', memo='웨이팅 김' where id=$1", [incoming]);
    await q("update places set status='again', memo='파스타 맛집' where id=$1", [resident]);
    expect(await copy([incoming])).toMatchObject({ created: 0, merged: 1, place_ids: [resident] });
    expect((await q("select status, memo, memo_version from places where id=$1", [resident]))[0]).toEqual({ status: "again", memo: "파스타 맛집\n\n웨이팅 김", memo_version: 1 });
    expect((await q("select s.url from source_places sp join sources s on s.id=sp.source_id where sp.place_id=$1", [resident])).map((r) => r.url)).toEqual(["https://www.instagram.com/p/B/"]);
    // 같은 메모면 바꾸지 않음
    await copy([incoming]);
    expect((await q("select memo_version from places where id=$1", [resident]))[0].memo_version).toBe(1);
  });
  it("참여하지 않은 방이나 같은 방으로는 담을 수 없다", async () => {
    const id = await one("select dm_save_place($1,$2,'유빈') r", [ours, place("5")]);
    await expect(copy([id], ours, theirs)).rejects.toThrow("참여한 방 사이에서만");
    await expect(copy([id], ours, ours)).rejects.toThrow("다른 방을 골라");
    const other = await one("select dm_save_place($1,$2,'수민') r", [theirs, place("6")]);
    await expect(copy([other])).rejects.toThrow("담을 장소를 찾지 못했어요");
  });
});

describe("삭제 권한과 개인 삭제 기록", () => {
  it("처음 등록한 사람만 지울 수 있고, 지우면 방에서 빠지고 지운 사람의 기록에만 남는다", async () => {
    const id = await one("select dm_save_place($1,$2,'수민') r", [ours, place("7")]);
    await one("select dm_save_place($1,$2,'유빈') r", [ours, place("7")]); // 유빈도 저장(둘 다 저장함)
    await expect(del(id)).rejects.toThrow("수민님이 등록한 장소라 지울 수 없어요");
    expect(await del(id, ours, sumin)).toMatchObject({ ok: true, deleted_id: id });
    expect(await q("select id from places where id=$1", [id])).toHaveLength(0);
    expect(await logs(yubin)).toHaveLength(0);
    const [log] = await logs(sumin);
    expect(log).toMatchObject({ board_id: ours, board_name: "우리 데이트맵", kakao_place_id: "7" });
    expect(log.place.registrant).toBe("수민");
    // 같은 가게를 다시 등록하면 그냥 새로 등록된다
    const again = await one("select dm_save_place($1,$2,'유빈') r", [ours, place("7")]);
    expect(again).not.toBe(id);
    expect(await del(id, ours, sumin)).toMatchObject({ already_deleted: true });
  });
  it("등록한 사람이 방을 나가면 남은 멤버 누구나 지울 수 있다", async () => {
    const id = await one("select dm_save_place($1,$2,'수민') r", [ours, place("8")]);
    await q("delete from board_members where board_id=$1 and user_id=$2", [ours, sumin]);
    expect(await del(id)).toMatchObject({ ok: true });
  });
  it("복구는 지웠던 방으로, 같은 가게가 다시 등록돼 있으면 그 장소를 두고 메모만 합친다", async () => {
    const src = (await q("insert into sources(board_id,url,media_type,shared_by,status) values($1,'https://www.instagram.com/p/C/','post','유빈','done') returning id", [ours]))[0].id;
    const id = await one("select dm_save_place($1,$2,'유빈',$3) r", [ours, place("9"), src]);
    await q("update places set status='visited', memo='첫 메모' where id=$1", [id]);
    await del(id);
    let [log] = await logs();
    const restored = await one("select dm_restore_place($1,$2) r", [yubin, log.id]);
    expect(restored).toMatchObject({ ok: true, board_id: ours, merged: false });
    expect((await q("select status, memo from places where id=$1", [restored.place_id]))[0]).toEqual({ status: "visited", memo: "첫 메모" });
    expect((await q("select s.url from source_places sp join sources s on s.id=sp.source_id where sp.place_id=$1", [restored.place_id])).map((r) => r.url)).toEqual(["https://www.instagram.com/p/C/"]);
    expect(await logs()).toHaveLength(0);
    // 지운 뒤 수민이 같은 가게를 다시 등록 → 복구하면 수민의 장소 유지 + 메모 합치기
    await del(restored.place_id);
    const resident = await one("select dm_save_place($1,$2,'수민') r", [ours, place("9")]);
    await q("update places set status='again', memo='수민 메모' where id=$1", [resident]);
    [log] = await logs();
    expect(await one("select dm_restore_place($1,$2) r", [yubin, log.id])).toMatchObject({ merged: true, place_id: resident });
    expect((await q("select status, memo from places where id=$1", [resident]))[0]).toEqual({ status: "again", memo: "수민 메모\n\n첫 메모" });
  });
  it("방이 없어지거나 나간 방의 기록은 복구할 수 없고, 다른 사람 기록은 건드릴 수 없다", async () => {
    const id = await one("select dm_save_place($1,$2,'유빈') r", [ours, place("10")]);
    await del(id);
    const [log] = await logs();
    expect(await one("select dm_restore_place($1,$2) r", [sumin, log.id])).toEqual({ code: "LOG_NOT_FOUND" });
    expect(await one("select dm_purge_trash_log($1,$2) r", [sumin, log.id])).toEqual({ ok: true, purged: false });
    await q("delete from board_members where board_id=$1 and user_id=$2", [ours, yubin]);
    await expect(q("select dm_restore_place($1,$2)", [yubin, log.id])).rejects.toThrow("복구할 수 없어요");
    expect(await one("select dm_purge_trash_log($1,$2) r", [yubin, log.id])).toEqual({ ok: true, purged: true });
  });
});

describe("폴더별 알림", () => {
  async function device(user: string, board: string | null, token: string) {
    await q("insert into access_sessions(token_hash,board_id,purpose,member_name,auth_version,expires_at,user_id) values($1,$2,'member',null,0,now()+interval '1 day',$3)", [token, board, user]);
  }
  const subscribe = (token: string, board: string, endpoint = token) =>
    q("insert into push_subscriptions(endpoint_hash,endpoint,p256dh,auth,board_id,session_hash,created_at) values($1,$2,'k','a',$3,$4,now()-interval '1 minute')", [endpoint, `https://web.push.apple.com/${endpoint}`, board, token]);
  it("다른 폴더를 열고 있어도 알림을 켠 폴더의 새 장소는 받고, 끈 폴더는 받지 않는다", async () => {
    await device(sumin, theirs, "s1");
    await subscribe("s1", ours);
    await one("select dm_save_place($1,$2,'유빈') r", [ours, place("7")]);
    const claimed = await q("select * from dm_claim_push_deliveries($1)", [ours]);
    expect(claimed).toHaveLength(1); expect(claimed[0]).toMatchObject({ folder_id: ours, folder_name: "우리 데이트맵", added_by: "유빈" });
    // 내 장소(수민 개인 폴더)는 알림을 켜지 않았으므로 유빈이… 아니라 수민 자신이 저장해도 받지 않음
    await one("select dm_save_place($1,$2,'수민') r", [theirs, place("8")]);
    expect(await q("select * from dm_claim_push_deliveries($1)", [theirs])).toHaveLength(0);
  });
  it("저장한 사람의 기기와 폴더에서 나간 사람은 받지 않는다", async () => {
    await device(yubin, ours, "y1"); await subscribe("y1", ours);
    await device(sumin, theirs, "s2"); await subscribe("s2", ours);
    await q("delete from board_members where board_id=$1 and user_id=$2", [ours, sumin]);
    await one("select dm_save_place($1,$2,'유빈') r", [ours, place("9")]);
    expect(await q("select * from dm_claim_push_deliveries($1)", [ours])).toHaveLength(0);
  });
  it("폴더를 바꿔도 구독은 그대로이고, 새로 참여한 폴더에는 알림을 켠 기기가 따라 켜진다", async () => {
    await device(sumin, theirs, "s3"); await subscribe("s3", theirs, "endpoint-s3");
    await q("select dm_switch_folder($1,'s3',$2)", [sumin, ours]);
    expect((await q("select board_id from push_subscriptions where session_hash='s3' order by board_id")).map((r) => r.board_id).sort()).toEqual([theirs].sort());
    const fresh = (await one("select dm_create_folder($1,'친구들','forest','cup') r", [sumin])).board_id;
    expect((await q("select board_id from push_subscriptions where endpoint_hash='endpoint-s3' order by board_id")).map((r) => r.board_id).sort()).toEqual([theirs, fresh].sort());
  });
  it("017은 기존 구독을 같은 계정의 다른 폴더로도 켠다(한 번만)", async () => {
    await device(sumin, theirs, "s4"); await subscribe("s4", theirs, "endpoint-s4");
    const migration = readFileSync("supabase/migrations/017_folder_transfer_push.sql", "utf8");
    await pg.exec(migration); await pg.exec(migration);
    expect((await q("select board_id from push_subscriptions where endpoint_hash='endpoint-s4'")).map((r) => r.board_id).sort()).toEqual([ours, theirs].sort());
  });
});
