import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// 018: 방은 이름 + 색 10가지, 모음은 색 10가지 + 이모지, 방은 계정당 10개까지.
let pg: PGlite;
const files = ["002_couple_access", "003_board_sync", "004_place_push", "005_reliable_workflows", "006_place_trash", "007_memo_push", "008_memo_push_fixes", "009_source_content_sync", "010_collections", "011_accounts", "012_folders", "013_place_details", "014_profiles", "015_terms", "016_account_delete_pin_cleanup", "017_folder_transfer_push"];
const q = async (sql: string, params: unknown[] = []) => (await pg.query<any>(sql, params)).rows;
const one = async (sql: string, params: unknown[] = []) => (await q(sql, params))[0]?.r;
const login = (subject: string, name: string) => one("select dm_login('kakao',$1,null,$2,null) r", [subject, name]);
const change = (board: string, command: object) => one("select dm_change_collection($1,'유빈',gen_random_uuid(),$2) r", [board, JSON.stringify(command)]);
const collection = (icon: string, color = "red", name = `모음 ${icon}`) => ({ action: "create", id: randomUUID(), name, description: "", color, icon });
let yubin: string, board: string;
const legacy: Record<string, string> = {};

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec("create role anon; create role authenticated; create role service_role; create function gen_random_bytes(n integer) returns bytea language sql volatile as $$ select decode(substr(repeat(md5(random()::text),4),1,n*2),'hex') $$;");
  await pg.exec(readFileSync("supabase/schema.sql", "utf8").replace("create extension if not exists pgcrypto;", "").split("-- 보드 하나 만들기")[0]);
  for (const f of files) await pg.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"));
  // 018 이전에 만든 방·모음(예전 선 아이콘)
  const a = await login("a", "유빈"); yubin = a.user_id; board = a.board_id;
  for (const icon of ["heart", "map", "cup", "food", "tree", "culture"]) legacy[icon] = (await change(board, collection(icon, "blue"))).id;
  const migration = readFileSync("supabase/migrations/018_room_look.sql", "utf8");
  await pg.exec(migration); await pg.exec(migration); // 두 번 실행해도 같은 결과
}, 30000);
afterAll(async () => { await pg?.close(); });

describe("018 방과 모음의 색·표지", () => {
  it("예전 모음의 선 아이콘을 비슷한 이모지로 바꾸고, 색·이름은 그대로 둔다", async () => {
    const rows = await q("select id, icon, color, version from collections where board_id=$1", [board]);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(Object.fromEntries(Object.entries(legacy).map(([key, id]) => [key, byId[id].icon]))).toEqual({ heart: "💞", map: "🗺️", cup: "☕", food: "🍜", tree: "🌿", culture: "🎨" });
    expect(rows.every((r) => r.color === "blue" && r.version === 1)).toBe(true);
  });

  it("모음은 10가지 색과 이모지 하나를 받고, 글자·태그·모르는 색은 거절한다", async () => {
    for (const [icon, color] of [["🍷", "plum"], ["🏖️", "teal"], ["👩‍❤️‍👨", "navy"], ["🇰🇷", "taupe"], ["1️⃣", "olive"], ["☕", "orange"]]) {
      expect(await change(board, collection(icon, color, `새 ${icon}`))).toMatchObject({ ok: true });
    }
    for (const icon of ["가", "abc", "<b>", "", " ", "☕ 카페", "🍷".repeat(17)]) expect(await change(board, collection(icon, "red", `틀림 ${icon}`))).toEqual({ code: "INVALID_COMMAND" });
    expect(await change(board, collection("☕", "purple", "보라"))).toEqual({ code: "INVALID_COMMAND" });
    // 옛 화면이 보낸 선 아이콘 키도 계속 받는다
    expect(await change(board, collection("map", "gold", "옛 화면"))).toMatchObject({ ok: true });
    // 테이블 검사도 함께 막는다
    await expect(q("update collections set icon='script' where id=$1", [legacy.heart])).rejects.toThrow();
    await expect(q("update collections set color='purple' where id=$1", [legacy.heart])).rejects.toThrow();
  });

  it("방은 새 색으로 만들고 바꿀 수 있고, 아이콘은 그대로 둔다", async () => {
    const { board_id } = await one("select dm_create_folder($1,'친구들 맛집','navy',null) r", [yubin]);
    expect((await q("select color, icon from boards where id=$1", [board_id]))[0]).toEqual({ color: "navy", icon: "heart" });
    await one("select dm_update_folder($1,$2,'친구들 맛집','plum',null) r", [yubin, board_id]);
    expect((await q("select color, icon from boards where id=$1", [board_id]))[0]).toEqual({ color: "plum", icon: "heart" });
    await expect(one("select dm_update_folder($1,$2,'x','purple',null) r", [yubin, board_id])).rejects.toThrow();
    await q("delete from boards where id=$1", [board_id]);
  });

  it("방은 만들기·참여 모두 10개까지이고, 이미 넘긴 계정은 그대로 둔다", async () => {
    // "내 장소" 1개 + 9개 = 10개
    for (let i = 1; i <= 9; i++) await one("select dm_create_folder($1,$2,'red',null) r", [yubin, `방 ${i}`]);
    await expect(one("select dm_create_folder($1,'열한 번째','red',null) r", [yubin])).rejects.toThrow("방은 10개까지 만들 수 있어요");
    const b = await login("b", "수민");
    const token = "c".repeat(64);
    await one("select dm_create_invite($1,$2,$3) r", [b.user_id, b.board_id, token]);
    await expect(one("select dm_accept_invite($1,$2) r", [yubin, token])).rejects.toThrow("방은 10개까지 들어갈 수 있어요");
    // 이미 10개를 넘긴 계정(018 이전에 참여)은 방을 잃지 않고, 이미 멤버인 방의 초대는 그대로 열린다
    await q("insert into board_members(board_id,user_id,role,member_name) values($1,$2,'member','유빈')", [b.board_id, yubin]);
    expect((await q("select count(*)::int n from board_members where user_id=$1", [yubin]))[0].n).toBe(11);
    expect(await one("select dm_accept_invite($1,$2) r", [yubin, token])).toEqual({ board_id: b.board_id });
    expect((await one("select dm_list_folders($1) r", [yubin])).length).toBe(11);
  });
});
