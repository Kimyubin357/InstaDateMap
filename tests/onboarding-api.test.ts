import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, reset, tables } from "./fakeDb";
// 처음 사용법(온보딩) 기록 API: 계정마다 한 번. 021이 없는 DB·오류는 "모름"으로 답해 화면이 이 기기 기록으로 판단합니다.
const rpc = vi.fn();
vi.mock("@/lib/db", () => ({ db: () => ({ from: fakeDb.from, rpc }) }));
import { tokenHash } from "@/lib/token";
import { GET, POST } from "@/app/api/onboarding/route";

const token = "d".repeat(64), ME = "aaaaaaaa-0000-4000-8000-000000000001";
const req = (method = "GET", headers: Record<string, string> = {}) => new Request("http://localhost/api/onboarding", { method,
  headers: { cookie: `datemap_session=${token}`, origin: "http://localhost", "Content-Type": "application/json", ...headers }, ...(method === "GET" ? {} : { body: "{}" }) });
const missing = { code: "PGRST202", message: "Could not find the function public.dm_onboarding_state(p_user) in the schema cache" };

beforeEach(() => {
  reset(); rpc.mockReset();
  tables.access_sessions = [{ token_hash: tokenHash(token), board_id: null, purpose: "member", remember: true, auth_version: 0, expires_at: "2030-01-01T00:00:00Z", user_id: ME }];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/onboarding", () => {
  it("로그인이 필요하다", async () => {
    expect((await GET(req("GET", { cookie: "" }))).status).toBe(401);
    expect((await POST(req("POST", { cookie: "" }))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("본 시각이 있으면 true, 없으면 false로 답하고 내 계정만 묻는다", async () => {
    rpc.mockResolvedValueOnce({ data: { onboarded_at: null }, error: null });
    expect(await (await GET(req())).json()).toEqual({ onboarded: false });
    expect(rpc).toHaveBeenCalledWith("dm_onboarding_state", { p_user: ME });
    rpc.mockResolvedValueOnce({ data: { onboarded_at: "2026-11-25T03:00:00+00:00" }, error: null });
    const res = await GET(req());
    expect(await res.json()).toEqual({ onboarded: true });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
  it("021 미적용(함수 없음)·오류·없는 계정은 null(모름)로 답하고 오류 원문을 보이지 않는다", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: missing });
    const res = await GET(req());
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ onboarded: null });
    expect(text).not.toContain("schema");
    rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await (await GET(req())).json()).toEqual({ onboarded: null });
  });
});

describe("POST /api/onboarding", () => {
  it("계정에 적고, 저장했으면 stored: true", async () => {
    rpc.mockResolvedValueOnce({ data: { onboarded_at: "2026-11-25T03:00:00+00:00" }, error: null });
    expect(await (await POST(req("POST"))).json()).toEqual({ ok: true, stored: true });
    expect(rpc).toHaveBeenCalledWith("dm_mark_onboarded", { p_user: ME });
  });
  it("021 미적용·오류에도 화면을 막지 않는다(stored: false → 이 기기 기록만)", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { ...missing, message: "Could not find the function public.dm_mark_onboarded" } });
    const res = await POST(req("POST"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, stored: false });
  });
  it("다른 사이트에서 보낸 요청은 막는다", async () => {
    expect((await POST(req("POST", { origin: "https://evil.example" }))).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
});
