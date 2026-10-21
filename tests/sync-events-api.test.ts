import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, reset, tables } from "./fakeDb";
import { tokenHash } from "@/lib/pin";
const transport = vi.hoisted(() => {
  const channel = { on: vi.fn(), subscribe: vi.fn() };
  const client = { channel: vi.fn(() => channel), removeChannel: vi.fn(async () => {}), realtime: { disconnect: vi.fn() } };
  return { channel, client, create: vi.fn(() => client) };
});
vi.mock("@/lib/db", () => ({ db: () => fakeDb }));
vi.mock("@supabase/supabase-js", () => ({ createClient: transport.create }));
import { GET } from "@/app/api/sync/events/route";
const req = (token = "a".repeat(64)) => new Request("http://localhost/api/sync/events?board=other-board", { headers: { cookie: `datemap_session=${token}` } });
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); reset(); vi.stubEnv("SUPABASE_URL", "https://test.supabase.co"); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "server-only");
  tables.boards = [{ id: "b1", name: "지도", member_names: ["우리", "서로"], auth_version: 1 }];
  tables.access_sessions = [{ token_hash: tokenHash("a".repeat(64)), board_id: "b1", purpose: "member", member_name: "우리", auth_version: 1, expires_at: "2030-01-01" }];
  transport.channel.on.mockReturnValue(transport.channel); transport.channel.subscribe.mockReturnValue(transport.channel);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
describe("PIN 쿠키로 보호되는 변경 알림", () => {
  it("폐기된 세션은 구독 생성 전에 거절", async () => {
    expect((await GET(req("invalid"))).status).toBe(401); expect(transport.create).not.toHaveBeenCalled();
  });
  it("클라이언트의 보드 값을 무시하고 인증된 보드의 비공개 채널만 연결", async () => {
    const res = await GET(req()); expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(transport.client.channel).toHaveBeenCalledWith("datemap:b1", { config: { private: true } });
    const reader = res.body!.getReader(); await reader.cancel(); await Promise.resolve();
    expect(transport.client.removeChannel).toHaveBeenCalledOnce(); expect(transport.client.realtime.disconnect).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it("PIN 변경으로 권한을 잃으면 변경 데이터 대신 만료 이벤트 후 연결 종료", async () => {
    const res = await GET(req()); tables.boards[0].auth_version = 2;
    const broadcast = transport.channel.on.mock.calls[0][2]; await broadcast({ payload: { revision: "9", memo: "노출하면 안 되는 값" } });
    const text = await res.text(); expect(text).toContain("event: expired"); expect(text).not.toContain("event: change"); expect(text).not.toContain("노출하면 안 되는 값");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("55초에 정상 종료하고 구독과 하트비트 타이머 정리", async () => {
    const res = await GET(req()); await vi.advanceTimersByTimeAsync(55000);
    expect(await res.text()).toContain("event: connecting"); expect(transport.client.removeChannel).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it("비활성 프로젝트의 일별 파티션 누락은 데이터 없는 초기 연결 후 재시도로 복구", async () => {
    const res = await GET(req()); const subscribe = transport.channel.subscribe.mock.calls[0][0];
    await subscribe("CHANNEL_ERROR", new Error("MissingPartition"));
    expect(transport.client.channel).toHaveBeenLastCalledWith("datemap-initialize", { config: { private: false } });
    const initialized = transport.channel.subscribe.mock.calls[1][0]; initialized("SUBSCRIBED");
    expect(await res.text()).toContain("event: unavailable"); expect(vi.getTimerCount()).toBe(0);
  });
});
