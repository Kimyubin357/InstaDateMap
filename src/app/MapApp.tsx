"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STATUS_LABEL, type PlaceStatus } from "@/lib/types";
import { requestJson } from "@/lib/client-request";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    kakao: any;
    instgrm?: { Embeds: { process: () => void } };
  }
}

interface Place {
  id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  category: string | null;
  kakao_url: string | null;
  status: PlaceStatus;
  memo: string | null;
  sharers: string[];
  sources: { url: string; media_type: string }[];
}

interface Pending {
  id: string;
  url: string;
  status: "pending_confirm" | "needs_review" | "needs_caption";
  shared_by: string;
}

const STATUS_ORDER: PlaceStatus[] = ["wish", "again", "visited", "meh"];
const STATUS_COLOR: Record<PlaceStatus, string> = {
  wish: "var(--wish)",
  again: "var(--again)",
  visited: "var(--visited)",
  meh: "var(--meh)",
};
const PENDING_LABEL: Record<Pending["status"], string> = {
  pending_confirm: "고르기 남음",
  needs_review: "장소 못 찾음",
  needs_caption: "캡션 필요",
};

const scripts = new Map<string, Promise<void>>();
function loadScript(src: string, id: string): Promise<void> {
  const existing = scripts.get(id);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.id = id;
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { scripts.delete(id); s.remove(); reject(new Error("지도 스크립트 로드 실패")); };
    document.head.appendChild(s);
  });
  scripts.set(id, promise);
  return promise;
}

export default function MapApp({ token, who, kakaoKey }: { token: string; who: string; kakaoKey: string }) {
  const [board, setBoard] = useState("데이트맵");
  const [places, setPlaces] = useState<Place[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<Set<PlaceStatus>>(new Set(STATUS_ORDER));
  const [category, setCategory] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showPending, setShowPending] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  const mapEl = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const overlays = useRef<any[]>([]);
  const fitted = useRef(false);
  const meOverlay = useRef<any>(null);
  const mePos = useRef<{ lat: number; lng: number } | null>(null);
  const followOnFix = useRef(false);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);

  const api = useCallback(
    (path: string, init?: RequestInit) =>
      fetch(path, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", "x-board-token": token, ...init?.headers } }),
    [token],
  );

  const refresh = useCallback(async () => {
    try {
      const res = await api("/api/places");
      if (!res.ok) {
        setError(res.status === 401 ? "보드 주소가 맞지 않아요. 처음 받은 주소로 다시 열어 주세요." : "장소를 불러오지 못했어요.");
        return;
      }
      const body = await res.json();
      setBoard(body.board);
      setPlaces(body.places);
      setPending(body.pending);
      setLoaded(true);
      setError(null);
    } catch {
      setError("서버에 연결하지 못했어요. 연결을 확인하고 다시 열어 주세요.");
    }
  }, [api]);

  useEffect(() => {
    refresh();
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  // 카카오맵 SDK
  useEffect(() => {
    if (!kakaoKey) {
      setMapError("카카오 JavaScript 키(NEXT_PUBLIC_KAKAO_JS_KEY)가 설정되지 않았어요.");
      return;
    }
    loadScript(`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${kakaoKey}&autoload=false`, "kakao-sdk")
      .then(() =>
        window.kakao.maps.load(() => {
          if (!mapEl.current || map.current) return;
          map.current = new window.kakao.maps.Map(mapEl.current, {
            center: new window.kakao.maps.LatLng(37.5446, 127.0557), // 성수 근처에서 시작
            level: 6,
          });
          setMapReady(true);
        }),
      )
      .catch(() => setMapError("지도를 불러오지 못했어요. 카카오 앱 설정의 사이트 도메인을 확인해 주세요."));
  }, [kakaoKey]);

  const categories = useMemo(
    () => [...new Set(places.map((p) => p.category).filter((c): c is string => !!c))].sort(),
    [places],
  );

  const visible = useMemo(
    () => places.filter((p) => statusFilter.has(p.status) && (!category || p.category === category)),
    [places, statusFilter, category],
  );

  const drawMarkers = useCallback(() => {
    const k = window.kakao;
    if (!map.current || !k) return;
    overlays.current.forEach((o) => o.setMap(null));
    overlays.current = visible.map((p) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = `pin ${p.status}${p.id === selectedId ? " active" : ""}`;
      el.setAttribute("aria-label", `${p.name}, ${STATUS_LABEL[p.status]}`);
      const mark = document.createElement("i");
      mark.className = "mark";
      const label = document.createElement("span");
      label.textContent = p.name;
      el.append(mark, label);
      el.addEventListener("click", () => setSelectedId(p.id));
      const ov = new k.maps.CustomOverlay({
        position: new k.maps.LatLng(p.lat, p.lng),
        content: el,
        xAnchor: 0, // .pin의 translate(-50%)가 가운데 정렬을 담당합니다.
        yAnchor: 0,
        zIndex: p.id === selectedId ? 10 : 1,
      });
      ov.setMap(map.current);
      return ov;
    });
    if (!fitted.current && visible.length > 0) {
      const b = new k.maps.LatLngBounds();
      visible.forEach((p) => b.extend(new k.maps.LatLng(p.lat, p.lng)));
      map.current.setBounds(b, 80, 120, 120, 120);
      fitted.current = true;
    }
  }, [visible, selectedId]);

  useEffect(() => {
    if (mapReady) drawMarkers();
  }, [drawMarkers, mapReady]);

  // 내 위치: 지도가 준비되면 위치를 계속 받아 파란 점으로 보여 줍니다.
  const showMe = useCallback((lat: number, lng: number) => {
    const k = window.kakao;
    if (!map.current || !k) return;
    const pos = new k.maps.LatLng(lat, lng);
    if (!meOverlay.current) {
      const el = document.createElement("div");
      el.className = "me-dot";
      el.setAttribute("aria-label", "내 위치");
      meOverlay.current = new k.maps.CustomOverlay({ position: pos, content: el, zIndex: 5 });
      meOverlay.current.setMap(map.current);
    } else {
      meOverlay.current.setPosition(pos);
    }
  }, []);

  const geoError = useCallback((e: GeolocationPositionError) => {
    setLocating(false);
    followOnFix.current = false;
    setLocError(
      e.code === e.PERMISSION_DENIED
        ? "위치 권한이 꺼져 있어요. 설정 → 개인정보 보호 및 보안 → 위치 서비스 → Safari 웹 사이트를 '앱을 사용하는 동안'으로 바꿔 주세요."
        : "현재 위치를 찾지 못했어요. 잠시 뒤 다시 눌러 주세요.",
    );
  }, []);

  useEffect(() => {
    if (!mapReady || !("geolocation" in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const { latitude: lat, longitude: lng } = p.coords;
        mePos.current = { lat, lng };
        setLocError(null);
        showMe(lat, lng);
        if (followOnFix.current) {
          followOnFix.current = false;
          setLocating(false);
          map.current?.setLevel(4);
          map.current?.panTo(new window.kakao.maps.LatLng(lat, lng));
        } else if (!fitted.current && places.length === 0 && loaded) {
          // 저장한 장소가 없으면 내 위치에서 시작
          map.current?.setCenter(new window.kakao.maps.LatLng(lat, lng));
          fitted.current = true;
        }
      },
      geoError,
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [mapReady, showMe, geoError, loaded, places.length]);

  const goToMe = () => {
    setLocError(null);
    if (!("geolocation" in navigator)) {
      setLocError("이 브라우저는 위치를 지원하지 않아요.");
      return;
    }
    if (mePos.current) {
      map.current?.setLevel(4);
      map.current?.panTo(new window.kakao.maps.LatLng(mePos.current.lat, mePos.current.lng));
      return;
    }
    setLocating(true);
    followOnFix.current = true;
    // 권한을 아직 안 물었다면 여기서 물어봅니다.
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const { latitude: lat, longitude: lng } = p.coords;
        mePos.current = { lat, lng };
        showMe(lat, lng);
        followOnFix.current = false;
        setLocating(false);
        map.current?.setLevel(4);
        map.current?.panTo(new window.kakao.maps.LatLng(lat, lng));
      },
      geoError,
      { enableHighAccuracy: true, timeout: 20000 },
    );
  };

  const selected = places.find((p) => p.id === selectedId) ?? null;

  const toggleStatus = (s: PlaceStatus) =>
    setStatusFilter((cur) => {
      const next = new Set(cur);
      if (next.has(s) && next.size === STATUS_ORDER.length) return new Set([s]); // 전체 상태에서 누르면 그것만
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next.size === 0 ? new Set(STATUS_ORDER) : next;
    });

  const allOn = statusFilter.size === STATUS_ORDER.length;

  return (
    <div className="map-root">
      <div ref={mapEl} className="map-canvas" aria-label="저장한 장소 지도" />
      {(error || mapError) && (
        <div className="map-empty">
          <p>{error || mapError}</p>
        </div>
      )}
      {!error && !mapError && loaded && places.length === 0 && (
        <div className="map-empty" style={{ pointerEvents: "none" }}>
          <p>
            아직 저장한 곳이 없어요.
            <br />
            오른쪽 아래 + 링크를 눌러 인스타 링크를 붙여넣어 보세요.
          </p>
        </div>
      )}

      <header className="topbar">
        <div className="board-name">{board}</div>
        <div className="chips" role="toolbar" aria-label="상태로 거르기">
          <button className="chip" aria-pressed={allOn} onClick={() => setStatusFilter(new Set(STATUS_ORDER))}>
            전체 {places.length}
          </button>
          {STATUS_ORDER.map((s) => (
            <button key={s} className="chip" aria-pressed={!allOn && statusFilter.has(s)} onClick={() => toggleStatus(s)}>
              <i className="dot" style={{ background: STATUS_COLOR[s] }} />
              {STATUS_LABEL[s]} {places.filter((p) => p.status === s).length}
            </button>
          ))}
        </div>
        {categories.length > 1 && (
          <div className="chips" role="toolbar" aria-label="종류로 거르기">
            <button className="chip" aria-pressed={!category} onClick={() => setCategory(null)}>
              모든 종류
            </button>
            {categories.map((c) => (
              <button key={c} className="chip" aria-pressed={category === c} onClick={() => setCategory(category === c ? null : c)}>
                {c}
              </button>
            ))}
          </div>
        )}
      </header>

      {!selected && mapReady && (
        <button className="locate-btn" onClick={goToMe} aria-label="내 위치로 이동" disabled={locating}>
          {locating ? "…" : "◎"}
        </button>
      )}

      {locError && !selected && (
        <div className="loc-toast" role="status" onClick={() => setLocError(null)}>
          {locError}
        </div>
      )}

      {!selected && (
        <a className="fab" href={`/add?t=${encodeURIComponent(token)}&who=${encodeURIComponent(who)}`}>
          + 링크
        </a>
      )}

      {pending.length > 0 && !selected && (
        <button className="pending-bar" onClick={() => setShowPending(true)}>
          <span>
            확인할 링크 <b>{pending.length}개</b>
          </span>
          <span>보기</span>
        </button>
      )}

      {selected && (
        <PlaceSheet
          key={selected.id}
          place={selected}
          onClose={() => setSelectedId(null)}
          onChange={async (patch) => {
            await requestJson(`/api/places/${selected.id}`, { method: "PATCH", headers: { "Content-Type": "application/json", "x-board-token": token }, body: JSON.stringify(patch) });
            setPlaces((ps) => ps.map((p) => (p.id === selected.id ? { ...p, ...patch } : p)));
          }}
          onDelete={async () => {
            if (!confirm(`${selected.name}을(를) 지도에서 지울까요?`)) return;
            await requestJson(`/api/places/${selected.id}`, { method: "DELETE", headers: { "x-board-token": token } });
            setSelectedId(null);
            setPlaces((ps) => ps.filter((p) => p.id !== selected.id));
          }}
        />
      )}

      {showPending && (
        <>
          <div className="sheet-backdrop" onClick={() => setShowPending(false)} />
          <section className="sheet" role="dialog" aria-label="확인할 링크">
            <div className="grabber" />
            <h2>확인할 링크</h2>
            <p className="addr">고르기가 남았거나 장소를 못 찾은 링크예요.</p>
            <div className="embeds" style={{ marginTop: 14 }}>
              {pending.map((s) => (
                <a
                  key={s.id}
                  className="embed-fallback"
                  href={`/confirm/${s.id}?t=${encodeURIComponent(token)}&who=${encodeURIComponent(who || s.shared_by)}`}
                >
                  {PENDING_LABEL[s.status]} · {s.shared_by}
                  <br />
                  <small style={{ color: "var(--ink-soft)" }}>{s.url}</small>
                </a>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function PlaceSheet({
  place,
  onClose,
  onChange,
  onDelete,
}: {
  place: Place;
  onClose: () => void;
  onChange: (patch: Partial<Pick<Place, "status" | "memo">>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [memo, setMemo] = useState(place.memo ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function change(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { await action(); }
    catch (e) { setError(e instanceof Error ? e.message : "변경 내용을 저장하지 못했어요."); }
    finally { setBusy(false); }
  }
  const both = place.sharers.length >= 2;

  // 인스타 공식 임베드: 원본 사진·캐러셀·릴스를 그 자리에서 보여 줍니다.
  useEffect(() => {
    loadScript("https://www.instagram.com/embed.js", "ig-embed")
      .then(() => window.instgrm?.Embeds.process())
      .catch(() => undefined);
  }, [place.id]);

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <section className="sheet" role="dialog" aria-label={place.name}>
        <div className="grabber" />
        <h2>{place.name}</h2>
        {place.address && <p className="addr">{place.address}</p>}
        <div className="badges">
          {place.category && <span className="badge">{place.category}</span>}
          {both ? (
            <span className="badge both">둘 다 저장함</span>
          ) : (
            place.sharers[0] && <span className="badge">{place.sharers[0]}님이 저장</span>
          )}
        </div>

        <div className="seg" role="group" aria-label="상태">
          {STATUS_ORDER.map((s) => (
            <button key={s} className={s} disabled={busy} aria-pressed={place.status === s} onClick={() => change(() => onChange({ status: s }))}>
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>

        <div className="section-label">원본 게시물</div>
        <div className="embeds">
          {place.sources.map((src) => (
            <blockquote
              key={src.url}
              className="instagram-media"
              data-instgrm-permalink={src.url}
              data-instgrm-version="14"
            >
              <a className="embed-fallback" href={src.url} target="_blank" rel="noreferrer">
                인스타그램에서 {src.media_type === "reel" ? "릴스" : "게시물"} 보기
              </a>
            </blockquote>
          ))}
          {place.sources.length === 0 && <p className="addr">연결된 원본이 없어요.</p>}
        </div>

        <div className="section-label">메모</div>
        <textarea
          className="memo"
          value={memo}
          maxLength={500}
          placeholder="예: 주말엔 웨이팅 김, 창가 자리 추천"
          onChange={(e) => setMemo(e.target.value)}
          onBlur={() => memo !== (place.memo ?? "") && change(() => onChange({ memo }))}
        />
        {error && <p className="error" role="alert">{error}</p>}

        <div className="actions">
          {place.kakao_url && (
            <a className="btn primary" href={place.kakao_url} target="_blank" rel="noreferrer">
              카카오맵에서 열기
            </a>
          )}
          <button className="btn danger" disabled={busy} onClick={() => change(onDelete)}>
            핀 지우기
          </button>
        </div>
      </section>
    </>
  );
}
