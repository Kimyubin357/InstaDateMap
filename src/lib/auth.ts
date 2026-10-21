import { db } from "./db";

export interface Board {
  id: string;
  name: string;
}

/** 요청 헤더(x-board-token) 또는 쿼리(?t=)의 토큰으로 보드를 찾습니다. */
export async function boardFromRequest(req: Request): Promise<Board | null> {
  const url = new URL(req.url);
  const token = req.headers.get("x-board-token") || url.searchParams.get("t");
  if (!token) return null;
  const { data } = await db().from("boards").select("id, name").eq("token", token).maybeSingle();
  return data ?? null;
}

export function unauthorized() {
  return Response.json({ status: "error", message: "보드 토큰이 없거나 맞지 않습니다." }, { status: 401 });
}
