"use client";
import { useEffect, useRef, useState } from "react";
import { friendlyMessage, requestJson } from "@/lib/client-request";
import { useBoardState, useBoardSync } from "./BoardProvider";
import ActionDialog from "./ActionDialog";
import ClientReady from "./ClientReady";
import PageHeader from "./PageHeader";
import type { SavedPlace } from "@/lib/saved-place";
import type { TrashLogItem } from "@/app/api/trash/route";

interface RestoreResult { ok: boolean; board_id: string; board_name: string; merged: boolean; place_url: string; saved_place?: SavedPlace }

/**
 * 삭제한 장소(나만 보는 기록, 017): 모든 폴더에서 내가 지운 장소. 복구하면 지웠던 폴더로 돌아가고,
 * 그 폴더에 같은 가게가 다시 등록돼 있으면 그 장소를 두고 메모만 합칩니다.
 */
export default function TrashPlaces() {
  const { store, notify } = useBoardSync();
  const state = useBoardState();
  const [refresh, setRefresh] = useState(0);
  const [places, setPlaces] = useState<TrashLogItem[]>([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [readError, setReadError] = useState(""), [actionError, setActionError] = useState("");
  const error = actionError || readError;
  const [purging, setPurging] = useState<TrashLogItem | null>(null);
  const writing = useRef(false);
  const readVersion = useRef(0);
  useEffect(() => {
    let active = true;
    const version = ++readVersion.current;
    setLoading(true);
    void requestJson<{ places: TrashLogItem[] }>("/api/trash", { cache: "no-store" }).then((data) => {
      if (active && version === readVersion.current) { setPlaces(data.places); setReadError(""); }
    }).catch((e) => { if (active && version === readVersion.current) setReadError(friendlyMessage(e, "목록을 불러오지 못했어요.")); })
      .finally(() => { if (active && version === readVersion.current) setLoading(false); });
    return () => { active = false; };
  }, [refresh, state.snapshot?.revision]);
  async function change(place: TrashLogItem, purge = false) {
    if (writing.current) return;
    writing.current = true; ++readVersion.current; setBusy(true); setActionError("");
    try {
      if (purge) {
        await requestJson(`/api/trash/${place.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: "{}" });
        notify("기록에서 지웠어요.");
      } else {
        const result = await requestJson<RestoreResult>(`/api/trash/${place.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        if (!result.ok) throw new Error("처리 결과를 확인하지 못했어요. 목록을 다시 확인해 주세요.");
        const message = result.merged ? `‘${result.board_name}’에 같은 가게가 있어 메모만 합쳤어요.` : `‘${result.board_name}’ 방으로 되돌렸어요.`;
        if (place.current) {
          if (!store.acceptSavedPlace(result.saved_place)) void store.refresh();
          notify(message, "success", { label: "장소 보기", href: result.place_url });
        } else notify(message);
      }
      setPlaces((rows) => rows.filter((row) => row.id !== place.id));
      setPurging(null);
    } catch (e) { setActionError(friendlyMessage(e, "처리 결과를 확인하지 못했어요. 목록을 다시 확인해 주세요.")); }
    finally { ++readVersion.current; writing.current = false; setBusy(false); setRefresh((n) => n + 1); }
  }
  return <main className="form-page"><PageHeader title="삭제한 장소" backHref="/settings" /><ClientReady>
    <div id="deleted-places" className="stack" aria-busy={loading || busy}>
      <p className="hint">내가 지운 장소만 보여요. 되돌리면 지웠던 방으로 메모·상태·원본 링크와 함께 돌아가요.</p>
      {loading && <p role="status" className="hint">삭제한 장소를 확인하고 있어요…</p>}
      {!loading && !places.length && !error && <p className="hint">삭제한 장소가 없어요.</p>}
      {places.map((place) => <article key={place.id} className="trash-place">
        <h3>{place.name}</h3>{place.address && <p className="hint">{place.address}</p>}
        <p className="hint">{place.board_name} · {new Date(place.deleted_at).toLocaleDateString("ko-KR")} 삭제</p>
        {place.memo && <p className="trash-memo">{place.memo}</p>}
        {!place.restorable && <p className="hint">방이 없어졌거나 나간 방이라 되돌릴 수 없어요.</p>}
        <div className="trash-actions">
          <button className="btn primary" disabled={busy || !place.restorable} onClick={() => void change(place)}>되돌리기</button>
          <button className="btn" disabled={busy} onClick={() => { setActionError(""); setPurging(place); }}>기록에서 지우기</button>
        </div>
      </article>)}
      {error && !purging && <p className="error" role="alert">{error}</p>}
    </div>
    {purging && <ActionDialog title="이 기록을 지울까요?" destructive message={`${purging.name}의 삭제 기록을 지우면 다시 되돌릴 수 없어요.`} cancelLabel="취소" confirmLabel="기록에서 지우기" busy={busy} onClose={() => setPurging(null)} onConfirm={() => change(purging, true)}>{actionError && <p className="error" role="alert">{actionError}</p>}</ActionDialog>}
  </ClientReady></main>;
}
