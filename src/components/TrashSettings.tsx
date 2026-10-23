"use client";
import { useEffect, useRef, useState } from "react";
import { requestJson } from "@/lib/client-request";
import { useBoardState, useBoardSync } from "./BoardProvider";
import ActionDialog from "./ActionDialog";
import Icon from "./Icon";

interface TrashedPlace { id: string; name: string; address: string; memo: string | null; deleted_at: string; deleted_by: string | null }
export default function TrashSettings() {
  const { store, notify } = useBoardSync();
  const state = useBoardState();
  const [open, setOpen] = useState(false), [refresh, setRefresh] = useState(0);
  const [places, setPlaces] = useState<TrashedPlace[]>([]);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [purging, setPurging] = useState<TrashedPlace | null>(null);
  const writing = useRef(false);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    void requestJson<{ places: TrashedPlace[] }>("/api/trash", { cache: "no-store" }).then((data) => {
      if (active) setPlaces(data.places);
    }).catch((e) => { if (active) setError(e instanceof Error ? e.message : "목록을 불러오지 못했어요."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, refresh, state.snapshot?.revision]);
  async function change(place: TrashedPlace, purge = false) {
    if (writing.current) return;
    writing.current = true; setBusy(true); setError("");
    try {
      const result = await requestJson<{ ok: boolean }>(`/api/trash/${place.id}`, { method: purge ? "DELETE" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deleted_at: place.deleted_at }) });
      if (!result.ok) throw new Error("처리 결과를 확인하지 못했어요. 목록을 다시 확인해 주세요.");
      setPlaces((rows) => rows.filter((row) => row.id !== place.id));
      setPurging(null);
      notify(purge ? "장소를 영구 삭제했어요." : "장소를 지도에 복구했어요.");
      void store.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "처리 결과를 확인하지 못했어요. 목록을 다시 확인해 주세요."); }
    finally { writing.current = false; setBusy(false); setRefresh((n) => n + 1); }
  }
  return <section className="settings-section">
    <button className="settings-row" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="deleted-places"><Icon name="trash" /><span>삭제한 장소</span><Icon name="chevron" /></button>
    {open && <div id="deleted-places" className="stack" aria-busy={loading || busy}>
      <p className="hint">메모·상태·원본 링크까지 함께 복구해요. 자동으로 지워지지 않으며, 영구 삭제하면 되돌릴 수 없어요.</p>
      <button className="btn" disabled={loading || busy} onClick={() => { setError(""); setRefresh((n) => n + 1); }}>목록 새로고침</button>
      {loading && <p role="status" className="hint">삭제한 장소를 확인하고 있어요…</p>}
      {!loading && !places.length && !error && <p className="hint">삭제한 장소가 없어요.</p>}
      {places.map((place) => <article key={place.id} className="trash-place">
        <h3>{place.name}</h3><p className="hint">{place.address}</p>
        <p className="hint">{place.deleted_by ? `${place.deleted_by} · ` : ""}{new Date(place.deleted_at).toLocaleDateString("ko-KR")} 삭제</p>
        {place.memo && <p className="trash-memo">{place.memo}</p>}
        <div className="trash-actions"><button className="btn primary" disabled={busy || loading} onClick={() => void change(place)}>복구하기</button><button className="btn" disabled={busy || loading} onClick={() => { setError(""); setPurging(place); }}>영구 삭제</button></div>
      </article>)}
      {error && !purging && <p className="error" role="alert">{error}</p>}
    </div>}
    {purging && <ActionDialog title="이 장소를 영구 삭제할까요?" destructive message={`${purging.name}의 메모와 저장 기록, 장소에 연결된 원본 링크 기록을 완전히 삭제해요. 되돌릴 수 없어요.`} cancelLabel="취소" confirmLabel="영구 삭제" busy={busy} onClose={() => setPurging(null)} onConfirm={() => change(purging, true)}>{error && <p className="error" role="alert">{error}</p>}</ActionDialog>}
  </section>;
}
