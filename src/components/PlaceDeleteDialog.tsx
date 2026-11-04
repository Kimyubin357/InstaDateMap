"use client";
import { useEffect, useRef, useState } from "react";
import { friendlyMessage, RequestError } from "@/lib/client-request";
import { PlaceDeletion } from "@/lib/place-deletion";
import type { PlaceView } from "@/lib/place-view";
import ActionDialog from "./ActionDialog";
import { useBoardSync } from "./BoardProvider";

type Props = { place: PlaceView; onClose: () => void; onDeleted: (id: string) => void };

export default function PlaceDeleteDialog(props: Props) {
  return <DeletePlace key={props.place.id} {...props} />;
}

function DeletePlace({ place, onClose, onDeleted }: Props) {
  const { store, notify, lock } = useBoardSync();
  const [deletion] = useState(() => new PlaceDeletion(place.id));
  const flight = useRef(false);
  const [busy, setBusy] = useState(false), [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!busy && !pending) return;
    const prevent = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [busy, pending]);

  function dismiss() {
    if (flight.current) return;
    // A closed, unresolved confirmation must still reconcile with the server.
    if (deletion.pending) void store.refresh();
    onClose();
  }

  async function remove() {
    if (flight.current) return;
    flight.current = true; setBusy(true); setError("");
    try {
      await deletion.run(() => setError("응답이 늦어지고 있어요. 삭제 여부를 확인할게요."));
      store.removePlace(place.id);
      notify("삭제한 장소로 옮겼어요.");
      onDeleted(place.id);
    } catch (error) {
      if (error instanceof RequestError && [401, 409].includes(error.status)) { void lock(); return; }
      setError(friendlyMessage(error, "삭제하지 못했어요. 다시 시도해 주세요."));
    } finally {
      flight.current = false; setBusy(false); setPending(deletion.pending);
    }
  }

  return <ActionDialog title="이 장소를 삭제할까요?" destructive cancelLabel={pending ? "닫기" : "취소"} confirmLabel={pending ? "삭제 확인·재시도" : "삭제하기"} busy={busy} busyLabel="삭제 확인 중…" onClose={dismiss} onConfirm={remove}>
    <strong className="delete-dialog-name">{place.name}</strong>
    {place.address && <p className="delete-dialog-address">{place.address}</p>}
    <p>두 사람의 지도에서 삭제돼요.<br />설정의 ‘삭제한 장소’에서 메모와 저장 기록까지 복구할 수 있어요.</p>
    {error && <p className="error" role="alert">{error}</p>}
  </ActionDialog>;
}
