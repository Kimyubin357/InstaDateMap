import { withRequestDeadline } from "./client-request";
import type { SyncAccess } from "./sync-types";

/** A PIN rotation has already committed. Recovery only reads the current session. */
export function refreshAccess(signal?: AbortSignal): Promise<SyncAccess | null> {
  return withRequestDeadline(async (requestSignal) => {
    const response = await fetch("/api/access/context", { cache: "no-store", credentials: "same-origin", signal: requestSignal });
    if (response.status === 401 || response.status === 409) return null;
    if (!response.ok) throw new Error("입장 정보를 확인하지 못했어요. 다시 확인해 주세요.");
    return await response.json() as SyncAccess;
  }, { signal, timeoutMs: 15000 });
}
