"use client";
import { workId } from "@/lib/work-id";
import { useEffect, useState, useSyncExternalStore } from "react";
import Icon from "./Icon";
import type { KakaoPlace } from "@/lib/types";
import { requestJson } from "@/lib/client-request";
import { CHECKING_SAVE, VerifiedWrite } from "@/lib/verified-write";
import { verifyDirectSave } from "@/lib/save-recovery";
import { PlaceSearch } from "@/lib/place-search";
import { useBoardSync } from "./BoardProvider";
import type { ShareResult } from "@/lib/share-stream";
export default function ManualPlaceSearch({ sourceId, version, sourceReady = true, onSaved }: { sourceId?: string; version?: string; sourceReady?: boolean; onSaved: (r: ShareResult) => void }) {
  const { lock } = useBoardSync();
  const [model] = useState(() => new PlaceSearch());
  const { query, searched, results, busy: searching, error: searchError } = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const [picked, setPicked] = useState<KakaoPlace | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [write, setWrite] = useState(() => new VerifiedWrite<ShareResult>());
  model.onUnauthorized = () => { void lock(); };
  useEffect(() => () => model.pause(), [model]);
  function search(e: React.FormEvent) {
    e.preventDefault(); if (!query.trim() || busy) return; setError(""); setPicked(null); void model.search();
  }
  async function save() {
    if (!picked || busy || (!sourceReady && !write.pending)) return; setBusy(true); setError("");
    try {
      const result = await write.run(async () => {
        const r = sourceId ? await requestJson<{ place_url: string; saved_place?: ShareResult["saved_place"] }>(`/api/sources/${sourceId}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ selections: [], direct: { place_id: picked.kakao_place_id, query: searched }, version, work_id: workId() }) }) :
          await requestJson<ShareResult>("/api/places", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: searched, place_id: picked.kakao_place_id }) });
        return { ...r, status: "status" in r && r.status === "duplicate" ? "duplicate" : "saved", message: `${picked.name}을(를) 저장했어요.` };
      }, () => verifyDirectSave(picked.kakao_place_id, sourceId), () => setError(CHECKING_SAVE));
      onSaved(result);
    } catch (e) { setError(e instanceof Error ? e.message : "저장하지 못했어요."); } finally { setBusy(false); }
  }
  return <><form onSubmit={search} className="search-row"><input className="field" aria-label="새 장소 검색어" placeholder="장소 이름과 동네를 함께 입력해요" value={query} onChange={(e) => { model.setQuery(e.target.value, false); setPicked(null); setError(""); }} maxLength={100} enterKeyHint="search" disabled={busy} /><button className="btn" disabled={busy || !query.trim()}>{searching ? "찾는 중…" : "검색"}</button></form>
    {(error || searchError) && <p className="error" role="alert">{error || searchError}</p>}{results && !results.length && <div className="notice" role="status">검색 결과가 없어요. 동네 이름을 더하거나 다른 이름으로 찾아보세요.</div>}
    {picked ? <div className="manual-confirm"><span className="hint">여기가 맞나요?</span><h3>{picked.name}</h3><p>{picked.address}</p><span className="status-tag wish">가고 싶음으로 저장</span><div className="actions"><button className="btn" disabled={busy} onClick={() => setPicked(null)}>다시 고르기</button><button className="btn primary" disabled={busy || (!sourceReady && !write.pending)} onClick={save}>{busy ? "저장 확인 중…" : write.pending ? "저장 확인·재시도" : "우리 지도에 저장"}</button></div></div> : <div className="manual-results">{results?.map((p) => <button className="manual-result" key={p.kakao_place_id} onClick={() => { setPicked(p); setWrite(new VerifiedWrite<ShareResult>()); setError(""); }} disabled={busy}><Icon name="pin" /><span><strong>{p.name}</strong><small>{p.address}</small><small>{p.category}</small></span><Icon name="chevron" width="17" /></button>)}</div>}</>;
}
