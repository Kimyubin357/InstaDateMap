"use client";
import type { PendingSource } from "@/lib/sync-types";
import { pendingReason, pendingTitle, pendingWhen, type PendingNext } from "@/lib/pending-source";
import DismissSource from "./DismissSource";
import ShellLink from "./ShellLink";
import Icon from "./Icon";
import styles from "./Registration.module.css";

/**
 * 확인 대기(시안 13번). 링크마다 왼쪽에 이름(없으면 링크 끝)·보낸 사람·시간·방·남은 이유,
 * 오른쪽에 다음 행동 하나(알약)와 그 아래 조용한 글자 버튼을 한 묶음으로 세로 가운데에 둡니다.
 * '저장할 곳 없음'·'이 링크 정리'는 반드시 확인창(DismissSource)을 거칩니다.
 */
export default function PendingLinks({ sources, room, onChanged }: { sources: PendingSource[]; room?: string; onChanged: () => void }) {
  return <>
    <p className={styles.pendLead}>저장이 끝나지 않은 링크 {sources.length}개예요.</p>
    <div className={styles.pendList}>{sources.map((source) => {
      const reason = pendingReason(source);
      const names = source.place_names ?? [];
      const control = (next: { kind: PendingNext; label: string }, quiet: boolean) => {
        const className = quiet ? styles.quiet : `${styles.pill}${next.kind === "dismiss" ? ` ${styles.pillGhost}` : ""}`;
        const label = quiet ? next.label : <span>{next.kind === "retry" && <Icon name="refresh" width={15} />}{next.label}</span>;
        if (next.kind === "confirm") return <ShellLink className={className} href={`/confirm/${source.id}`}>{label}</ShellLink>;
        if (next.kind === "retry") return <ShellLink className={className} href={`/add?url=${encodeURIComponent(source.url)}&retry=1`}>{label}</ShellLink>;
        return source.analysis_version ? <DismissSource id={source.id} version={source.analysis_version} names={names} className={className} onDone={onChanged}>{label}</DismissSource> : null;
      };
      return <div key={source.id} className={styles.pend}>
        <div>
          <strong>{pendingTitle(source)}</strong>
          <span className={styles.pendMeta}>{[source.shared_by, pendingWhen(source.shared_at)].filter(Boolean).join(" · ")}{room && <span className={styles.roomTag}>{room}</span>}</span>
          <span className={styles.pendWhy}><Icon name={reason.icon} width={16} />{reason.text}</span>
        </div>
        <div className={styles.pendSide}>{control(reason.action, false)}{control(reason.quiet, true)}</div>
      </div>;
    })}</div>
  </>;
}
