import { expect, it } from "vitest";
import { readShareResponse } from "@/lib/share-stream";
it("여러 조각으로 나뉜 한국어 진행·결과 스트림을 해석", async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ type: "progress", stage: "extract" }) + "\n" + JSON.stringify({ type: "result", result: { status: "saved", message: "도나스데이 저장", place_url: "/?place=id" } }) + "\n");
  const body = new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7)); c.close(); } });
  const stages: string[] = []; const result = await readShareResponse(new Response(body, { headers: { "Content-Type": "application/x-ndjson" } }), (s) => stages.push(s));
  expect(stages).toEqual(["extract"]); expect(result.message).toBe("도나스데이 저장");
});
it("완료 결과 없이 연결이 끝나면 성공으로 표시하지 않음", async () => {
  await expect(readShareResponse(new Response('{"type":"progress","stage":"search"}\n', { headers: { "Content-Type": "application/x-ndjson" } }), () => {})).rejects.toThrow("연결이 끊겼어요");
});
