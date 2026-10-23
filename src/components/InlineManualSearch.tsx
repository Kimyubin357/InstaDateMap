"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { PlaceSearch } from "@/lib/place-search";
import type { KakaoPlace } from "@/lib/types";
import { useBoardSync } from "./BoardProvider";

/** Search for an alternative candidate without allowing an older response to replace it. */
export default function InlineManualSearch({ initial, onPick }: { initial: string; onPick: (place: KakaoPlace, query: string) => void | Promise<void> }) {
  const { lock } = useBoardSync();
  const [search] = useState(() => { const model = new PlaceSearch(); model.setQuery(initial, false); return model; });
  const state = useSyncExternalStore(search.subscribe, search.getSnapshot, search.getSnapshot);
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  search.onUnauthorized = () => { void lock(); };
  useEffect(() => () => search.pause(), [search]);

  function run(event: React.FormEvent) {
    event.preventDefault();
    if (picking || !state.query.trim()) return;
    setError(""); void search.search();
  }

  if (!open) return <button className="btn" style={{ fontSize: 14, padding: 9 }} onClick={() => setOpen(true)}>여기 없어요, 직접 검색</button>;
  return <div>
    <form className="search-row" onSubmit={run}>
      <input className="field" value={state.query} onChange={(event) => { setError(""); search.setQuery(event.target.value, false); }} aria-label="장소 검색어" enterKeyHint="search" maxLength={100} disabled={picking} />
      <button className="btn" style={{ flex: "none", padding: "9px 14px" }} disabled={picking || !state.query.trim()}>{state.busy ? "찾는 중…" : "검색"}</button>
    </form>
    {state.results?.length === 0 && <p className="pick-evidence">검색 결과가 없어요.</p>}
    {(error || state.error) && <p className="error" role="alert">{error || state.error}</p>}
    {state.results?.map((place) => <button key={place.kakao_place_id} className="option" style={{ width: "100%", marginTop: 6, background: "var(--paper)", textAlign: "left" }} disabled={picking || state.busy} onClick={async () => {
      setPicking(true); setError("");
      try { await onPick(place, state.searched); search.pause(); setOpen(false); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "장소를 선택하지 못했어요."); }
      finally { setPicking(false); }
    }}><span>{place.name}<small>{place.address}</small></span></button>)}
  </div>;
}
