"use client";
import { useEffect, useState } from "react";
import Modal from "./Modal";
import Icon from "./Icon";
import ShellLink from "./ShellLink";
import { friendlyMessage, requestJson } from "@/lib/client-request";
import type { FolderSummary, FoldersResponse } from "@/lib/folders";
import type { CopyResult } from "@/app/api/places/copy/route";
import styles from "./FolderTransferDialog.module.css";

/**
 * 고른 장소를 다른 폴더(방)에 담습니다(복사). 장소 상세와 리스트의 여러 개 선택에서 함께 씁니다.
 * 옮기기 기능은 없습니다(사용자 결정 2026-11-25): 옮기려면 담은 뒤 이 폴더에서 지웁니다.
 * 담을 폴더에 같은 가게가 있으면 그 장소가 그대로 유지되고(원본 링크·상태는 그쪽 것), 메모만 합쳐집니다.
 */
export default function FolderTransferDialog({ ids, onClose, onDone }: {
  ids: string[]; onClose: () => void; onDone: (result: CopyResult) => void;
}) {
  const [folders, setFolders] = useState<FolderSummary[] | null>(null);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = () => {
    setError(""); setFolders(null);
    requestJson<FoldersResponse>("/api/folders", { cache: "no-store", notifyBoardChange: false })
      .then((data) => { const others = data.folders.filter((f) => f.id !== data.current); setFolders(others); if (others.length === 1) setTarget(others[0].id); })
      .catch((e) => setError(friendlyMessage(e, "폴더 목록을 불러오지 못했어요. 다시 시도해 주세요.")));
  };
  useEffect(load, []);
  async function send() {
    if (!target || busy) return;
    setBusy(true); setError("");
    try { onDone(await requestJson<CopyResult>("/api/places/copy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: target, ids }) })); }
    catch (e) { setError(friendlyMessage(e, "장소를 담지 못했어요. 다시 시도해 주세요.")); setBusy(false); }
  }
  const count = ids.length > 1 ? `${ids.length}곳` : "";
  const close = <button className="icon-btn sheet-close-btn" aria-label="폴더 고르기 닫기" disabled={busy} onClick={onClose}><Icon name="close" width={18} /></button>;
  return <Modal title="다른 폴더에 담기" variant="compact" className={styles.modal} headerActions={close} onClose={() => { if (!busy) onClose(); }}
    footer={folders?.length ? <div className="actions">
      <button className="btn primary" disabled={!target || busy} onClick={() => void send()}>{busy ? "담는 중…" : `${count} 담기`.trim()}</button>
    </div> : undefined}>
    {!folders && !error && <p className={styles.lead} role="status">폴더 목록을 불러오고 있어요…</p>}
    {folders && !folders.length && <div className={styles.empty}><p>보낼 수 있는 다른 폴더가 없어요.</p><ShellLink className="btn" href="/folders">새 폴더 만들기</ShellLink></div>}
    {folders && folders.length > 0 && <>
      <p className={styles.lead}>이 폴더에도 그대로 남아요. 같은 가게가 이미 있으면 그쪽 장소를 두고 메모만 합쳐요.</p>
      <div role="radiogroup" aria-label="보낼 폴더">
        {folders.map((f) => <button key={f.id} type="button" role="radio" aria-checked={target === f.id} className={styles.row} disabled={busy} onClick={() => setTarget(f.id)}>
          <span className={styles.check}><Icon name={target === f.id ? "check" : f.icon} width={20} /></span>
          <span><strong>{f.name}</strong><small>{f.place_count}곳 · {f.member_count > 1 ? `${f.member_count}명` : "혼자"}</small></span>
        </button>)}
      </div>
    </>}
    {error && <div className={styles.error} role="alert"><p>{error}</p>{!folders && <button className="text-btn" onClick={load}>다시 불러오기</button>}</div>}
  </Modal>;
}
