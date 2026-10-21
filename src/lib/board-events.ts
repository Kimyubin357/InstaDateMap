export function boardChanged() { if (typeof window !== "undefined") window.dispatchEvent(new Event("datemap:changed")); }
export type AccessMessage = "locked" | "changed";
export const accessSender = typeof window === "undefined" ? "server" : `${Date.now()}:${Math.random()}`;
export function announceAccess(type: AccessMessage) {
  if (typeof window === "undefined") return;
  const event = { type, nonce: Date.now() + Math.random(), sender: accessSender };
  try { const channel = new BroadcastChannel("datemap-access"); channel.postMessage(event); channel.close(); } catch {}
  try { localStorage.setItem("datemap-access-event", JSON.stringify(event)); } catch {}
}
