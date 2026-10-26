import { boardChanged } from "./board-events";
/** HTTP 오류와 연결 실패를 성공으로 처리하지 않습니다. */
export class RequestError extends Error { constructor(message: string, public status: number, public code?: string, public details?: Record<string, unknown>) { super(message); } }
export class RequestTimeoutError extends Error { constructor() { super("응답이 늦어지고 있어요. 연결을 확인하고 다시 시도해 주세요."); } }
export class ConnectionError extends Error { constructor(message = "서버에 연결하지 못했어요. 연결을 확인하고 다시 시도해 주세요.") { super(message); } }
export const uncertainResponse = (e: unknown) => e instanceof RequestTimeoutError || e instanceof ConnectionError;
/** Show our own Korean messages; browser/API errors (English DOMException, TypeError…) become a friendly fallback. */
export function friendlyMessage(e: unknown, fallback: string) {
  if (e instanceof DOMException && e.name === "TimeoutError") return new RequestTimeoutError().message;
  if (e instanceof Error && !(e instanceof DOMException) && /[가-힣]/.test(e.message)) return e.message;
  if (typeof console !== "undefined") console.warn(fallback, e);
  return fallback;
}

/** The deadline covers headers AND body consumption; even a stalled fetch implementation settles. */
export async function withRequestDeadline<T>(task: (signal: AbortSignal) => Promise<T>, options: { signal?: AbortSignal | null; timeoutMs?: number } = {}): Promise<T> {
  const controller = new AbortController();
  let reject!: (error: unknown) => void;
  const cancelled = new Promise<never>((_, fail) => { reject = fail; });
  const abort = () => { const reason = options.signal?.reason || new DOMException("취소된 요청", "AbortError"); reject(reason); controller.abort(reason); };
  const timer = setTimeout(() => { const error = new RequestTimeoutError(); reject(error); controller.abort(error); }, options.timeoutMs ?? 15000);
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    if (options.signal?.aborted) { abort(); return await cancelled; }
    return await Promise.race([cancelled, Promise.resolve().then(() => task(controller.signal))]);
  } finally { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); }
}

export async function requestJson<T>(url: string, init: RequestInit & { timeoutMs?: number; notifyBoardChange?: boolean } = {}): Promise<T> {
  const { timeoutMs = /^\/api\/(share|sources)(\/|$)/.test(url) && init.method === "POST" ? 65000 : 15000, notifyBoardChange = true, signal, ...request } = init;
  const body = await withRequestDeadline(async (signal) => {
  let res: Response;
  try { res = await fetch(url, { ...request, signal }); }
  catch (e) { if (signal.aborted) throw signal.reason; throw new ConnectionError(); }
  let body: any;
  try { body = await res.json(); } catch (e) { if (signal.aborted) throw signal.reason; throw new ConnectionError("서버 응답을 읽지 못했어요."); }
  if (!res.ok || body?.status === "error") throw new RequestError(body?.message || "요청을 처리하지 못했어요. 다시 시도해 주세요.", res.status, body?.code, body);
  if (!body) throw new ConnectionError("서버 응답을 읽지 못했어요.");
  return body as T;
  }, { signal, timeoutMs });
  if (notifyBoardChange && init?.method && !["GET", "HEAD"].includes(init.method.toUpperCase()) && /^\/api\/(places|sources|share|trash|collections)(\/|$)/.test(url)) boardChanged();
  return body;
}
