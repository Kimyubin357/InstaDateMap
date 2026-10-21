import { boardFromRequest, unauthorized } from "@/lib/auth";
import { ingestShare } from "@/lib/pipeline";

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

    let body: { url?: string; text?: string; who?: string; caption?: string; images?: unknown; retry?: boolean };
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

    const token = req.headers.get("x-board-token") || new URL(req.url).searchParams.get("t") || "";
    const result = await ingestShare({
      boardId: board.id,
      token,
      text,
      who: (typeof body.who === "string" && body.who || "익명").slice(0, 20),
      caption: typeof body.caption === "string" ? body.caption : null,
      images,
      retry: body.retry === true,
    });
    return Response.json(result, { status: result.status === "error" ? result.source_id ? 502 : 400 : 200 });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({ status: "error", message: `처리 중 오류: ${message}` }, { status: 500 });
  }
}
