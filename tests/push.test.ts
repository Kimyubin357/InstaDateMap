import { beforeEach, describe, expect, it, vi } from "vitest";
import webpush from "web-push";
import { fakeDb, reset, tables } from "./fakeDb";
import { tokenHash } from "@/lib/pin";
vi.mock("@/lib/db", () => ({ db: () => fakeDb }));
vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));
import { GET, POST, DELETE } from "@/app/api/push/route";
import { parsePushSubscription, validPushEndpoint } from "@/lib/push-subscription";
import { placeNotification, pushConfiguration, schedulePlacePushes, deliverPlacePushes } from "@/lib/push-server";
import { savePlace } from "@/lib/pipeline";
const keys = webpush.generateVAPIDKeys();
const endpoint = "https://web.push.apple.com/test-device";
const sub = { endpoint, keys: { p256dh: keys.publicKey, auth: Buffer.alloc(16, 1).toString("base64url") } };
const request = (method = "GET", body?: unknown, origin = "http://localhost") => new Request("http://localhost/api/push", { method, headers: { cookie: `datemap_session=${"a".repeat(64)}`, origin, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
beforeEach(() => {
  reset(); vi.restoreAllMocks();
  Object.assign(process.env, { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: "mailto:test@example.com" });
  tables.boards = [{ id: "b1", name: "검증", member_names: ["유빈", "수민"], auth_version: 1 }];
  tables.access_sessions = [{ token_hash: tokenHash("a".repeat(64)), board_id: "b1", purpose: "member", member_name: "유빈", auth_version: 1, expires_at: "2030-01-01T00:00:00Z" }];
});
describe("알림 구독 보안과 설정", () => {
  it("브라우저에는 공개키만 반환하고 설정 전에는 준비 상태를 알려줌", async () => {
    const res = await GET(request());
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ configured: true, publicKey: keys.publicKey, subscribed: false });
    delete process.env.VAPID_PRIVATE_KEY;
    expect(await (await GET(request())).json()).toEqual({ configured: false, subscribed: false });
    expect(pushConfiguration()).toBeNull();
  });
  it("구독은 쿠키의 보드와 세션에 묶고 클라이언트의 이름은 무시함", async () => {
    expect((await POST(request("POST", { ...sub, who: "수민", board_id: "other" }))).status).toBe(200);
    expect(tables.push_subscriptions[0]).toMatchObject({ board_id: "b1", session_hash: tokenHash("a".repeat(64)), endpoint_hash: tokenHash(endpoint) });
    expect(await (await GET(request())).json()).toMatchObject({ subscribed: true });
    expect((await POST(request("POST", sub))).status).toBe(200);
    expect(tables.push_subscriptions).toHaveLength(1);
  });
  it("외부 Origin·미인증·만료된 세션을 거절함", async () => {
    expect((await POST(request("POST", sub, "https://evil.example"))).status).toBe(403);
    tables.access_sessions[0].expires_at = "2020-01-01";
    expect((await POST(request("POST", sub))).status).toBe(401);
    expect((await GET(new Request("http://localhost/api/push"))).status).toBe(401);
  });
  it("이 기기의 구독만 삭제하고 다른 세션 구독은 지우지 않음", async () => {
    await POST(request("POST", sub));
    tables.push_subscriptions.push({ id: "other", endpoint_hash: tokenHash(endpoint), board_id: "b1", session_hash: "other-session" });
    expect((await DELETE(request("DELETE", { endpoint }))).status).toBe(200);
    expect(tables.push_subscriptions).toHaveLength(1); expect(tables.push_subscriptions[0].id).toBe("other");
  });
  it("임의 서버·로컬 주소·가짜 제공자와 잘못된 키를 거절함", async () => {
    for (const url of ["http://web.push.apple.com/x", "https://127.0.0.1/x", "https://web.push.apple.com.evil.example/x", "https://fcm.googleapis.com:444/x", "https://user@fcm.googleapis.com/x", "https://example.com/x"]) {
      expect(validPushEndpoint(url)).toBe(false);
      expect((await POST(request("POST", { ...sub, endpoint: url }))).status).toBe(400);
    }
    expect(parsePushSubscription({ ...sub, keys: { ...sub.keys, auth: "bad" } })).toBeNull();
    expect(parsePushSubscription(null)).toBeNull();
    expect(validPushEndpoint("https://fcm.googleapis.com/fcm/send/x")).toBe(true);
    expect(validPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
  });
});
describe("장소 알림 발송", () => {
  const job = { event_id: "event1", subscription_id: "sub1", lease: "lease1", endpoint, p256dh: keys.publicKey, auth: sub.keys.auth, added_by: "수민", place_id: "place1", place_name: "새 카페" };
  function jobs() { const rpc = vi.spyOn(fakeDb, "rpc"); rpc.mockResolvedValue({ data: [job], error: null }); tables.push_deliveries = [{ event_id: "event1", subscription_id: "sub1", lease: "lease1", state: "sending" }]; return rpc; }
  it("알림에는 저장자·장소명과 해당 장소 주소만 담음", () => {
    expect(placeNotification(job)).toMatchObject({ title: "수민님이 새 장소를 담았어요", body: "새 카페", url: "/?place=place1", tag: "place-event1" });
    expect(JSON.stringify(placeNotification(job))).not.toContain("session");
  });
  it.each([['memo_added', '메모를 남겼어요'], ['memo_updated', '메모를 바꿨어요']] as const)("메모 알림 %s은 본문 없이 장소명과 상세 링크만 포함", (event_kind, action) => {
    expect(placeNotification({ ...job, event_kind })).toMatchObject({ title: `수민님이 ${action}`, body: "새 카페", url: "/?place=place1" });
  });
  it("실제 Web Push 라이브러리가 VAPID 서명과 암호화된 payload를 생성함", () => {
    const details = webpush.generateRequestDetails({ endpoint, keys: sub.keys }, JSON.stringify(placeNotification(job)), {
      vapidDetails: { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: "mailto:test@example.com" }, TTL: 86400,
    });
    expect(details.headers["Content-Encoding"]).toBe("aes128gcm");
    expect(details.headers.Authorization).toContain("vapid");
    expect(Buffer.from(details.body!).includes(Buffer.from("새 카페"))).toBe(false);
    expect(details.headers.Authorization).not.toContain(keys.privateKey);
  });
  it("Web Push 성공 후 같은 발송 기록을 완료 처리함", async () => {
    jobs(); const send = vi.spyOn(webpush, "sendNotification").mockResolvedValue({ statusCode: 201, body: "", headers: {} });
    await deliverPlacePushes("b1");
    expect(send).toHaveBeenCalledTimes(1); expect(tables.push_deliveries[0].state).toBe("sent");
    expect(send.mock.calls[0][2]).toMatchObject({ TTL: 86400, urgency: "high", timeout: 4000 });
  });
  it("만료된 기기 구독은 제거함", async () => {
    jobs(); tables.push_subscriptions = [{ id: "sub1" }];
    vi.spyOn(webpush, "sendNotification").mockRejectedValue({ statusCode: 410 });
    await deliverPlacePushes("b1"); expect(tables.push_subscriptions).toHaveLength(0);
  });
  it("일시 장애는 재시도하고 성공한 결과를 기록함", async () => {
    jobs(); const send = vi.spyOn(webpush, "sendNotification").mockRejectedValueOnce({ statusCode: 503 }).mockResolvedValue({ statusCode: 201, body: "", headers: {} });
    await deliverPlacePushes("b1"); expect(send).toHaveBeenCalledTimes(2); expect(tables.push_deliveries[0].state).toBe("sent");
  });
  it("이전 발송의 완료 응답이 새 lease 상태를 덮지 않음", async () => {
    jobs(); tables.push_deliveries[0].lease = "newer";
    vi.spyOn(webpush, "sendNotification").mockResolvedValue({ statusCode: 201, body: "", headers: {} });
    await deliverPlacePushes("b1"); expect(tables.push_deliveries[0].state).toBe("sending");
  });
  it("알림 DB가 실패해도 이미 커밋된 장소 저장은 성공함", async () => {
    const original = fakeDb.rpc; const rpc = vi.spyOn(fakeDb, "rpc");
    rpc.mockImplementation((name, params) => name === "dm_claim_push_deliveries" ? Promise.resolve({ data: null, error: { message: "down" } }) : original(name, params));
    const place = { kakao_place_id: "p1", name: "카페", address: "서울", lat: 37, lng: 127, category: "카페", kakao_url: "" };
    expect(await savePlace({ boardId: "b1", addedBy: "유빈", place, sourceId: null, extractionId: null })).toBeTruthy();
    expect(tables.places).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 0));
  });
});
