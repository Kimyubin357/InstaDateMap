import { boardFromRequest, unauthorized, requireIdentity, accessError } from "@/lib/auth";
import { ingestShare } from "@/lib/pipeline";
import { withSavedPlace } from "@/lib/saved-place-server";

export const runtime = "nodejs";
export const maxDuration = 60;

type ImgType = "image/jpeg" | "image/png" | "image/webp";

/**
 * 단축어가 부르는 엔드포인트.
 * body: { url: string, who: string, caption?: string, images?: string[] (base64) }
 */
export async function POST(req: Request) {
  try {
    const board = await boardFromRequest(req);
    if (!board) return unauthorized();
    requireIdentity(board);

    let body: { url?: string; text?: string; caption?: string; images?: unknown; retry?: boolean; stream?: boolean };
    try {
      body = await req.json();
    } catch {
      return Response.json({ status: "error", message: "JSON 형식이 아닙니다." }, { status: 400 });
    }
    if (!body || typeof body !== "object") return Response.json({ status: "error", message: "입력 내용이 없습니다." }, { status: 400 });
    const text = String(body.url ?? body.text ?? "");
    if (!text) return Response.json({ status: "error", message: "링크가 비어 있습니다." }, { status: 400 });

    const images = (Array.isArray(body.images) ? body.images : [])
      .filter((x): x is string => typeof x === "string" && x.length > 0)
      .slice(0, 4)
      .map((data) => {
        const clean = data.replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
        const mediaType: ImgType = clean.startsWith("iVBOR") ? "image/png" : clean.startsWith("UklGR") ? "image/webp" : "image/jpeg";
        return { mediaType, data: clean };
      });

    const input = {
      boardId: board.id,
      text,
      who: board.who,
      caption: typeof body.caption === "string" ? body.caption : null,
      images,
      retry: body.retry === true,
    };
    if (body.stream === true) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({ async start(controller) {
        const send = (data: unknown) => { try { controller.enqueue(encoder.encode(JSON.stringify(data) + "\n")); } catch { /* client left; finish the idempotent save */ } };
        try { send({ type: "result", result: await withSavedPlace(board, await ingestShare({ ...input, onProgress: (stage) => send({ type: "progress", stage }) })) }); }
        catch (e) { send({ type: "result", result: { status: "error", message: e instanceof Error ? e.message : "저장하지 못했어요." } }); }
        finally { try { controller.close(); } catch {} }
      } });
      return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
    }
    const result = await withSavedPlace(board, await ingestShare(input));
    return Response.json(result, { status: result.status === "error" ? result.source_id ? 502 : 400 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return accessError(e);
  }
}
