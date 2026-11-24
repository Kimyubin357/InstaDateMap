import Icon from "./Icon";
import styles from "./Profile.module.css";

/** 프로필 사진(카카오·구글 주소 또는 직접 올린 사진). 없으면 기존 사용자 아이콘을 씁니다. */
export default function Avatar({ src, size = 40, label }: { src?: string | null; size?: number; label?: string }) {
  return <span className={styles.avatar} style={{ width: size, height: size }} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {src ? <img src={src} alt="" referrerPolicy="no-referrer" decoding="async" /> : <Icon name="user" width={Math.round(size * .55)} />}
  </span>;
}
