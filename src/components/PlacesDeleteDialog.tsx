"use client";
import { useEffect, useRef, useState } from "react";
import { friendlyMessage, RequestError } from "@/lib/client-request";
import { PlaceDeletionBatch } from "@/lib/place-deletion";
import type { PlaceView } from "@/lib/place-view";
import ActionDialog from "./ActionDialog";
import { useBoardSync } from "./BoardProvider";

export default function PlacesDeleteDialog({ places, onClose, onDeleted }: {
  places: PlaceView[]; onClose: (deleted: string[]) => void; onDeleted: () => void;
}) {
  const { store, notify, lock } = useBoardSync();
  // Freeze the confirmed targets, including during live sync or a partial retry.
  const [targets] = useState(() => places);
  const [batch] = useState(() => new PlaceDeletionBatch(targets.map((place) => place.id)));
  const flight = useRef(false);
  const [busy, setBusy] = useState(false), [pending, setPending] = useState(false);
  const [completed, setCompleted] = useState(0), [error, setError] = useState("");
  const remaining = targets.length - completed;
  useEffect(() => {
    if (!busy && !pending) return;
    const prevent = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [busy, pending]);
  function dismiss() {
    if (flight.current) return;
    if (batch.pending) void store.refresh();
    onClose(batch.completedIds);
  }
  async function remove() {
    if (flight.current) return;
    flight.current = true; setBusy(true); setError("");
    try {
      await batch.run((id) => { store.removePlace(id); setCompleted(batch.completedIds.length); },
        () => setError("응답이 늦어지고 있어요. 삭제 여부를 확인할게요."));
      notify(`${targets.length}곳을 삭제한 장소로 옮겼어요.`);
      onDeleted();
    } catch (error) {
      if (error instanceof RequestError && [401, 409].includes(error.status)) { void lock(); return; }
      setError(friendlyMessage(error, "삭제하지 못했어요. 다시 시도해 주세요."));
    } finally { flight.current = false; setBusy(false); setPending(batch.pending); }
  }
  return <ActionDialog title={`장소 ${targets.length}곳을 삭제할까요?`} destructive cancelLabel={pending || completed ? "닫기" : "취소"}
    confirmLabel={pending ? "삭제 확인·재시도" : completed ? `남은 ${remaining}곳 삭제` : `${targets.length}곳 삭제`}
    busy={busy} busyLabel={`${completed}/${targets.length}곳 삭제 중…`} onClose={dismiss} onConfirm={remove}>
    <p>{targets.slice(0, 2).map((place) => place.name).join(", ")}{targets.length > 2 ? ` 외 ${targets.length - 2}곳` : ""}</p>
    <p>두 사람의 지도와 모든 모음에서 사라져요.<br />설정의 ‘삭제한 장소’에서 복구할 수 있어요.</p>
    {completed > 0 && <p role="status">{targets.length}곳 중 {completed}곳을 삭제했어요. {remaining}곳이 남았어요.</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </ActionDialog>;
}
