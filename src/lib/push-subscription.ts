export interface DeviceSubscription { endpoint: string; keys: { p256dh: string; auth: string } }
/** Restrict server-side requests to known push providers (no arbitrary URL fetches). */
export function validPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 4096) return false;
  try {
    const u = new URL(value), host = u.hostname;
    return u.protocol === "https:" && !u.username && !u.password && !u.hash && (!u.port || u.port === "443") &&
      (host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com" ||
       host === "web.push.apple.com" || host.endsWith(".push.apple.com") || host.endsWith(".notify.windows.com"));
  } catch { return false; }
}
function key(value: unknown, bytes: number) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  const decoded = Buffer.from(value, "base64url");
  return decoded.length === bytes && decoded.toString("base64url") === value;
}
export function parsePushSubscription(value: unknown): DeviceSubscription | null {
  const v = value as DeviceSubscription;
  if (!v || !validPushEndpoint(v.endpoint) || !key(v.keys?.p256dh, 65) || !key(v.keys?.auth, 16) || Buffer.from(v.keys.p256dh, "base64url")[0] !== 4) return null;
  return { endpoint: v.endpoint, keys: { p256dh: v.keys.p256dh, auth: v.keys.auth } };
}
