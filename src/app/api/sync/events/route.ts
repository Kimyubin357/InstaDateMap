import { createClient } from "@supabase/supabase-js";
import { boardFromRequest, unauthorized, accessError, requireIdentity } from "@/lib/auth";
import { boardRevision } from "@/lib/sync-server";
import { env } from "@/lib/env";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(req: Request) {
  try {
    const board = await boardFromRequest(req); if (!board) return unauthorized(); requireIdentity(board);
    const client = createClient(env.supabaseUrl(), env.supabaseServiceKey(), { auth: { persistSession: false, autoRefreshToken: false } });
    const channel = client.channel(`datemap:${board.id}`, { config: { private: true } });
    let warmup: ReturnType<typeof client.channel> | undefined;
    let closed = false, subscribed = false, checking = false;
    let controller: ReadableStreamDefaultController<Uint8Array>;
    let heartbeat: ReturnType<typeof setInterval> | undefined, lifetime: ReturnType<typeof setTimeout> | undefined;
    const encoder = new TextEncoder();
    const close = () => {
      if (closed) return; closed = true;
      clearInterval(heartbeat); clearTimeout(lifetime); req.signal.removeEventListener("abort", close);
      try { controller.close(); } catch {}
      void Promise.all([client.removeChannel(channel), ...(warmup ? [client.removeChannel(warmup)] : [])]).catch(() => {}).finally(() => client.realtime.disconnect());
    };
    const send = (event: string, data: unknown) => { if (!closed) { try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { close(); } } };
    const authorize = async () => {
      const current = await boardFromRequest(req);
      if (!current || current.id !== board.id || current.authVersion !== board.authVersion) { send("expired", {}); close(); return false; }
      return true;
    };
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
        req.signal.addEventListener("abort", close, { once: true });
        if (req.signal.aborted) { close(); return; }
        send("connecting", {});
        channel.on("broadcast", { event: "changed" }, async ({ payload }) => {
          if (typeof payload?.revision !== "string" || !/^\d+$/.test(payload.revision)) return;
          try { if (await authorize()) send("change", { revision: payload.revision }); } catch { send("unavailable", {}); close(); }
        }).subscribe(async (status, error) => {
          if (closed) return;
          if (status === "SUBSCRIBED") {
            try { if (await authorize()) { subscribed = true; send("ready", { revision: await boardRevision(board.id) }); } }
            catch { send("unavailable", {}); close(); }
          } else if (status === "CHANNEL_ERROR" && error?.message?.includes("MissingPartition") && !warmup) {
            // Supabase creates daily broadcast partitions on a public join. This topic
            // carries no data; the board subscription remains private on the next retry.
            warmup = client.channel("datemap-initialize", { config: { private: false } });
            warmup.subscribe((state) => { if (!closed && ["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(state)) { send("unavailable", {}); close(); } });
          } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) { send("unavailable", {}); close(); }
        });
        let beats = 0;
        heartbeat = setInterval(async () => {
          if (closed || checking) return;
          checking = true;
          try {
            if ((++beats % 2 === 0 || !subscribed) && !await authorize()) return;
            send("heartbeat", {});
          } catch { send("unavailable", {}); close(); }
          finally { checking = false; }
        }, 15000);
        lifetime = setTimeout(close, 55000);
      },
      cancel: close,
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
  } catch (e) { return accessError(e); }
}
