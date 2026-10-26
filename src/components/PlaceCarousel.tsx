"use client";
import { useEffect, useLayoutEffect, useRef } from "react";
import Icon from "./Icon";
import { STATUS_LABEL } from "@/lib/types";
import { placeMeta, type PlaceView } from "@/lib/place-view";

export default function PlaceCarousel({ places, selectedId, onSelect, onOpen, onDismiss, newPlaceIds }: {
  newPlaceIds?: ReadonlySet<string>; places: PlaceView[]; selectedId: string; onSelect: (id: string) => void; onOpen: (id: string) => void; onDismiss: () => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const settledId = useRef<string | undefined>(undefined); const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const gesture = useRef<{ x: number; y: number; moved: boolean } | undefined>(undefined);
  const latest = useRef({ places, selectedId, onSelect }); latest.current = { places, selectedId, onSelect };
  const ids = places.map((place) => place.id).join(",");
  function align(id: string, smooth = false) {
    const container = rail.current, card = container?.querySelector<HTMLElement>(`[data-place-id="${CSS.escape(id)}"]`);
    if (!container || !card) return;
    container.scrollTo({ left: card.offsetLeft - (container.clientWidth - card.offsetWidth) / 2, behavior: smooth && !matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "auto" });
  }
  useLayoutEffect(() => {
    if (settledId.current === selectedId && rail.current?.dataset.ids === ids) return;
    clearTimeout(timer.current); settledId.current = selectedId;
    if (rail.current) rail.current.dataset.ids = ids;
    align(selectedId);
  }, [selectedId, ids]);
  useEffect(() => {
    const observer = new ResizeObserver(() => align(latest.current.selectedId));
    if (rail.current) observer.observe(rail.current);
    return () => { observer.disconnect(); clearTimeout(timer.current); };
  }, []);
  function settle() {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const container = rail.current; if (!container) return;
      const center = container.scrollLeft + container.clientWidth / 2;
      const cards = Array.from(container.querySelectorAll<HTMLElement>("[data-place-id]"));
      const nearest = cards.reduce<HTMLElement | undefined>((best, card) => !best || Math.abs(card.offsetLeft + card.offsetWidth / 2 - center) < Math.abs(best.offsetLeft + best.offsetWidth / 2 - center) ? card : best, undefined);
      const id = nearest?.dataset.placeId;
      if (id && id !== latest.current.selectedId) {
        settledId.current = id;
        if (container.contains(document.activeElement)) nearest?.querySelector<HTMLButtonElement>(".place-card-main")?.focus({ preventScroll: true });
        latest.current.onSelect(id);
      }
    }, 120);
  }
  function step(direction: number) {
    const index = places.findIndex((place) => place.id === selectedId), next = places[index + direction];
    if (next) align(next.id, true);
  }
  const index = places.findIndex((place) => place.id === selectedId);
  return <section className="place-carousel" aria-label="저장한 장소 카드" aria-roledescription="캐러셀" onKeyDown={(event) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); step(event.key === "ArrowRight" ? 1 : -1); }
  }}>
    <div ref={rail} className="place-card-rail" onScroll={settle}
      onPointerDown={(event) => { gesture.current = { x: event.clientX, y: event.clientY, moved: false }; }}
      onPointerMove={(event) => { if (gesture.current && Math.hypot(event.clientX - gesture.current.x, event.clientY - gesture.current.y) > 8) gesture.current.moved = true; }}
      onClickCapture={(event) => { if (gesture.current?.moved && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); } }}>
      {places.map((place, i) => <article key={place.id} data-place-id={place.id} className={`place-card${place.id === selectedId ? " is-selected" : ""}`} aria-roledescription="슬라이드" aria-label={`${i + 1} / ${places.length}`}>
        <button className="place-card-main" tabIndex={place.id === selectedId ? 0 : -1} aria-label={`${place.name} 상세 보기`} aria-current={place.id === selectedId ? "true" : undefined} onClick={() => onOpen(place.id)}>
        <span className="card-badges"><span className={`status-tag ${place.status}`}>{STATUS_LABEL[place.status]}</span>{newPlaceIds?.has(place.id) && <span className="new-place-badge" aria-label="새로 등록한 장소">NEW</span>}</span>
        <strong>{place.name}</strong><span className="card-meta">{placeMeta(place) || place.address || "저장한 장소"}</span>
        {place.memo && <span className="card-memo">{place.memo}</span>}
        <span className="card-bottom"><span className="card-sharer"><Icon name="user" width="13" />{place.sharers.length >= 2 ? "둘 다 저장함" : place.sharers[0] ? `${place.sharers[0]}님이 저장` : "우리의 장소"}</span><span className="card-count">{i + 1} / {places.length}</span></span>
        <span className="card-open"><Icon name="arrow" width="19" /></span>
        </button>
        <button className="icon-btn carousel-dismiss" tabIndex={place.id === selectedId ? 0 : -1} aria-label="장소 카드 닫기" onClick={onDismiss}><Icon name="close" width="17" /></button>
      </article>)}
    </div>
    {places.length > 1 && <><button className="icon-btn carousel-step previous" aria-label="이전 장소" disabled={index <= 0} onClick={() => step(-1)}><Icon name="back" width="18" /></button><button className="icon-btn carousel-step next" aria-label="다음 장소" disabled={index >= places.length - 1} onClick={() => step(1)}><Icon name="chevron" width="18" /></button></>}
    <span className="sr-only" role="status">{index + 1} / {places.length}, {places[index]?.name}</span>
  </section>;
}
