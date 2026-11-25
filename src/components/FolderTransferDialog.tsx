"use client";
import { useEffect, useState } from "react";
import Modal from "./Modal";
import Icon from "./Icon";
import ShellLink from "./ShellLink";
import { RoomBand } from "./Palette";
import { friendlyMessage, requestJson } from "@/lib/client-request";
import type { FolderSummary, FoldersResponse } from "@/lib/folders";
import type { MoveResult } from "@/app/api/places/move/route";
import styles from "./FolderTransferDialog.module.css";

/**
 * 고른 장소를 다른 방으로 옮깁니다(지금 방에서는 빠짐, 2026-11-25 사용자 결정). 방은 색 띠 + 이름으로만 보여 줍니다(아이콘 없음).
 * 장소 상세·방금 담은 시트·리스트의 여러 개 선택에서 함께 씁니다. 처음 등록한 사람만 옮길 수 있습니다(삭제와 같은 규칙).
 * 옮길 방에 같은 가게가 있으면 그 장소가 그대로 유지되고(원본 링크·상태는 그쪽 것), 메모만 합쳐집니다.
 */
export default function FolderTransferDialog({ ids, from, onClose, onDone }: {
  ids: string[]; onClose: () => void; onDone: (result: MoveResult) => void;
  /** 장소가 있는 방(전체 보기에서 다른 방의 장소를 옮길 때). 없으면 이 기기가 연 방. */
  from?: string;
}) {
  const [folders, setFolders] = useState<FolderSummary[] | null>(null);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = () => {
    setError(""); setFolders(null);
    requestJson<FoldersResponse>("/api/folders", { cache: "no-store", notifyBoardChange: false })
      .then((data) => { const others = data.folders.filter((f) => f.id !== (from ?? data.current)); setFolders(others); if (others.length === 1) setTarget(others[0].id); })
      .catch((e) => setError(friendlyMessage(e, "방 목록을 불러오지 못했어요. 다시 시도해 주세요.")));
  };
  useEffect(load, []);
  async function send() {
    if (!target || busy) return;
    setBusy(true); setError("");
    try { onDone(await requestJson<MoveResult>("/api/places/move", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: target, ids, ...(from ? { from } : {}) }) })); }
    catch (e) { setError(friendlyMessage(e, "장소를 옮기지 못했어요. 다시 시도해 주세요.")); setBusy(false); }
  }
  const count = ids.length > 1 ? `${ids.length}곳` : "";
  const close = <button className="icon-btn sheet-close-btn" aria-label="방 고르기 닫기" disabled={busy} onClick={onClose}><Icon name="close" width={18} /></button>;
  return <Modal title="다른 방으로 옮기기" variant="compact" className={styles.modal} headerActions={close} onClose={() => { if (!busy) onClose(); }}
    footer={folders?.length ? <div className="actions">
      <button className="btn primary" disabled={!target || busy} onClick={() => void send()}>{busy ? "옮기는 중…" : `${count} 옮기기`.trim()}</button>
    </div> : undefined}>
    {!folders && !error && <p className={styles.lead} role="status">방 목록을 불러오고 있어요…</p>}
    {folders && !folders.length && <div className={styles.empty}><p>옮길 수 있는 다른 방이 없어요.</p><ShellLink className="btn" href="/folders">새 방 만들기</ShellLink></div>}
    {folders && folders.length > 0 && <>
      <p className={styles.lead}>이 방에서는 빠져요. 옮길 방에 같은 가게가 있으면 그쪽 장소에 메모만 합쳐요.</p>
      <div role="radiogroup" aria-label="옮길 방">
        {folders.map((f) => <button key={f.id} type="button" role="radio" aria-checked={target === f.id} className={styles.row} disabled={busy} onClick={() => setTarget(f.id)}>
          <RoomBand color={f.color} className={styles.band} />
          <span className={styles.copy}><strong>{f.name}</strong><small>{f.place_count}곳 · {f.member_count > 1 ? `${f.member_count}명` : "혼자"}</small></span>
          <span className={styles.check} aria-hidden="true">{target === f.id && <Icon name="check" width={16} />}</span>
        </button>)}
      </div>
    </>}
    {error && <div className={styles.error} role="alert"><p>{error}</p>{!folders && <button className="text-btn" onClick={load}>다시 불러오기</button>}</div>}
  </Modal>;
}
