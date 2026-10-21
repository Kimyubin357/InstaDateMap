"use client";
import { useState } from "react";
import Icon from "./Icon";
import type { KakaoPlace } from "@/lib/types";
import { requestJson } from "@/lib/client-request";
import type { ShareResult } from "@/lib/share-stream";
export default function ManualPlaceSearch({ sourceId, onSaved }: { sourceId?: string; onSaved: (r: ShareResult) => void }) {
  const [query, setQuery] = useState(""); const [searched, setSearched] = useState(""); const [results, setResults] = useState<KakaoPlace[] | null>(null);
  const [picked, setPicked] = useState<KakaoPlace | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function search(e: React.FormEvent) {
    e.preventDefault(); if (!query.trim() || busy) return; setBusy(true); setError(""); setPicked(null);
    try { const data = await requestJson<{ places: KakaoPlace[] }>(`/api/search?q=${encodeURIComponent(query.trim())}`); setResults(data.places); setSearched(query.trim()); }
    catch (e) { setError(e instanceof Error ? e.message : "검색하지 못했어요."); } finally { setBusy(false); }
  }
  async function save() {
    if (!picked || busy) return; setBusy(true); setError("");
    try {
      const r = sourceId ? await requestJson<{ place_url: string }>(`/api/sources/${sourceId}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ selections: [], direct: picked, query: searched }) }) :
        await requestJson<ShareResult>("/api/places", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: searched, place_id: picked.kakao_place_id }) });
      onSaved({ status: "saved", message: `${picked.name}을(를) 저장했어요.`, ...r });
    } catch (e) { setError(e instanceof Error ? e.message : "저장하지 못했어요."); } finally { setBusy(false); }
  }
  return <><form onSubmit={search} className="search-row"><input className="field" aria-label="새 장소 검색어" placeholder="장소 이름과 동네를 함께 입력해요" value={query} onChange={(e) => { setQuery(e.target.value); setPicked(null); }} maxLength={100} /><button className="btn" disabled={busy || !query.trim()}>{busy ? "찾는 중…" : "검색"}</button></form>
    {error && <p className="error" role="alert">{error}</p>}{results && !results.length && <div className="notice" role="status">검색 결과가 없어요. 동네 이름을 더하거나 다른 이름으로 찾아보세요.</div>}
    {picked ? <div className="manual-confirm"><span className="hint">여기가 맞나요?</span><h3>{picked.name}</h3><p>{picked.address}</p><span className="status-tag wish">가고 싶음으로 저장</span><div className="actions"><button className="btn" disabled={busy} onClick={() => setPicked(null)}>다시 고르기</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? "저장 중…" : "우리 지도에 저장"}</button></div></div> : <div className="manual-results">{results?.map((p) => <button className="manual-result" key={p.kakao_place_id} onClick={() => setPicked(p)} disabled={busy}><Icon name="pin" /><span><strong>{p.name}</strong><small>{p.address}</small><small>{p.category}</small></span><Icon name="chevron" width="17" /></button>)}</div>}</>;
}
