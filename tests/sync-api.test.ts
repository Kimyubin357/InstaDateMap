import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, reset, tables, failNext } from "./fakeDb";
import { tokenHash } from "@/lib/token";
vi.mock("@/lib/db", () => ({ db: () => fakeDb }));
import { GET } from "@/app/api/places/route";
import { GET as context } from "@/app/api/access/context/route";
const req = (etag?: string) => new Request("http://localhost/api/places", { headers: { cookie: `datemap_session=${"a".repeat(64)}`, ...(etag ? { "if-none-match": etag } : {}) } });
beforeEach(() => { vi.restoreAllMocks(); reset(); tables.boards = [{ id: "b1", name: "지도", member_names: ["우리", "서로"], auth_version: 1 }]; tables.access_sessions = [{ token_hash: tokenHash("a".repeat(64)), board_id: "b1", purpose: "member", member_name: "우리", auth_version: 1, expires_at: "2030-01-01" }]; tables.board_sync = [{ board_id: "b1", revision: "3" }]; });
describe("변경 번호와 조건부 지도 조회", () => {
  it("카카오 장소 ID를 포함하고 이전 형식 ETag는 최신 목록으로 교체", async () => {
    tables.places = [{ id: "p1", board_id: "b1", kakao_place_id: "123", name: "식당", created_at: "2026-01-01" }];
    const response = await GET(req('"dm2:b1:1:3"')); expect(response.status).toBe(200);
    expect((await response.json()).places[0].kakao_place_id).toBe("123"); expect(response.headers.get("etag")).toBe('"dm5:b1:1:3"');
  });
  it("저장한 사람·처음 등록한 사람·확인 대기의 공유한 사람은 계정 id로 지금 이름을 보여 준다(019)", async () => {
    tables.board_members = [{ board_id: "b1", user_id: "u:우리", member_name: "새우리", role: "owner", joined_at: "2026-01-01" }, { board_id: "b1", user_id: "u:서로", member_name: "서로", role: "member", joined_at: "2026-01-02" }];
    tables.access_sessions[0].user_id = "u:우리";
    tables.places = [{ id: "p1", board_id: "b1", kakao_place_id: "123", name: "식당", created_at: "2026-01-01" }];
    tables.place_saves = [
      { board_id: "b1", place_id: "p1", added_by: "우리", added_by_user_id: "u:우리", added_at: "2026-01-01" },
      { board_id: "b1", place_id: "p1", added_by: "새우리", added_by_user_id: "u:우리", added_at: "2026-01-03" },
      { board_id: "b1", place_id: "p1", added_by: "떠난 사람", added_by_user_id: null, added_at: "2026-01-02" },
    ];
    tables.sources = [{ id: "s1", board_id: "b1", url: "https://www.instagram.com/p/X/", status: "pending_confirm", shared_by: "서로옛이름", shared_by_user_id: "u:서로", shared_at: "2026-01-04" }];
    const body = await (await GET(req())).json();
    expect(body.places[0]).toMatchObject({ sharers: ["새우리", "떠난 사람"], registrant: "새우리", registrant_id: "u:우리" });
    expect(body.pending[0].shared_by).toBe("서로");
    expect(body.pending[0]).not.toHaveProperty("shared_by_user_id");
    const access = await (await context(req())).json();
    expect(access).toMatchObject({ who: "새우리", userId: "u:우리", memberIds: ["u:우리", "u:서로"] });
  });
  it("같은 변경 번호면 304이며 장소 테이블을 조회하지 않음", async () => {
    const first = await GET(req()), etag = first.headers.get("etag")!;
    expect(await first.json()).toMatchObject({ boardId: "b1", authVersion: 1, revision: "3" });
    failNext("places", "select"); const unchanged = await GET(req(etag)); expect(unchanged.status).toBe(304); expect(await unchanged.text()).toBe("");
    expect((await GET(req())).status).toBe(500);
  });
  it("여러 테이블 조회 중 변경되면 재조회하고 일치한 변경 번호로 응답", async () => {
    const original = fakeDb.rpc; const revisions = ["1", "2", "2", "2"];
    vi.spyOn(fakeDb, "rpc").mockImplementation(async (name, p) => name === "dm_board_revision" ? { data: revisions.shift() || "2", error: null } : original(name, p));
    const res = await GET(req()); expect(res.status).toBe(200); expect((await res.json()).revision).toBe("2");
  });
  it("계속 변경 중이면 섞인 목록 대신 재시도 가능한 응답", async () => {
    let revision = 0; vi.spyOn(fakeDb, "rpc").mockResolvedValue({ data: "0", error: null }).mockImplementation(async () => ({ data: String(++revision), error: null }));
    expect((await GET(req())).status).toBe(503);
  });
  it("캐시 ETag가 있어도 만료·다른 인증 버전이면 401", async () => {
    const etag = (await GET(req())).headers.get("etag")!; tables.boards[0].auth_version++;
    expect((await GET(req(etag))).status).toBe(401);
  });
  it("입장 정보 API는 공개 메타데이터만 반환", async () => {
    const data = await (await context(req())).json();
    expect(data).toMatchObject({ boardId: "b1", authVersion: 1, who: "우리" });
    for (const key of ["sessionHash", "token_hash", "pin_hash", "token"]) expect(data).not.toHaveProperty(key);
  });
});
