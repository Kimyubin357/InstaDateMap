"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Modal from "./Modal";
import Icon from "./Icon";
import { STATUS_LABEL, type PlaceStatus } from "@/lib/types";
import { STATUS_ORDER, type PlaceView, placeMeta } from "@/lib/place-view";
import { requestJson } from "@/lib/client-request";
import { loadScript } from "@/lib/scripts";
import MapCanvas from "./MapCanvas";
const ignore = () => {};
export default function PlaceSheet({ place, kakaoKey, onClose, onShowMap, onPatch, onDelete }: { place: PlaceView; kakaoKey: string; onClose: () => void; onShowMap: () => void; onPatch: (patch: { status?: PlaceStatus; memo?: string }) => void; onDelete: () => void }) {
  const [memo, setMemo] = useState(place.memo || ""); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const lastMemo = useRef(place.memo || "");
  useEffect(() => { const incoming = place.memo || "", previous = lastMemo.current; setMemo((draft) => draft === previous ? incoming : draft); lastMemo.current = incoming; }, [place.memo]);
  const [more, setMore] = useState(false); const [deleting, setDeleting] = useState(false);
  const preview = useMemo(() => [place], [place.id, place.lat, place.lng, place.status]);
  function mayLeave() { return memo === (place.memo || "") || confirm("아직 저장하지 않은 메모가 있어요. 닫을까요?"); }
  function close() { if (mayLeave()) onClose(); }
  async function patch(value: { status?: PlaceStatus; memo?: string }) {
    setBusy(true); setError(""); setNotice("");
    try { await requestJson(`/api/places/${place.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }); onPatch(value); setNotice(value.memo !== undefined ? "메모를 저장했어요." : "상태를 바꿨어요."); }
    catch (e) { setError(e instanceof Error ? e.message : "저장하지 못했어요."); } finally { setBusy(false); }
  }
  return <Modal title={place.name} className="sheet-place" initialStop={2} onClose={busy ? () => {} : close} footer={<div className="detail-actions"><a className="btn primary" href={place.kakao_url || `https://map.kakao.com/link/map/${encodeURIComponent(place.name)},${place.lat},${place.lng}`} target="_blank" rel="noreferrer"><Icon name="external" />카카오맵 열기</a>
      <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(place.address || place.name); setNotice("주소를 복사했어요."); } catch { setError("주소를 복사하지 못했어요. 주소를 길게 눌러 복사해 주세요."); } }}><Icon name="copy" />주소 복사</button>
    </div>}>
    <div className="detail-map"><MapCanvas places={preview} selectedId={place.id} apiKey={kakaoKey} active initialPosition={{ lat: place.lat, lng: place.lng, level: 4 }} onPosition={ignore} onPick={ignore} location={null} viewRequest={null} interactive={false} /><button className="preview-map-button" disabled={busy} onClick={() => { if (mayLeave()) onShowMap(); }}><Icon name="pin" width="15" />지도에서 보기<Icon name="arrow" width="15" /></button></div>
    <div className="detail-title"><h2>{place.name}</h2><span className={`status-tag ${place.status}`}>{STATUS_LABEL[place.status]}</span></div><p className="addr">{place.address}</p>
    <div className="detail-facts"><div><Icon name={place.category === "카페" ? "cup" : "food"} width="20" /><strong>{placeMeta(place) || "저장한 장소"}</strong><span>함께 가볼 곳</span></div><div><Icon name="user" width="20" /><strong>{place.sharers.length >= 2 ? "둘 다 저장함" : place.sharers[0] || "우리"}</strong><span>발견한 사람</span></div></div>
    <div className="detail-section-heading"><span className="section-label">우리에게 어떤 곳인가요?</span><button className="icon-btn" aria-label="장소 더 보기" aria-expanded={more} onClick={() => setMore(!more)}><Icon name="more" /></button></div>
    {more && <div className="delete-panel">{deleting ? <><p>지도에서 이 장소를 지울까요?</p><div className="actions"><button className="btn" onClick={() => setDeleting(false)}>취소</button><button className="btn danger" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await requestJson(`/api/places/${place.id}`, { method: "DELETE" }); onDelete(); } catch (e) { setError(e instanceof Error ? e.message : "삭제하지 못했어요."); } finally { setBusy(false); } }}>지도에서 지우기</button></div></> : <button className="text-btn danger" onClick={() => setDeleting(true)}>이 장소 지우기</button>}</div>}
    <div className="seg four" role="group" aria-label="장소 상태">{STATUS_ORDER.map((s) => <button key={s} disabled={busy} aria-pressed={place.status === s} onClick={() => patch({ status: s })}>{STATUS_LABEL[s]}</button>)}</div>
    <label className="section-label" htmlFor="place-memo">둘만의 메모</label><textarea id="place-memo" className="memo" placeholder="다음에 같이 가면 좋을 시간, 먹고 싶은 메뉴…" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={500} /><div className="memo-footer"><small>{memo.length}/500</small><button className="text-btn" disabled={busy || memo === (place.memo || "")} onClick={() => patch({ memo })}>메모 저장</button></div>
    {place.sources.length > 0 ? <details className="source-details" onToggle={(e) => { if (e.currentTarget.open) loadScript("https://www.instagram.com/embed.js", "ig-embed").then(() => window.instgrm?.Embeds.process()).catch(() => undefined); }}><summary>발견했던 인스타 게시물 <span>{place.sources.length}개</span></summary><div className="embeds">{place.sources.map((source) => <blockquote key={source.url} className="instagram-media" data-instgrm-permalink={source.url} data-instgrm-version="14"><a href={source.url} target="_blank" rel="noreferrer" className="embed-fallback">인스타그램에서 {source.media_type === "reel" ? "릴스" : "게시물"} 보기 <Icon name="external" /></a></blockquote>)}</div></details> : <p className="hint">장소를 직접 찾아 저장했어요.</p>}
    {error && <p className="error" role="alert">{error}</p>}{notice && <p className="feedback" role="status">{notice}</p>}</Modal>;
}
