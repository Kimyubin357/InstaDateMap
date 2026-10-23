"use client";
import { analysisMessage } from "@/lib/analysis-issue";

import { workId } from "@/lib/work-id";
import { useSourceSession } from "@/components/useSourceSession";
import DismissSource from "@/components/DismissSource";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { KakaoPlace } from "@/lib/types";
import { requestJson } from "@/lib/client-request";
import { CHECKING_SAVE, VerifiedWrite } from "@/lib/verified-write";
import { verifyConfirmation, verifySharedLink, type ConfirmSaved } from "@/lib/save-recovery";
import ManualPlaceSearch from "@/components/ManualPlaceSearch";
import InlineManualSearch from "@/components/InlineManualSearch";
import PageHeader from "@/components/PageHeader";
import ClientReady from "@/components/ClientReady";
import LinkRecovery from "@/components/LinkRecovery";
import type { ShareResult } from "@/lib/share-stream";
import { savedMapHref, shareDestination } from "@/lib/share-navigation";
import { useBoardSync } from "@/components/BoardProvider";

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
  queries?: Record<string, string>;
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
  source: { id: string; url: string; status: string; caption: string | null; version: string; recoveryReason?: string | null };
  extractions: ExtractionView[];
}) {
  const router = useRouter();
  const session = useSourceSession(source.id, source.version);
  const { store } = useBoardSync();
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
  const [confirmationWrite] = useState(() => new VerifiedWrite<ConfirmSaved>());
  const [reprocessWrite] = useState(() => new VerifiedWrite<ShareResult>());
  const pending = confirmationWrite.pending || reprocessWrite.pending;

  const headers = { "Content-Type": "application/json" };
  function returnToMap(href: string) { setLeaving(true); router.replace(href); }

  const count = useMemo(
    () => Object.values(choices).filter((c) => c.include && c.pickedId).length,
    [choices],
  );

  const update = (id: string, patch: Partial<Choice>) =>
    setChoices((cur) => ({ ...cur, [id]: { ...cur[id], ...patch } }));

  async function save() {
    if ((!session.ready && !confirmationWrite.pending) || saving || reprocessing || leaving || reprocessWrite.pending) return;
    setSaving(true);
    setError(null);
    setNotice(confirmationWrite.pending ? CHECKING_SAVE : "");
    const selections = extractions.map((e) => {
      const c = choices[e.id];
      const all = [...e.candidates, ...c.extra];
      const place = all.find((p) => p.kakao_place_id === c.pickedId) ?? null;
      return { extraction_id: e.id, include: c.include && !!place, place, place_id: place?.kakao_place_id ?? null, query: c.pickedId ? c.queries?.[c.pickedId] : undefined };
    });
    try {
      const body = await confirmationWrite.run(() => requestJson<ConfirmSaved>(`/api/sources/${source.id}/confirm`, {
        method: "POST",
        headers,
        body: JSON.stringify({ selections: selections.map(({ place, ...selection }) => selection), version: source.version, work_id: workId() }),
      }), () => verifyConfirmation(source.id, selections), () => setNotice(CHECKING_SAVE));
      store.acceptSavedPlace(body.saved_place);
      returnToMap(body.saved ? savedMapHref(body.place_url) : "/?saved=0");
    } catch (e) { setError(e instanceof Error ? e.message : "저장하지 못했어요."); }
    finally { setSaving(false); setNotice(""); }
  }

  async function reprocess(images = shots) {
    if ((!session.ready && !reprocessWrite.pending) || saving || reprocessing || leaving || confirmationWrite.pending) return;
    setReprocessing(true);
    setError(null);
    setNotice(reprocessWrite.pending ? CHECKING_SAVE : "");
    let retryAfter = 0;
    try {
      const body = await reprocessWrite.run(() => { retryAfter = Date.now() + 65000; return requestJson<ShareResult>("/api/share", {
        method: "POST",
        headers,
        body: JSON.stringify({ url: source.url, caption, images, retry: true, work_id: workId() }),
      }); }, () => verifySharedLink(source.url, retryAfter), () => setNotice(CHECKING_SAVE));
      if (body.status === "saved" || body.status === "duplicate") {
        store.acceptSavedPlace(body.saved_place);
        returnToMap(shareDestination(body)!);
      } else {
        setNotice(body.message);
        router.refresh();
      }
    } catch (e) { setNotice(""); setError(e instanceof Error ? e.message : "다시 찾지 못했어요."); }
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

      {analysisMessage(source.recoveryReason) && <p className="notice" role="status">{analysisMessage(source.recoveryReason)}</p>}
      {source.recoveryReason === "interrupted" && <p className="notice">장소를 끝까지 확인하지 못했어요. 다시 시도하거나 이 링크를 제외할 수 있어요.</p>}
      {!session.ready && <p className="notice" role="status">{session.error || "링크 상태를 확인하고 있어요…"} {session.error && <button className="text-btn" onClick={() => router.refresh()}>최신 후보 불러오기</button>}</p>}
      <fieldset disabled={!session.ready || saving || reprocessing || pending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} aria-label="저장할 장소 선택">
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
                <InlineManualSearch
                  initial={[e.areaHint, e.name].filter(Boolean).join(" ")}
                  onPick={(p, query) =>
                    update(e.id, {
                      extra: c.extra.some((x) => x.kakao_place_id === p.kakao_place_id) ? c.extra : [...c.extra, p],
                      pickedId: p.kakao_place_id,
                      queries: { ...c.queries, [p.kakao_place_id]: query },
                      include: true,
                    })
                  }
                />
              </div>
            )}
          </section>
        );
      })}
      </fieldset>

      {extractions.length > 0 && (
        <div className="confirm-save">
          <button className="btn primary" disabled={(!session.ready && !confirmationWrite.pending) || saving || reprocessing || reprocessWrite.pending} onClick={save}>
            {saving ? "저장 확인 중…" : confirmationWrite.pending ? "저장 확인·재시도" : count > 0 ? `${count}곳 지도에 저장` : "아무것도 저장하지 않기"}
          </button>
        </div>
      )}
      {noPlaces && session.ready && !pending && <LinkRecovery caption={caption} onCaption={setCaption} busy={saving || reprocessing} shotCount={shots.length} onRetry={() => reprocess()} onCaptionSubmit={() => reprocess()} onScreenshots={async (images) => { setShots(images); await reprocess(images); }} onSearch={() => setManual(true)} />}
      {reprocessWrite.pending && <button className="btn" disabled={reprocessing || saving} onClick={() => reprocess()}>처리 결과 확인·재시도</button>}
      {reprocessing && <p className="hint" role="status">보태주신 정보로 장소를 다시 찾고 있어요…</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      {manual && noPlaces && !pending && <section className="manual-recovery"><h3>장소 이름으로 직접 찾기</h3><DirectAdd sourceId={source.id} version={source.version} ready={session.ready} onDone={(href) => returnToMap(savedMapHref(href))} /></section>}

      <DismissSource id={source.id} version={source.version} disabled={saving || reprocessing || pending || !session.ready} onDone={() => { void store.refresh(); returnToMap("/"); }} />
      {error && <p className="error">{error}</p>}

      </>}
    </ClientReady></main>
  );
}

/** 추출 결과가 아예 없을 때: 검색해서 바로 저장 */
function DirectAdd({ sourceId, version, ready, onDone }: { sourceId: string; version: string; ready: boolean; onDone: (href: string) => void }) {
  const { store } = useBoardSync();
  return <ManualPlaceSearch sourceId={sourceId} version={version} sourceReady={ready} onSaved={(result) => { store.acceptSavedPlace(result.saved_place); onDone(result.place_url || "/"); }} />;
}
