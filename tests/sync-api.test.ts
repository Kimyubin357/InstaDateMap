import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, reset, tables, failNext } from "./fakeDb";
import { tokenHash } from "@/lib/pin";
vi.mock("@/lib/db", () => ({ db: () => fakeDb }));
import { GET } from "@/app/api/places/route";
import { GET as context } from "@/app/api/access/context/route";
const req = (etag?: string) => new Request("http://localhost/api/places", { headers: { cookie: `datemap_session=${"a".repeat(64)}`, ...(etag ? { "if-none-match": etag } : {}) } });
beforeEach(() => { vi.restoreAllMocks(); reset(); tables.boards = [{ id: "b1", name: "지도", member_names: ["우리", "서로"], auth_version: 1 }]; tables.access_sessions = [{ token_hash: tokenHash("a".repeat(64)), board_id: "b1", purpose: "member", member_name: "우리", auth_version: 1, expires_at: "2030-01-01" }]; tables.board_sync = [{ board_id: "b1", revision: "3" }]; });
describe("변경 번호와 조건부 지도 조회", () => {
  it("카카오 장소 ID를 포함하고 이전 형식 ETag는 최신 목록으로 교체", async () => {
    tables.places = [{ id: "p1", board_id: "b1", kakao_place_id: "123", name: "식당", created_at: "2026-01-01" }];
    const response = await GET(req('"dm1:b1:1:3"')); expect(response.status).toBe(200);
    expect((await response.json()).places[0].kakao_place_id).toBe("123"); expect(response.headers.get("etag")).toBe('"dm2:b1:1:3"');
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
