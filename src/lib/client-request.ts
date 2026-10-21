/** HTTP 오류와 연결 실패를 성공으로 처리하지 않습니다. */
export class RequestError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error("서버에 연결하지 못했어요. 연결을 확인하고 다시 시도해 주세요.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.status === "error") throw new RequestError(body?.message || "요청을 처리하지 못했어요. 다시 시도해 주세요.", res.status);
  if (!body) throw new Error("서버 응답을 읽지 못했어요.");
  return body as T;
}
