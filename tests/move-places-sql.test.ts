import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
// 022: 다른 방으로 옮기기. 옮기면 지금 방에서 빠지고, 처음 등록한 사람만 옮길 수 있습니다(삭제와 같은 규칙). 삭제 기록은 남기지 않습니다.
let pg: PGlite;
const files = ["002_couple_access", "003_board_sync", "004_place_push", "005_reliable_workflows", "006_place_trash", "007_memo_push", "008_memo_push_fixes", "009_source_content_sync", "010_collections", "011_accounts", "012_folders", "013_place_details", "014_profiles", "015_terms", "016_account_delete_pin_cleanup", "017_folder_transfer_push", "018_room_look", "019_user_id_records", "020_place_seen", "021_onboarding"];
const q = async (sql: string, params: unknown[] = []) => (await pg.query<any>(sql, params)).rows;
const one = async (sql: string, params: unknown[] = []) => (await q(sql, params))[0]?.r;
const place = (k: string) => JSON.stringify({ kakao_place_id: k, name: `카페${k}`, address: "서울", lat: 37.5, lng: 127, category: "카페", kakao_url: "https://place.map.kakao.com/1" });
const save = (board: string, who: string, k: string) => one("select dm_save_place($1,$2,$3) r", [board, place(k), who]);
const move = (ids: string[], from: string, to: string, user: string) => one("select dm_move_places($1,$2,$3,$4::uuid[]) r", [user, from, to, ids]);
const inRoom = async (board: string) => (await q("select kakao_place_id k from places where board_id=$1 order by kakao_place_id", [board])).map((r) => r.k);
let yubin: string, sumin: string, mine: string, ours: string, suminRoom: string;

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec("create role anon; create role authenticated; create role service_role; create function gen_random_bytes(n integer) returns bytea language sql volatile as $$ select decode(substr(repeat(md5(random()::text),4),1,n*2),'hex') $$;");
  await pg.exec(readFileSync("supabase/schema.sql", "utf8").replace("create extension if not exists pgcrypto;", "").split("-- 보드 하나 만들기")[0]);
  for (const f of files) await pg.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"));
  const migration = readFileSync("supabase/migrations/022_move_places.sql", "utf8");
  await pg.exec(migration); await pg.exec(migration); // 두 번 실행해도 같은 결과
}, 30000);
afterAll(async () => { await pg?.close(); });
beforeEach(async () => {
  await pg.exec("truncate boards, app_users cascade");
  const a = await one("select dm_login('kakao','a',null,'유빈',null) r"); const b = await one("select dm_login('kakao','b',null,'수민',null) r");
  yubin = a.user_id; sumin = b.user_id; mine = a.board_id; suminRoom = b.board_id;
  ours = (await one("select dm_create_folder($1,'우리 데이트맵','red','heart') r", [yubin])).board_id;
  await q("insert into board_members(board_id,user_id,role,member_name) values($1,$2,'member','수민')", [ours, sumin]);
});

describe("022 다른 방으로 옮기기", () => {
  it("내가 등록한 장소는 옮겨지고 지금 방에서 빠지며, 메모·모음 기록은 옮길 방 기준으로 남고 삭제 기록은 없다", async () => {
    const id = await save(ours, "유빈", "1");
    await q("update places set memo='창가 자리' where id=$1", [id]);
    const result = await move([id], ours, mine, yubin);
    expect(result).toMatchObject({ from: ours, to: mine, created: 1, merged: 0, moved_ids: [id] });
    expect(await inRoom(ours)).toEqual([]);
    expect(await inRoom(mine)).toEqual(["1"]);
    expect((await q("select memo from places where board_id=$1", [mine]))[0].memo).toBe("창가 자리");
    expect(await q("select id from place_trash_log")).toEqual([]);
  });

  it("다른 멤버가 등록한 장소는 옮길 수 없고, 하나라도 막히면 아무것도 옮기지 않는다", async () => {
    const mineId = await save(ours, "유빈", "1"), hers = await save(ours, "수민", "2");
    await expect(move([mineId, hers], ours, mine, yubin)).rejects.toThrow("수민님이 등록한 장소라 옮길 수 없어요.");
    expect(await inRoom(ours)).toEqual(["1", "2"]);
    expect(await inRoom(mine)).toEqual([]);
  });

  it("등록한 사람이 방을 나갔으면 남은 멤버가 옮길 수 있다", async () => {
    const hers = await save(ours, "수민", "2");
    await q("delete from board_members where board_id=$1 and user_id=$2", [ours, sumin]);
    expect((await move([hers], ours, mine, yubin)).moved_ids).toEqual([hers]);
    expect(await inRoom(ours)).toEqual([]);
  });

  it("옮길 방에 같은 가게가 있으면 그쪽을 두고 메모만 합친 뒤 지금 방에서 뺀다", async () => {
    const there = await save(mine, "유빈", "1"); const here = await save(ours, "유빈", "1");
    await q("update places set memo='먼저 쓴 메모' where id=$1", [there]);
    await q("update places set memo='옮길 메모' where id=$1", [here]);
    expect(await move([here], ours, mine, yubin)).toMatchObject({ created: 0, merged: 1, place_ids: [there] });
    expect(await inRoom(ours)).toEqual([]);
    expect((await q("select memo from places where id=$1", [there]))[0].memo).toContain("옮길 메모");
  });

  it("같은 방·참여하지 않은 방·없는 장소는 거절한다", async () => {
    const id = await save(ours, "유빈", "1");
    await expect(move([id], ours, ours, yubin)).rejects.toThrow("다른 방을 골라 주세요.");
    await expect(move([id], ours, suminRoom, yubin)).rejects.toThrow("참여한 방 사이에서만 옮길 수 있어요.");
    await expect(move([id], mine, ours, yubin)).rejects.toThrow("옮길 장소를 찾지 못했어요");
    expect(await inRoom(ours)).toEqual(["1"]);
  });

  it("service_role만 부를 수 있다", async () => {
    const grants = await q("select grantee from information_schema.routine_privileges where routine_name='dm_move_places' and privilege_type='EXECUTE' order by grantee");
    expect(grants.map((g) => g.grantee)).not.toContain("anon");
    expect(grants.map((g) => g.grantee)).not.toContain("authenticated");
    expect(grants.map((g) => g.grantee)).toContain("service_role");
  });
});
