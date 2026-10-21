import { boardFromRequest, unauthorized, accessError, requireIdentity } from "@/lib/auth";
import { syncAccess } from "@/lib/sync-server";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try { const board = await boardFromRequest(req); if (!board) return unauthorized(); requireIdentity(board); return Response.json(syncAccess(board), { headers: { "Cache-Control": "no-store" } }); }
  catch (e) { return accessError(e); }
}
