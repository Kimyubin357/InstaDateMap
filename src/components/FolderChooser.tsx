"use client";
import { useState } from "react";
import Modal from "./Modal";
import Icon from "./Icon";
import ShellLink from "./ShellLink";
import { useBoardState, useBoardSync } from "./BoardProvider";
import { friendlyMessage, requestJson } from "@/lib/client-request";
import type { FolderSummary, FoldersResponse } from "@/lib/folders";
import styles from "./FolderTransferDialog.module.css";

/**
 * 저장할 폴더(= 지금 연 폴더)를 보여 주고 바꿉니다. 바꾸면 앱 전체가 그 폴더로 바뀝니다(기본값: 마지막으로 연 폴더).
 * 장소 저장 화면에서 씁니다.
 */
export default function FolderChooser({ label = "저장할 폴더", disabled = false }: { label?: string; disabled?: boolean }) {
  const sync = useBoardSync();
  const name = useBoardState().snapshot?.board ?? "";
  const [open, setOpen] = useState(false);
  const [folders, setFolders] = useState<FoldersResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function show() {
    setOpen(true); setError(""); setFolders(null);
    requestJson<FoldersResponse>("/api/folders", { cache: "no-store", notifyBoardChange: false }).then(setFolders)
      .catch((e) => setError(friendlyMessage(e, "폴더 목록을 불러오지 못했어요. 다시 시도해 주세요.")));
  }
  async function choose(folder: FolderSummary) {
    if (busy) return;
    if (folder.id === folders?.current) { setOpen(false); return; }
    setBusy(true); setError("");
    try {
      await requestJson(`/api/folders/${folder.id}/open`, { method: "POST", notifyBoardChange: false, headers: { "Content-Type": "application/json" }, body: "{}" });
      if (await sync.resetAccess()) { setOpen(false); sync.notify(`‘${folder.name}’ 폴더에 저장해요.`, "info"); }
    } catch (e) { setError(friendlyMessage(e, "폴더를 바꾸지 못했어요. 다시 시도해 주세요.")); }
    finally { setBusy(false); }
  }
  const close = <button className="icon-btn sheet-close-btn" aria-label="폴더 고르기 닫기" disabled={busy} onClick={() => setOpen(false)}><Icon name="close" width={18} /></button>;
  return <>
    <button type="button" className="folder-chooser" disabled={disabled || busy} onClick={show} aria-haspopup="dialog">
      <span className="folder-chooser-label">{label}</span>
      <span className="folder-chooser-value"><Icon name="map" width={18} /><b>{name || "폴더"}</b></span>
      <Icon name="chevron" width={16} />
    </button>
    {open && <Modal title={label} variant="compact" className={styles.modal} headerActions={close} onClose={() => { if (!busy) setOpen(false); }}>
      {!folders && !error && <p className={styles.lead} role="status">폴더 목록을 불러오고 있어요…</p>}
      {folders && <div role="radiogroup" aria-label={label}>
        {folders.folders.map((f) => <button key={f.id} type="button" role="radio" aria-checked={f.id === folders.current} className={styles.row} disabled={busy} onClick={() => void choose(f)}>
          <span className={styles.check}><Icon name={f.id === folders.current ? "check" : f.icon} width={20} /></span>
          <span><strong>{f.name}</strong><small>{f.place_count}곳 · {f.member_count > 1 ? `${f.member_count}명` : "혼자"}</small></span>
        </button>)}
        <ShellLink className={`text-btn ${styles.create}`} href="/folders"><Icon name="plus" width={18} />새 폴더 만들기</ShellLink>
      </div>}
      {busy && <p className={styles.lead} role="status">폴더를 바꾸는 중…</p>}
      {error && <div className={styles.error} role="alert"><p>{error}</p></div>}
    </Modal>}
  </>;
}
