import type { CollectionResult } from "./collections";
import { ConnectionError, RequestError, requestJson } from "./client-request";
import { VerifiedWrite } from "./verified-write";

/** The undo keeps its own receipt when the originating picker closes or another form opens. */
export function collectionUndo(target: string, refresh: () => Promise<unknown>, onUnauthorized: () => Promise<void>) {
  const operationId = crypto.randomUUID();
  const write = new VerifiedWrite<CollectionResult>();
  return async (): Promise<string | void> => {
    try {
      await write.run(async () => {
        try {
          return await requestJson<CollectionResult>("/api/collections", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ operation_id: operationId, command: { action: "undo", target } }),
          });
        } catch (error) {
          if (error instanceof RequestError && error.code === "COLLECTION_UNCONFIRMED") throw new ConnectionError();
          throw error;
        }
      }, async () => (await requestJson<{ result: CollectionResult | null }>(`/api/collections?operation=${operationId}`)).result, () => {});
      await refresh();
      return "변경을 되돌렸어요.";
    } catch (error) {
      if (error instanceof RequestError && error.status === 401) { await onUnauthorized(); return; }
      throw error;
    }
  };
}
