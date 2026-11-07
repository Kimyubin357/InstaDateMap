"use client";
import Icon from "./Icon";
import { STATUS_LABEL, type PlaceStatus } from "@/lib/types";
import { placeMeta, type PlaceView } from "@/lib/place-view";

const SECTIONS: { key: "new" | PlaceStatus; title: string }[] = [
  { key: "new", title: "새로 저장" }, { key: "wish", title: STATUS_LABEL.wish }, { key: "again", title: STATUS_LABEL.again },
  { key: "visited", title: STATUS_LABEL.visited }, { key: "meh", title: STATUS_LABEL.meh },
];

/** A neighbourhood card's places (mockup A, S2 frame 2): portrait sheet above the nav, landscape left column. */
export default function RegionPlacesList({ label, places, newPlaceIds, onPick, onClose }: {
  label: string | null; places: PlaceView[]; newPlaceIds: ReadonlySet<string>; onPick: (id: string) => void; onClose: () => void;
}) {
  const name = label || "이 지역";
  const wish = places.filter((p) => p.status === "wish").length, fresh = places.filter((p) => newPlaceIds.has(p.id)).length;
  const recent = [...places].sort((a, b) => (b.last_saved_at || b.created_at).localeCompare(a.last_saved_at || a.created_at));
  const sections = SECTIONS.map((section) => ({ ...section, places: recent.filter((p) => section.key === "new" ? newPlaceIds.has(p.id) : p.status === section.key && !newPlaceIds.has(p.id)) }))
    .filter((section) => section.places.length);
  return <section className="region-sheet" aria-labelledby="region-sheet-title">
    <header className="region-sheet-head">
      <div className="region-sheet-title"><h2 id="region-sheet-title">{name} {places.length}곳</h2><p>가고 싶음 {wish}{fresh > 0 && <> · <span className="new-place-badge">NEW</span> {fresh}</>}</p></div>
      <button type="button" className="icon-btn region-sheet-close" aria-label={`${name} 목록 닫기`} onClick={onClose}><Icon name="close" width="18" /></button>
    </header>
    <div className="region-sheet-body">
      {sections.map((section) => <section key={section.key} aria-label={`${section.title} ${section.places.length}곳`}>
        <h3>{section.title} <small>{section.places.length}</small></h3>
        <ul>{section.places.map((place) => <li key={place.id}><button type="button" className="region-place-row" onClick={() => onPick(place.id)}>
          <span className={`status-tag ${place.status}`}>{STATUS_LABEL[place.status]}</span>
          <span className="region-place-copy"><strong>{place.name}</strong><small>{[placeMeta(place) || place.address, place.sharers.length >= 2 ? "둘 다 저장함" : place.sharers[0] ? `${place.sharers[0]}님이 저장` : ""].filter(Boolean).join(" · ")}</small></span>
          {newPlaceIds.has(place.id) && <span className="new-place-badge" aria-label="새로 등록한 장소">NEW</span>}
          <Icon name="chevron" width="17" />
        </button></li>)}</ul>
      </section>)}
    </div>
  </section>;
}
