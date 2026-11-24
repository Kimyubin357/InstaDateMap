import { accountFromRequest, unauthorized, accessError, AccessError, type Account } from "@/lib/auth";
import { db } from "@/lib/db";
import { tokenHash } from "@/lib/token";
import { isUuid } from "@/lib/folders";
import { listFolders } from "@/lib/folders-server";
import { parsePushSubscription, validPushEndpoint } from "@/lib/push-subscription";
import { pushConfiguration, schedulePlacePushes } from "@/lib/push-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const response = (data: unknown) => Response.json(data, { headers: { "Cache-Control": "no-store" } });
const unavailable = () => new AccessError("알림 기능을 준비 중이에요. 잠시 후 다시 확인해 주세요.", 503);

/** 이 기기(로그인 세션)가 알림을 켠 폴더들. 폴더별 알림은 017부터 기기 × 폴더 한 줄입니다. */
async function deviceFolders(account: Account) {
  const [folders, subs] = await Promise.all([
    listFolders(account.userId),
    db().from("push_subscriptions").select("board_id").eq("session_hash", account.sessionHash),
  ]);
  if (subs.error) throw unavailable();
  const on = new Set((subs.data ?? []).map((s) => s.board_id as string));
  return folders.map((f) => ({ id: f.id, name: f.name, on: on.has(f.id) }));
}

export async function GET(req: Request) {
  try {
    const account = await accountFromRequest(req); if (!account) return unauthorized();
    const config = pushConfiguration(); if (!config) return response({ configured: false, subscribed: false, folders: [] });
    const folders = await deviceFolders(account);
    if (account.boardId) schedulePlacePushes(account.boardId);
    return response({ configured: true, publicKey: config.publicKey, subscribed: folders.some((f) => f.on), folders });
  } catch (e) { return accessError(e); }
}

/**
 * 이 기기의 알림을 켜거나 폴더별로 고릅니다. body: { subscription, folders? }
 * folders를 주면 그 폴더들만 켜고 나머지는 끕니다. 주지 않으면 참여한 모든 폴더를 켭니다.
 */
export async function POST(req: Request) {
  try {
    const account = await accountFromRequest(req); if (!account) return unauthorized();
    if (!pushConfiguration()) throw unavailable();
    const body = await req.json().catch(() => null) as { subscription?: unknown; folders?: unknown } | null;
    // 예전 화면은 구독 객체만 보냈습니다.
    const sub = parsePushSubscription(body && "subscription" in body ? body.subscription : body);
    if (!sub) throw new AccessError("알림을 받을 기기를 확인하지 못했어요. 다시 켜 주세요.");
    const member = await listFolders(account.userId);
    let wanted = member.map((f) => f.id);
    if (body && "folders" in body) {
      if (!Array.isArray(body.folders) || body.folders.some((id) => !isUuid(id))) throw new AccessError("알림을 받을 폴더를 다시 골라 주세요.");
      wanted = wanted.filter((id) => (body.folders as string[]).includes(id));
    }
    const endpointHash = tokenHash(sub.endpoint);
    const now = new Date().toISOString();
    if (wanted.length) {
      const { error } = await db().from("push_subscriptions").upsert(wanted.map((id) => ({ endpoint_hash: endpointHash, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth,
        board_id: id, session_hash: account.sessionHash, created_at: now })), { onConflict: "endpoint_hash,board_id" });
      if (error) throw new AccessError("알림 설정을 저장하지 못했어요. 다시 시도해 주세요.", 503);
    }
    const off = member.map((f) => f.id).filter((id) => !wanted.includes(id));
    if (off.length) {
      const { error } = await db().from("push_subscriptions").delete().eq("endpoint_hash", endpointHash).eq("session_hash", account.sessionHash).in("board_id", off);
      if (error) throw new AccessError("알림 설정을 저장하지 못했어요. 다시 시도해 주세요.", 503);
    }
    return response({ subscribed: wanted.length > 0, folders: member.map((f) => ({ id: f.id, name: f.name, on: wanted.includes(f.id) })) });
  } catch (e) { return accessError(e); }
}

/** 이 기기의 알림을 모든 폴더에서 끕니다. */
export async function DELETE(req: Request) {
  try {
    const account = await accountFromRequest(req); if (!account) return unauthorized();
    const body = await req.json().catch(() => null);
    if (!validPushEndpoint(body?.endpoint)) throw new AccessError("이 기기의 알림 정보를 확인하지 못했어요.");
    const { error } = await db().from("push_subscriptions").delete().eq("endpoint_hash", tokenHash(body.endpoint)).eq("session_hash", account.sessionHash);
    if (error) throw new AccessError("알림을 끄지 못했어요. 다시 시도해 주세요.", 503);
    return response({ subscribed: false });
  } catch (e) { return accessError(e); }
}
