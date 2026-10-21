"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { KakaoPlace } from "@/lib/types";
import { requestJson } from "@/lib/client-request";
import ManualPlaceSearch from "@/components/ManualPlaceSearch";
import PageHeader from "@/components/PageHeader";
import ClientReady from "@/components/ClientReady";
import LinkRecovery from "@/components/LinkRecovery";
import type { ShareResult } from "@/lib/share-stream";
import { savedMapHref, shareDestination } from "@/lib/share-navigation";

export interface ExtractionView {
  id: string;
  module: string;
  name: string;
  areaHint: string | null;
  evidence: string | null;
  candidates: KakaoPlace[];
  excluded?: boolean;
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
  source,
  extractions,
}: {
  source: { id: string; url: string; status: string; caption: string | null };
  extractions: ExtractionView[];
}) {
  const router = useRouter();
  const [choices, setChoices] = useState<Record<string, Choice>>(() =>
    Object.fromEntries(
      extractions.map((e) => [
        e.id,
        // 기본값: 전부 체크, 첫 번째 후보 선택. 후보가 없으면 체크 해제
        { include: !e.excluded && e.candidates.length > 0, pickedId: e.candidates[0]?.kakao_place_id ?? null, extra: [] },
      ]),
    ),
  );
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [reprocessing, setReprocessing] = useState(false);
  const [shots, setShots] = useState<string[]>([]);
  const [manual, setManual] = useState(false);
  const [notice, setNotice] = useState("");

  const headers = { "Content-Type": "application/json" };
  function returnToMap(href: string) { setLeaving(true); router.replace(href); router.refresh(); }

  const count = useMemo(
    () => Object.values(choices).filter((c) => c.include && c.pickedId).length,
    [choices],
  );

  const update = (id: string, patch: Partial<Choice>) =>
    setChoices((cur) => ({ ...cur, [id]: { ...cur[id], ...patch } }));

  async function save() {
    if (saving || reprocessing || leaving) return;
    setSaving(true);
    setError(null);
    const selections = extractions.map((e) => {
      const c = choices[e.id];
      const all = [...e.candidates, ...c.extra];
      const place = all.find((p) => p.kakao_place_id === c.pickedId) ?? null;
      return { extraction_id: e.id, include: c.include && !!place, place };
    });
    try {
      const body = await requestJson<{ saved: number; place_url?: string }>(`/api/sources/${source.id}/confirm`, {
        method: "POST",
        headers,
        body: JSON.stringify({ selections }),
      });
      returnToMap(body.saved ? savedMapHref(body.place_url) : "/?saved=0");
    } catch (e) { setError(e instanceof Error ? e.message : "저장하지 못했어요."); }
    finally { setSaving(false); }
  }

  async function reprocess(images = shots) {
    if (saving || reprocessing || leaving) return;
    setReprocessing(true);
    setError(null);
    try {
      const body = await requestJson<ShareResult>("/api/share", {
        method: "POST",
        headers,
        body: JSON.stringify({ url: source.url, caption, images, retry: true }),
      });
      if (body.status === "saved" || body.status === "duplicate") {
        returnToMap(shareDestination(body)!);
      } else {
        setNotice(body.message);
        router.refresh();
      }
    } catch (e) { setError(e instanceof Error ? e.message : "다시 찾지 못했어요."); }
    finally { setReprocessing(false); }
  }

  const noPlaces = extractions.every((e) => e.candidates.length === 0);

  return (
    <main className="confirm"><ClientReady>
      <PageHeader title="장소 확인" />
      {leaving ? <p className="notice" role="status">우리 지도를 여는 중…</p> : <>
      <h2>
        {noPlaces
          ? "장소를 알려 주세요"
          : "남길 곳을 골라 주세요"}
      </h2>
      <p className="lead">
        {noPlaces ? "캡션·스크린샷을 보태거나 장소를 직접 검색해 주세요." : "게시물에서 찾은 장소예요. 남길 곳과 지점을 선택해 주세요."}{" "}
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

      {extractions.length > 0 && (
        <div className="confirm-save">
          <button className="btn primary" disabled={saving || reprocessing} onClick={save}>
            {saving ? "저장 중…" : count > 0 ? `${count}곳 지도에 저장` : "아무것도 저장하지 않기"}
          </button>
        </div>
      )}
      {noPlaces && <LinkRecovery caption={caption} onCaption={setCaption} busy={saving || reprocessing} shotCount={shots.length} onRetry={() => reprocess()} onCaptionSubmit={() => reprocess()} onScreenshots={async (images) => { setShots(images); await reprocess(images); }} onSearch={() => setManual(true)} />}
      {reprocessing && <p className="hint" role="status">보태주신 정보로 장소를 다시 찾고 있어요…</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      {manual && noPlaces && <section className="manual-recovery"><h3>장소 이름으로 직접 찾기</h3><DirectAdd sourceId={source.id} onDone={(href) => returnToMap(savedMapHref(href))} /></section>}

      {error && <p className="error">{error}</p>}

      <a className="return-link" href="/">우리 지도로 돌아가기</a>
      </>}
    </ClientReady></main>
  );
}

function ManualSearch({ initial, onPick }: { initial: string; onPick: (p: KakaoPlace) => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(initial);
  const [results, setResults] = useState<KakaoPlace[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const body = await requestJson<{ places: KakaoPlace[] }>(`/api/search?q=${encodeURIComponent(q)}`);
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
function DirectAdd({ sourceId, onDone }: { sourceId: string; onDone: (href: string) => void }) {
  return <ManualPlaceSearch sourceId={sourceId} onSaved={(result) => onDone(result.place_url || "/")} />;
}
