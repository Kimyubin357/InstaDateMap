"use client";

import { useMemo, useState } from "react";
import type { KakaoPlace } from "@/lib/types";
import { requestJson } from "@/lib/client-request";

export interface ExtractionView {
  id: string;
  module: string;
  name: string;
  areaHint: string | null;
  evidence: string | null;
  candidates: KakaoPlace[];
}

interface Choice {
  include: boolean;
  pickedId: string | null; // kakao_place_id
  extra: KakaoPlace[]; // 직접 검색으로 찾은 후보
}

const MODULE_LABEL: Record<string, string> = {
  caption: "캡션",
  location_tag: "위치 태그",
  image: "사진",
  video: "영상",
};

export default function ConfirmForm({
  token,
  who,
  source,
  extractions,
}: {
  token: string;
  who: string;
  source: { id: string; url: string; status: string; caption: string | null };
  extractions: ExtractionView[];
}) {
  const [choices, setChoices] = useState<Record<string, Choice>>(() =>
    Object.fromEntries(
      extractions.map((e) => [
        e.id,
        // 기본값: 전부 체크, 첫 번째 후보 선택. 후보가 없으면 체크 해제
        { include: e.candidates.length > 0, pickedId: e.candidates[0]?.kakao_place_id ?? null, extra: [] },
      ]),
    ),
  );
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [reprocessing, setReprocessing] = useState(false);

  const headers = { "Content-Type": "application/json", "x-board-token": token };
  const mapHref = `/?t=${encodeURIComponent(token)}&who=${encodeURIComponent(who)}`;

  const count = useMemo(
    () => Object.values(choices).filter((c) => c.include && c.pickedId).length,
    [choices],
  );

  const update = (id: string, patch: Partial<Choice>) =>
    setChoices((cur) => ({ ...cur, [id]: { ...cur[id], ...patch } }));

  async function save() {
    setSaving(true);
    setError(null);
    const selections = extractions.map((e) => {
      const c = choices[e.id];
      const all = [...e.candidates, ...c.extra];
      const place = all.find((p) => p.kakao_place_id === c.pickedId) ?? null;
      return { extraction_id: e.id, include: c.include && !!place, place };
    });
    try {
      const body = await requestJson<{ saved: number }>(`/api/sources/${source.id}/confirm`, {
        method: "POST",
        headers,
        body: JSON.stringify({ who, selections }),
      });
      setDone(body.saved);
    } catch (e) { setError(e instanceof Error ? e.message : "저장하지 못했어요."); }
    finally { setSaving(false); }
  }

  async function reprocess() {
    if (!caption.trim()) return;
    setReprocessing(true);
    setError(null);
    try {
      const body = await requestJson<{ status: string }>("/api/share", {
        method: "POST",
        headers,
        body: JSON.stringify({ url: source.url, who, caption }),
      });
      if (body.status === "saved") {
        setDone(1);
      } else {
        window.location.reload();
      }
    } catch (e) { setError(e instanceof Error ? e.message : "다시 찾지 못했어요."); }
    finally { setReprocessing(false); }
  }

  if (done !== null) {
    return (
      <main className="confirm">
        <h1>{done > 0 ? `${done}곳을 지도에 저장했어요` : "저장할 곳 없이 정리했어요"}</h1>
        <p className="lead">단축어로 돌아가거나 지도를 열어 보세요.</p>
        <a className="btn primary" href={mapHref}>
          지도 열기
        </a>
      </main>
    );
  }

  const noPlaces = extractions.every((e) => e.candidates.length === 0);

  return (
    <main className="confirm">
      <h1>
        {extractions.length === 0
          ? "장소를 알려 주세요"
          : extractions.length > 1
            ? "남길 곳을 골라 주세요"
            : "어느 곳인지 골라 주세요"}
      </h1>
      <p className="lead">
        {extractions.length === 0 ? "캡션을 붙여넣거나 직접 검색하면 돼요." : "체크를 풀면 지도에 찍히지 않아요."}{" "}
        <a className="source-link" href={source.url} target="_blank" rel="noreferrer">
          원본 보기
        </a>
      </p>

      {extractions.map((e) => {
        const c = choices[e.id];
        const options = [...e.candidates, ...c.extra];
        return (
          <section key={e.id} className={`pick${c.include ? "" : " off"}`}>
            <label className="pick-head">
              <input
                type="checkbox"
                checked={c.include}
                onChange={(ev) => update(e.id, { include: ev.target.checked })}
              />
              <span>
                <span className="pick-name">{e.name}</span>
                {e.evidence && (
                  <span className="pick-evidence" style={{ display: "block" }}>
                    {MODULE_LABEL[e.module] ?? e.module}에서 찾음: “{e.evidence}”
                  </span>
                )}
              </span>
            </label>
            {c.include && (
              <div className="options" role="radiogroup" aria-label={`${e.name} 지점`}>
                {options.map((p) => (
                  <label key={p.kakao_place_id} className="option">
                    <input
                      type="radio"
                      name={`pick-${e.id}`}
                      checked={c.pickedId === p.kakao_place_id}
                      onChange={() => update(e.id, { pickedId: p.kakao_place_id })}
                    />
                    <span>
                      {p.name}
                      <small>
                        {p.address}
                        {p.category ? ` · ${p.category}` : ""}
                      </small>
                    </span>
                  </label>
                ))}
                <ManualSearch
                  token={token}
                  initial={[e.areaHint, e.name].filter(Boolean).join(" ")}
                  onPick={(p) =>
                    update(e.id, {
                      extra: c.extra.some((x) => x.kakao_place_id === p.kakao_place_id) ? c.extra : [...c.extra, p],
                      pickedId: p.kakao_place_id,
                      include: true,
                    })
                  }
                />
              </div>
            )}
          </section>
        );
      })}

      {(extractions.length === 0 || noPlaces) && (
        <section className="pick">
          <div className="pick-name">캡션을 붙여넣어 다시 찾기</div>
          <p className="pick-evidence">인스타 게시물의 캡션을 길게 눌러 복사한 뒤 붙여넣어 주세요.</p>
          <textarea
            className="caption-box"
            value={caption}
            onChange={(ev) => setCaption(ev.target.value)}
            placeholder={source.caption ?? "📍 성수동 OO카페 …"}
          />
          <button className="btn" style={{ marginTop: 8, width: "100%" }} disabled={reprocessing || !caption.trim()} onClick={reprocess}>
            {reprocessing ? "찾는 중…" : "이 캡션으로 다시 찾기"}
          </button>
          {noPlaces && (
            <div style={{ marginTop: 14 }}>
              <div className="pick-evidence" style={{ marginBottom: 6 }}>
                또는 장소를 직접 검색하기
              </div>
              <DirectAdd token={token} sourceId={source.id} who={who} onDone={() => setDone(1)} />
            </div>
          )}
        </section>
      )}

      {error && <p className="error">{error}</p>}

      {extractions.length > 0 && (
        <div className="savebar">
          <button className="btn primary" disabled={saving} onClick={save}>
            {saving ? "저장 중…" : count > 0 ? `${count}곳 지도에 저장` : "아무것도 저장하지 않기"}
          </button>
        </div>
      )}
    </main>
  );
}

function ManualSearch({ token, initial, onPick }: { token: string; initial: string; onPick: (p: KakaoPlace) => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(initial);
  const [results, setResults] = useState<KakaoPlace[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const body = await requestJson<{ places: KakaoPlace[] }>(`/api/search?q=${encodeURIComponent(q)}`, { headers: { "x-board-token": token } });
      setResults(body.places ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "검색하지 못했어요."); }
    finally { setBusy(false); }
  }

  if (!open) {
    return (
      <button className="btn" style={{ fontSize: 14, padding: 9 }} onClick={() => setOpen(true)}>
        여기 없어요, 직접 검색
      </button>
    );
  }
  return (
    <div>
      <div className="search-row">
        <input
          className="field"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          aria-label="장소 검색어"
        />
        <button className="btn" style={{ flex: "none", padding: "9px 14px" }} onClick={run} disabled={busy}>
          검색
        </button>
      </div>
      {results && results.length === 0 && <p className="pick-evidence">검색 결과가 없어요.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {results?.map((p) => (
        <button
          key={p.kakao_place_id}
          className="option"
          style={{ width: "100%", marginTop: 6, background: "var(--paper)", textAlign: "left" }}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try { await onPick(p); setOpen(false); }
            catch (e) { setError(e instanceof Error ? e.message : "저장하지 못했어요."); }
            finally { setBusy(false); }
          }}
        >
          <span>
            {p.name}
            <small>{p.address}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

/** 추출 결과가 아예 없을 때: 검색해서 바로 저장 */
function DirectAdd({ token, sourceId, who, onDone }: { token: string; sourceId: string; who: string; onDone: () => void }) {
  return (
    <ManualSearch
      token={token}
      initial=""
      onPick={async (p) => {
        await requestJson(`/api/sources/${sourceId}/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-board-token": token },
          body: JSON.stringify({ who, selections: [], direct: p }),
        });
        onDone();
      }}
    />
  );
}
