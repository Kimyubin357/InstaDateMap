import { expect, it } from "vitest";
import { readSyncEvents } from "@/lib/sync-connection";
it("분할된 실시간 프레임에서 준비·변경·만료 이벤트를 순서대로 읽음", async () => {
  const bytes = new TextEncoder().encode('event: ready\ndata: {"revision":"2"}\n\nevent: heartbeat\ndata: {}\n\nevent: change\ndata: {"revision":"3"}\n\nevent: expired\ndata: {}\n\n');
  const events: unknown[] = [];
  await readSyncEvents(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7)); c.close(); } }), (event, data) => events.push([event, data]));
  expect(events).toEqual([["ready", { revision: "2" }], ["heartbeat", {}], ["change", { revision: "3" }], ["expired", {}]]);
});
