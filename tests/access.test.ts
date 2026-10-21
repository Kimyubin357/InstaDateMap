import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, reset, tables } from "./fakeDb";
vi.mock("@/lib/db", () => ({ db: () => fakeDb }));
import { hashPin, pinFromDate, verifyPin, tokenHash } from "@/lib/pin";
import { boardFromRequest, safeNext } from "@/lib/auth";
import { POST as unlock } from "@/app/api/access/unlock/route";
import { POST as lock } from "@/app/api/access/lock/route";
import { POST as identity } from "@/app/api/access/identity/route";
import { POST as changePin } from "@/app/api/access/pin/route";
import { POST as setup } from "@/app/api/access/setup/route";
import { GET as bootstrap } from "@/app/api/access/bootstrap/route";
const token = "a".repeat(64);
let hash: string;
beforeAll(async () => { hash = await hashPin("200102"); });
beforeEach(() => {
  reset(); vi.unstubAllEnvs();
  tables.boards = [{ id: "b1", name: "우리", token: "old-token", pin_hash: hash, auth_version: 1, member_names: ["민지", "준호"] }];
  tables.access_sessions = [{ token_hash: tokenHash(token), board_id: "b1", purpose: "member", member_name: "민지", remember: true, auth_version: 1, expires_at: "2030-01-01T00:00:00Z" }];
});
function req(path: string, body?: unknown, cookie = `datemap_session=${token}`, origin = "http://localhost") {
  return new Request(`http://localhost/api/access/${path}`, { method: body === undefined ? "GET" : "POST", headers: { cookie, origin, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
describe("둘만의 PIN", () => {
  it("날짜 앞자리 0을 보존하고 잘못된 날짜·미래 날짜를 거절", () => {
    expect(pinFromDate("2000-01-02")).toBe("000102");
    expect(() => pinFromDate("2024-02-30")).toThrow();
    expect(() => pinFromDate("2099-01-01")).toThrow();
  });
  it("같은 PIN도 다른 salt로 저장하고 원문을 남기지 않음", async () => {
    const second = await hashPin("200102"); expect(second).not.toBe(hash); expect(second).not.toContain("200102");
    expect(await verifyPin("200102", second)).toBe(true); expect(await verifyPin("200103", second)).toBe(false);
    expect(await verifyPin("bad", second)).toBe(false); expect(await verifyPin("200102", "invalid")).toBe(false);
  });
  it("설정 이후 예전 토큰 주소와 헤더로 입장할 수 없음", async () => {
    expect(await boardFromRequest(new Request("http://localhost/?t=old-token", { headers: { "x-board-token": "old-token" } }))).toBeNull();
    const res = await bootstrap(req("bootstrap?t=old-token")); expect(res.headers.get("location")).toContain("/enter"); expect(res.headers.get("set-cookie")).toBeNull();
  });
  it("만료·다른 버전·설정 전용 세션을 거절", async () => {
    expect((await boardFromRequest(req("")))?.who).toBe("민지");
    tables.access_sessions[0].expires_at = "2000-01-01"; expect(await boardFromRequest(req(""))).toBeNull();
    tables.access_sessions[0].expires_at = "2030-01-01"; tables.access_sessions[0].auth_version = 0; expect(await boardFromRequest(req(""))).toBeNull();
    tables.access_sessions[0].auth_version = 1; tables.access_sessions[0].purpose = "setup"; expect(await boardFromRequest(req(""))).toBeNull();
  });
  it("외부 Origin과 Origin 없는 변경 요청을 거절", async () => {
    expect((await lock(req("lock", {}, undefined, "https://evil.test"))).status).toBe(403);
    expect((await lock(new Request("http://localhost/api/access/lock", { method: "POST" }))).status).toBe(403);
  });
  it("입장 후 공유 링크 경로를 보존하고 쿠키에는 원문 PIN이 없음", async () => {
    const next = "/add?url=https%3A%2F%2Fwww.instagram.com%2Freel%2FABC%2F";
    const res = await unlock(req("unlock", { pin: "200102", remember: true, next }, ""));
    expect(res.status).toBe(200); expect((await res.json()).next).toContain(encodeURIComponent(next));
    const cookie = res.headers.get("set-cookie")!; expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("Max-Age=7776000"); expect(cookie).toContain("SameSite=lax"); expect(cookie).not.toContain("200102");
  });
  it("기억하지 않으면 세션 쿠키와 12시간 만료", async () => {
    const start = Date.now(); const res = await unlock(req("unlock", { pin: "200102", remember: false }, ""));
    expect(res.status).toBe(200); expect(res.headers.get("set-cookie")).not.toContain("Max-Age");
    const last = tables.access_sessions.at(-1)!; expect(new Date(last.expires_at).getTime() - start).toBeGreaterThan(43100000); expect(new Date(last.expires_at).getTime() - start).toBeLessThan(43300000);
  });
  it("틀린 PIN은 세션을 발급하지 않음", async () => {
    const res = await unlock(req("unlock", { pin: "999999" }, "")); expect(res.status).toBe(401); expect(res.headers.get("set-cookie")).toBeNull(); expect(tables.access_sessions).toHaveLength(1);
  });
  it("DB 시도 제한을 적용하고 정상 세션은 유지", async () => {
    const spy = vi.spyOn(fakeDb, "rpc").mockResolvedValueOnce({ data: 899, error: null });
    const res = await unlock(req("unlock", { pin: "200102" }, "")); expect(res.status).toBe(429); expect(res.headers.get("retry-after")).toBe("899");
    expect(await boardFromRequest(req(""))).not.toBeNull(); spy.mockRestore();
  });
  it("기기 이름은 두 이름 중에서만 선택", async () => {
    expect((await identity(req("identity", { name: "외부인" }))).status).toBe(400);
    expect((await identity(req("identity", { name: "준호" }))).status).toBe(200); expect((await boardFromRequest(req("")))?.who).toBe("준호");
  });
  it("기기를 잠그면 서버 세션도 폐기", async () => {
    const res = await lock(req("lock", {})); expect(res.status).toBe(200); expect(tables.access_sessions).toHaveLength(0); expect(await boardFromRequest(req(""))).toBeNull();
  });
  it("PIN 변경 후 다른 세션과 이전 PIN이 무효", async () => {
    tables.access_sessions.push({ ...tables.access_sessions[0], token_hash: tokenHash("b".repeat(64)) });
    const res = await changePin(req("pin", { currentPin: "200102", newPin: "000102", confirmPin: "000102" }));
    expect(res.status).toBe(200); expect(tables.access_sessions).toHaveLength(1); expect(await boardFromRequest(req(""))).toBeNull(); expect(await verifyPin("000102", tables.boards[0].pin_hash)).toBe(true);
  });
  it("아무나 최초 PIN을 설정할 수 없고 설정 권한을 가진 기기만 가능", async () => {
    tables.boards[0].pin_hash = null;
    const body = { date: "2000-01-02", confirmPin: "000102", names: ["민지", "준호"] };
    expect((await setup(req("setup", body, ""))).status).toBe(401);
    tables.access_sessions[0].purpose = "setup";
    const res = await setup(req("setup", body, `datemap_setup=${token}`)); expect(res.status).toBe(200); expect(await verifyPin("000102", tables.boards[0].pin_hash)).toBe(true); expect(tables.boards[0].token).not.toBe("old-token");
  });
  it("외부 리다이렉트를 차단하고 URL에서 예전 인증 값을 제거", () => {
    expect(safeNext("https://evil.test")).toBe("/"); expect(safeNext("//evil.test")).toBe("/"); expect(safeNext("/\\evil.test")).toBe("/");
    expect(safeNext("/add?url=test&t=secret&who=name")).toBe("/add?url=test");
  });
  it("설정 API에서 잘못된 날짜를 거절", async () => {
    tables.boards[0].pin_hash = null; tables.access_sessions[0].purpose = "setup";
    const cookie = `datemap_setup=${token}`;
    const body = { date: "2024-02-30", confirmPin: "240230", names: ["민지", "준호"] };
    expect((await setup(req("setup", body, cookie))).status).toBe(400);
    expect(tables.boards[0].pin_hash).toBeNull();
  });
  it("익명·제3의 이름이 섞여 있어도 최초 설정을 완료하고 예전 기록은 보존", async () => {
    tables.boards[0].pin_hash = null; tables.access_sessions[0].purpose = "setup";
    tables.sources = [{ board_id: "b1", shared_by: "익명" }, { board_id: "b1", shared_by: "예전 이름" }];
    tables.place_saves = [{ board_id: "b1", added_by: "익명" }, { board_id: "b1", added_by: "제3의 이름" }];
    const before = structuredClone({ sources: tables.sources, saves: tables.place_saves });
    const res = await setup(req("setup", { date: "2000-01-02", confirmPin: "000102", names: ["민지", "준호"] }, `datemap_setup=${token}`));
    expect(res.status).toBe(200); expect(tables.boards[0].member_names).toEqual(["민지", "준호"]);
    expect(tables.sources).toEqual(before.sources); expect(tables.place_saves).toEqual(before.saves);
  });
});
