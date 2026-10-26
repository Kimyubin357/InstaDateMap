import { createHash } from "node:crypto";
import webpush from "web-push";
import { waitUntil } from "@vercel/functions";
import { db } from "./db";
import { validPushEndpoint } from "./push-subscription";

export function pushConfiguration() {
  const publicKey = process.env.VAPID_PUBLIC_KEY, privateKey = process.env.VAPID_PRIVATE_KEY, subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  try { webpush.setVapidDetails(subject, publicKey, privateKey); return { publicKey, privateKey, subject }; } catch { return null; }
}
interface Delivery { event_id: string; subscription_id: string; lease: string; endpoint: string; p256dh: string; auth: string; added_by: string; place_id: string; place_name: string; event_kind?: "place_added" | "memo_added" | "memo_updated" }
export function placeNotification(job: Pick<Delivery, "event_id" | "added_by" | "place_id" | "place_name" | "event_kind">) {
  const action = job.event_kind === "memo_added" ? "메모를 남겼어요" : job.event_kind === "memo_updated" ? "메모를 바꿨어요" : "새 장소를 담았어요";
  return { title: `${job.added_by}님이 ${action}`, body: job.place_name.slice(0, 160), tag: `place-${job.place_id}`,
    url: `/?place=${encodeURIComponent(job.place_id)}`, icon: "/icons/canvas-heart-192.png" };
}
async function sendDelivery(job: Delivery, config: NonNullable<ReturnType<typeof pushConfiguration>>) {
  let success = false, permanent = !validPushEndpoint(job.endpoint), expired = false;
  for (let attempt = 0; attempt < 2 && !permanent; attempt++) {
    try {
      await webpush.sendNotification({ endpoint: job.endpoint, keys: { p256dh: job.p256dh, auth: job.auth } }, JSON.stringify(placeNotification(job)),
        { vapidDetails: config, TTL: 86400, topic: createHash("sha256").update(job.event_id).digest("base64url").slice(0, 32), urgency: "high", timeout: 4000 });
      success = true; break;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      expired = status === 404 || status === 410;
      permanent = expired || (!!status && status >= 400 && status < 500 && status !== 429);
      if (!permanent && attempt === 0) await new Promise((r) => setTimeout(r, 250));
    }
  }
  if (expired) { await db().from("push_subscriptions").delete().eq("id", job.subscription_id); return; }
  const { error } = await db().from("push_deliveries").update({ state: success ? "sent" : permanent ? "failed" : "pending", available_at: new Date(Date.now() + 60_000).toISOString() })
    .eq("event_id", job.event_id).eq("subscription_id", job.subscription_id).eq("lease", job.lease);
  if (error || !success) console.warn("장소 알림 발송을 완료하지 못했어요.", { retryable: !permanent });
}
export async function deliverPlacePushes(boardId: string) {
  const config = pushConfiguration(); if (!config) return;
  const { data, error } = await db().rpc("dm_claim_push_deliveries", { p_board: boardId });
  if (error) throw new Error("알림 발송 기록을 확인하지 못했어요.");
  const jobs = (data || []) as Delivery[];
  for (let i = 0; i < jobs.length; i += 5) await Promise.all(jobs.slice(i, i + 5).map((job) => sendDelivery(job, config)));
}
/** Keep Vercel alive after the response; push failure never changes a committed save. */
export function schedulePlacePushes(boardId: string) {
  if (!pushConfiguration()) return;
  const task = Promise.resolve().then(() => deliverPlacePushes(boardId)).catch(() => console.warn("장소 알림 발송을 다시 확인해야 해요."));
  try { waitUntil(task); } catch { /* The handled task still runs on local runtimes. */ }
}
