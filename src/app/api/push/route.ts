import { boardFromRequest, requireIdentity, unauthorized, accessError, AccessError } from "@/lib/auth";
import { db } from "@/lib/db";
import { tokenHash } from "@/lib/pin";
import { parsePushSubscription, validPushEndpoint } from "@/lib/push-subscription";
import { pushConfiguration, schedulePlacePushes } from "@/lib/push-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const response = (data: unknown) => Response.json(data, { headers: { "Cache-Control": "no-store" } });
export async function GET(req: Request) {
  try {
    const board = await boardFromRequest(req); if (!board) return unauthorized(); requireIdentity(board);
    const config = pushConfiguration(); if (!config) return response({ configured: false, subscribed: false });
    const { data, error } = await db().from("push_subscriptions").select("id").eq("board_id", board.id).eq("session_hash", board.sessionHash).limit(1);
    if (error) throw new AccessError("알림 기능을 준비 중이에요. 잠시 후 다시 확인해 주세요.", 503);
    schedulePlacePushes(board.id);
    return response({ configured: true, publicKey: config.publicKey, subscribed: !!data?.length });
  } catch (e) { return accessError(e); }
}
export async function POST(req: Request) {
  try {
    const board = await boardFromRequest(req); if (!board) return unauthorized(); requireIdentity(board);
    if (!pushConfiguration()) throw new AccessError("알림 기능을 준비 중이에요. 잠시 후 다시 확인해 주세요.", 503);
    const sub = parsePushSubscription(await req.json().catch(() => null));
    if (!sub) throw new AccessError("알림을 받을 기기를 확인하지 못했어요. 다시 켜 주세요.");
    const { error } = await db().from("push_subscriptions").upsert({ endpoint_hash: tokenHash(sub.endpoint), endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth,
      board_id: board.id, session_hash: board.sessionHash, created_at: new Date().toISOString() }, { onConflict: "endpoint_hash" });
    if (error) throw new AccessError("알림 설정을 저장하지 못했어요. 다시 시도해 주세요.", 503);
    return response({ subscribed: true });
  } catch (e) { return accessError(e); }
}
export async function DELETE(req: Request) {
  try {
    const board = await boardFromRequest(req); if (!board) return unauthorized(); requireIdentity(board);
    const body = await req.json().catch(() => null);
    if (!validPushEndpoint(body?.endpoint)) throw new AccessError("이 기기의 알림 정보를 확인하지 못했어요.");
    const { error } = await db().from("push_subscriptions").delete().eq("endpoint_hash", tokenHash(body.endpoint)).eq("session_hash", board.sessionHash).eq("board_id", board.id);
    if (error) throw new AccessError("알림을 끄지 못했어요. 다시 시도해 주세요.", 503);
    return response({ subscribed: false });
  } catch (e) { return accessError(e); }
}
