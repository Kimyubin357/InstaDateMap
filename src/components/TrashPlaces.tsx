"use client";
import { useEffect, useRef, useState } from "react";
import { requestJson } from "@/lib/client-request";
import { useBoardState, useBoardSync } from "./BoardProvider";
import ActionDialog from "./ActionDialog";
import ClientReady from "./ClientReady";
import PageHeader from "./PageHeader";
import type { SavedPlace } from "@/lib/saved-place";
import ShellLink from "./ShellLink";

interface TrashedPlace { id: string; name: string; address: string; memo: string | null; deleted_at: string; deleted_by: string | null }
export default function TrashPlaces() {
  const { store, notify } = useBoardSync();
  const state = useBoardState();
  const [refresh, setRefresh] = useState(0);
  const [places, setPlaces] = useState<TrashedPlace[]>([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [purging, setPurging] = useState<TrashedPlace | null>(null);
  const [restoredPlaces, setRestoredPlaces] = useState<Pick<TrashedPlace, "id" | "name">[]>([]);
  const writing = useRef(false);
  const readVersion = useRef(0);
  useEffect(() => {
    let active = true;
    const version = ++readVersion.current;
    setLoading(true);
    void requestJson<{ places: TrashedPlace[] }>("/api/trash", { cache: "no-store" }).then((data) => {
      if (active && version === readVersion.current) setPlaces(data.places);
    }).catch((e) => { if (active && version === readVersion.current) setError(e instanceof Error ? e.message : "목록을 불러오지 못했어요."); })
      .finally(() => { if (active && version === readVersion.current) setLoading(false); });
    return () => { active = false; };
  }, [refresh, state.snapshot?.revision]);
  async function change(place: TrashedPlace, purge = false) {
    if (writing.current) return;
    writing.current = true; ++readVersion.current; setBusy(true); setError("");
    try {
      const result = await requestJson<{ ok: boolean; saved_place?: SavedPlace }>(`/api/trash/${place.id}`, { method: purge ? "DELETE" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deleted_at: place.deleted_at }) });
      if (!result.ok) throw new Error("처리 결과를 확인하지 못했어요. 목록을 다시 확인해 주세요.");
      if (!purge && !store.acceptSavedPlace(result.saved_place)) await store.refresh();
      ++readVersion.current;
      setPlaces((rows) => rows.filter((row) => row.id !== place.id));
      setPurging(null);
      if (!purge) setRestoredPlaces((rows) => [place, ...rows.filter((row) => row.id !== place.id)]);
      notify(purge ? "장소를 영구 삭제했어요." : "장소를 지도에 복구했어요.", "success", purge ? undefined : { label: "장소 보기", href: `/?restored=${encodeURIComponent(place.id)}` });
      void store.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "처리 결과를 확인하지 못했어요. 목록을 다시 확인해 주세요."); }
    finally { ++readVersion.current; writing.current = false; setBusy(false); setRefresh((n) => n + 1); }
  }
  return <main className="form-page"><ClientReady><PageHeader title="삭제한 장소" backHref="/settings" />
    <div id="deleted-places" className="stack" aria-busy={loading || busy}>
      <p className="hint">메모·상태·원본 링크까지 함께 복구해요. 자동으로 지워지지 않으며, 영구 삭제하면 되돌릴 수 없어요.</p>
      {restoredPlaces.length > 0 && <section className="trash-restored"><h2>복구한 장소 {restoredPlaces.length}곳</h2><p className="hint">계속 복구하거나, 원하는 장소를 지도에서 확인해 주세요.</p>{restoredPlaces.map((place) => <div key={place.id}><span>{place.name}</span><ShellLink href={`/?restored=${encodeURIComponent(place.id)}`} aria-label={`${place.name} 장소 보기`}>장소 보기</ShellLink></div>)}</section>}
      <button className="btn" disabled={loading || busy} onClick={() => { setError(""); setRefresh((n) => n + 1); }}>목록 새로고침</button>
      {loading && <p role="status" className="hint">삭제한 장소를 확인하고 있어요…</p>}
      {!loading && !places.length && !error && <p className="hint">삭제한 장소가 없어요.</p>}
      {places.map((place) => <article key={place.id} className="trash-place">
        <h3>{place.name}</h3><p className="hint">{place.address}</p>
        <p className="hint">{place.deleted_by ? `${place.deleted_by} · ` : ""}{new Date(place.deleted_at).toLocaleDateString("ko-KR")} 삭제</p>
        {place.memo && <p className="trash-memo">{place.memo}</p>}
        <div className="trash-actions"><button className="btn primary" disabled={busy} onClick={() => void change(place)}>복구하기</button><button className="btn" disabled={busy} onClick={() => { setError(""); setPurging(place); }}>영구 삭제</button></div>
      </article>)}
      {error && !purging && <p className="error" role="alert">{error}</p>}
    </div>
    {purging && <ActionDialog title="이 장소를 영구 삭제할까요?" destructive message={`${purging.name}의 메모와 저장 기록, 장소에 연결된 원본 링크 기록을 완전히 삭제해요. 되돌릴 수 없어요.`} cancelLabel="취소" confirmLabel="영구 삭제" busy={busy} onClose={() => setPurging(null)} onConfirm={() => change(purging, true)}>{error && <p className="error" role="alert">{error}</p>}</ActionDialog>}
  </ClientReady></main>;
}
