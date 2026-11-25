import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// 020: 새 장소(NEW)를 본 기록. 보면 나에게서만 NEW가 사라지고, 내가 멤버인 방의 아직 새 장소만 적습니다.
let pg: PGlite;
const files = ["002_couple_access", "003_board_sync", "004_place_push", "005_reliable_workflows", "006_place_trash", "007_memo_push", "008_memo_push_fixes", "009_source_content_sync", "010_collections", "011_accounts", "012_folders", "013_place_details", "014_profiles", "015_terms", "016_account_delete_pin_cleanup", "017_folder_transfer_push", "018_room_look", "019_user_id_records"];
const q = async (sql: string, params: unknown[] = []) => (await pg.query<any>(sql, params)).rows;
const one = async (sql: string, params: unknown[] = []) => (await q(sql, params))[0]?.r;
const place = (k: string) => JSON.stringify({ kakao_place_id: k, name: `카페${k}`, address: "서울", lat: 37.5, lng: 127, category: "카페", kakao_url: "https://place.map.kakao.com/1" });
const save = (board: string, who: string, k: string) => one("select dm_save_place($1,$2,$3,null) r", [board, place(k), who]);
const mark = (user: string, ids: string[]) => one("select dm_mark_seen($1,$2::uuid[]) r", [user, ids]);
const seen = async (user: string) => [...(await one("select dm_seen_places($1) r", [user]))].sort();
let yubin: string, sumin: string, mine: string, ours: string, theirs: string;

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec("create role anon; create role authenticated; create role service_role; create function gen_random_bytes(n integer) returns bytea language sql volatile as $$ select decode(substr(repeat(md5(random()::text),4),1,n*2),'hex') $$;");
  await pg.exec(readFileSync("supabase/schema.sql", "utf8").replace("create extension if not exists pgcrypto;", "").split("-- 보드 하나 만들기")[0]);
  for (const f of files) await pg.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"));
  const migration = readFileSync("supabase/migrations/020_place_seen.sql", "utf8");
  await pg.exec(migration); await pg.exec(migration); // 두 번 실행해도 같은 결과
  const a = await one("select dm_login('kakao','a',null,'유빈',null) r"), b = await one("select dm_login('kakao','b',null,'수민',null) r");
  yubin = a.user_id; sumin = b.user_id; mine = a.board_id; theirs = b.board_id;
  ours = (await one("select dm_create_folder($1,'우리 데이트맵','red',null) r", [yubin])).board_id;
  await q("insert into board_members(board_id,user_id,role,member_name) values($1,$2,'member','수민')", [ours, sumin]);
}, 30000);
afterAll(async () => { await pg?.close(); });

describe("020 본 장소 기록", () => {
  it("내가 멤버인 방의 새 장소만 적고, 같은 장소를 다시 봐도 한 번만 남는다", async () => {
    const a = await save(ours, "수민", "1"), b = await save(mine, "유빈", "2"), c = await save(theirs, "수민", "3");
    expect(await mark(yubin, [a, b, c])).toBe(2); // 수민 님 혼자 방(theirs)의 장소는 건너뜀
    expect(await mark(yubin, [a])).toBe(0);
    expect(await seen(yubin)).toEqual([a, b].sort());
    // 본 기록은 사람마다 따로: 수민 님에게는 아직 새 장소
    expect(await seen(sumin)).toEqual([]);
    expect(await mark(sumin, [a, c])).toBe(2);
    expect(await seen(sumin)).toEqual([a, c].sort());
  });

  it("등록한 지 25시간이 지난(이미 NEW가 아닌) 장소와 지운 장소는 적지 않는다", async () => {
    const old = await save(ours, "수민", "4"), gone = await save(ours, "수민", "5");
    await q("update places set created_at = now() - interval '26 hours' where id = $1", [old]);
    await one("select dm_delete_place($1,$2,$3) r", [sumin, ours, gone]);
    expect(await mark(yubin, [old, gone])).toBe(0);
  });

  it("이틀 지난 기록은 목록에 없고, 사흘 지난 기록은 다음에 적을 때 지운다. 장소를 지우면 기록도 사라진다", async () => {
    const x = await save(ours, "수민", "6"), y = await save(ours, "수민", "7"), z = await save(ours, "수민", "8");
    await mark(yubin, [x, y]);
    await q("update place_seen set seen_at = now() - interval '4 days' where user_id = $1 and place_id = $2", [yubin, x]);
    expect(await seen(yubin)).not.toContain(x);
    await mark(yubin, [z]);
    expect((await q("select place_id from place_seen where user_id = $1 and place_id = $2", [yubin, x])).length).toBe(0);
    await one("select dm_delete_place($1,$2,$3) r", [sumin, ours, y]);
    expect(await seen(yubin)).not.toContain(y);
  });

  it("한 번에 500곳까지, 빈 목록·없는 사람은 0", async () => {
    expect(await mark(yubin, [])).toBe(0);
    const many = Array.from({ length: 501 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    await expect(mark(yubin, many)).rejects.toThrow("500곳");
    expect(await one("select dm_mark_seen(null, '{}'::uuid[]) r")).toBe(0);
  });

  it("탈퇴하면 그 사람의 기록도 지운다", async () => {
    const p = await save(ours, "수민", "9");
    await mark(sumin, [p]);
    await q("delete from app_users where id = $1", [sumin]);
    expect((await q("select count(*)::int n from place_seen where user_id = $1", [sumin]))[0].n).toBe(0);
  });

  it("anon·authenticated는 표와 함수에 접근할 수 없다", async () => {
    const grants = await q("select grantee, privilege_type from information_schema.role_table_grants where table_name = 'place_seen' and grantee in ('anon','authenticated')");
    expect(grants).toEqual([]);
    const fn = await q("select has_function_privilege('authenticated', 'public.dm_mark_seen(uuid, uuid[])', 'execute') r");
    expect(fn[0].r).toBe(false);
  });
});
