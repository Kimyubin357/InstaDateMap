"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import Modal from "./Modal";
import Icon from "./Icon";
import { useBoardSync } from "./BoardProvider";
import { PlaceSearch } from "@/lib/place-search";
import type { KakaoPlace } from "@/lib/types";
import styles from "./Registration.module.css";

const closeButton = (label: string, onClose: () => void) => <button type="button" className="icon-btn sheet-close-btn" aria-label={label} onClick={onClose}><Icon name="close" width={18} /></button>;

/**
 * 이름으로 찾기(시안 5번): 장소 하나만 바꿉니다. 검색어는 읽은 이름(+지역)으로 미리 채우고,
 * 고르면 그 장소만 '위치 확인됨'이 됩니다. 끝까지 없으면 이 장소를 명시적으로 뺍니다.
 */
export function NameSearchSheet({ name, initial, suggestions, onPick, onExclude, onClose }: {
  name: string; initial: string; suggestions: string[];
  onPick: (place: KakaoPlace, query: string) => void; onExclude: () => void; onClose: () => void;
}) {
  const { lock } = useBoardSync();
  const [model] = useState(() => { const search = new PlaceSearch(); search.setQuery(initial, false); return search; });
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  model.onUnauthorized = () => { void lock(); };
  useEffect(() => { if (initial.trim()) void model.search(); return () => model.pause(); }, [model]);
  const run = (query?: string) => { if (query !== undefined) model.setQuery(query, false); if (model.getSnapshot().query.trim()) void model.search(); };
  return <Modal title={`${name} 찾기`} variant="compact" className={styles.sheet} headerActions={closeButton("이름으로 찾기 닫기", onClose)} onClose={onClose}
    footer={<button type="button" className="btn" onClick={onExclude}>찾는 곳이 없어요 · 이 장소 빼기</button>}>
    <p className={styles.sheetLead}>이 장소만 바뀌고, 다른 장소에서 고른 내용은 그대로예요.</p>
    <form className={styles.query} role="search" onSubmit={(event) => { event.preventDefault(); run(); }}>
      <Icon name="search" width={18} />
      <input value={state.query} onChange={(event) => model.setQuery(event.target.value, false)} aria-label={`${name} 검색어`} enterKeyHint="search" maxLength={100} autoComplete="off" />
      {state.query && <button type="button" aria-label="검색어 지우기" onClick={() => model.setQuery("", false)}><Icon name="close" width={16} /></button>}
      <button type="submit" disabled={!state.query.trim() || state.busy}>{state.busy ? "찾는 중" : "검색"}</button>
    </form>
    {suggestions.length > 0 && <div className={styles.chips}>이렇게도 찾아보기{suggestions.map((s) => <button key={s} type="button" onClick={() => run(s)}><span>{s}</span></button>)}</div>}
    {state.busy && <p className={styles.status} role="status">찾고 있어요…</p>}
    {(state.error || state.moreError) && <p className="error" role="alert">{state.error || state.moreError}</p>}
    {state.results?.length === 0 && <p className={styles.status} role="status">검색 결과가 없어요. 동네 이름을 더하거나 다른 이름으로 찾아보세요.</p>}
    {!!state.results?.length && <div className={styles.results}>{state.results.map((place) => <div key={place.kakao_place_id} className={styles.result}>
      <span><strong>{place.name}</strong><small>{[place.category, place.address].filter(Boolean).join(" · ")}</small></span>
      <button type="button" className={styles.pickBtn} aria-label={`${place.name} 고르기`} onClick={() => { model.pause(); onPick(place, state.searched); }}><span>고르기</span></button>
    </div>)}</div>}
    {state.hasMore && <button className="btn search-more" disabled={state.busy || state.loadingMore} onClick={() => void model.loadMore()}>{state.loadingMore ? "다음 결과를 찾고 있어요…" : "다음 검색 결과 보기"}</button>}
  </Modal>;
}

/** 지점 고르기(시안 8번): 후보마다 번호·지점 이름·주소. [여기 없어요]는 이름으로 찾기로 이어집니다. */
export function BranchSheet({ name, options, pickedId, onPick, onSearch, onClose }: {
  name: string; options: KakaoPlace[]; pickedId: string | null;
  onPick: (place: KakaoPlace) => void; onSearch: () => void; onClose: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(pickedId ?? options[0]?.kakao_place_id ?? null);
  const index = options.findIndex((p) => p.kakao_place_id === selected);
  return <Modal title={`${name} 지점 고르기`} variant="compact" className={styles.sheet} headerActions={closeButton("지점 고르기 닫기", onClose)} onClose={onClose}
    footer={<><button type="button" className="btn" onClick={onSearch}><Icon name="search" width={18} />여기 없어요</button>
      <button type="button" className="btn primary" disabled={index < 0} onClick={() => { if (index >= 0) onPick(options[index]); }}>{index >= 0 ? `${index + 1}번으로 고르기` : "지점을 골라 주세요"}</button></>}>
    <p className={styles.sheetLead}>후보가 여러 곳이에요. 맞는 지점을 골라 주세요.</p>
    <div role="radiogroup" aria-label={`${name} 지점`}>
      {options.map((place, i) => <button key={place.kakao_place_id} type="button" role="radio" aria-checked={place.kakao_place_id === selected} className={styles.cand} onClick={() => setSelected(place.kakao_place_id)}>
        <span className={styles.radio} aria-hidden="true">{i + 1}</span>
        <span><strong>{place.name}</strong><small>{[place.address, place.category].filter(Boolean).join(" · ")}</small></span>
      </button>)}
    </div>
  </Modal>;
}
