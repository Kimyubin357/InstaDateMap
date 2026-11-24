"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import pinCouple from "../../../public/illustrations/pin-couple.png";
import styles from "./Login.module.css";

type Provider = "kakao" | "google";
const LABELS: Record<Provider, { idle: string; busy: string }> = {
  kakao: { idle: "카카오로 시작하기", busy: "카카오로 이동하는 중…" },
  google: { idle: "구글로 시작하기", busy: "구글로 이동하는 중…" },
};

/** 카카오 말풍선 심볼. 카카오 로그인 버튼 가이드의 검은 심볼을 사용합니다. */
function KakaoSymbol() {
  return <svg className={styles.symbol} viewBox="0 0 24 24" aria-hidden="true"><path fill="#000" d="M12 3.2c-5.3 0-9.6 3.38-9.6 7.55 0 2.7 1.8 5.07 4.5 6.4l-.92 3.37c-.08.3.26.54.52.37l4.03-2.66c.48.05.97.08 1.47.08 5.3 0 9.6-3.38 9.6-7.56S17.3 3.2 12 3.2z" /></svg>;
}
/** 구글 G 로고. 브랜드 가이드의 네 가지 색을 그대로 사용합니다. */
function GoogleSymbol() {
  return <svg className={styles.symbol} viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>;
}

/** 카카오·구글 시작 버튼. 로그인 화면과 초대 화면이 함께 씁니다. */
export function ProviderButtons({ next, disabled = false }: { next: string; disabled?: boolean }) {
  const [busy, setBusy] = useState<Provider | null>(null);
  // 뒤로 가기로 이 화면이 다시 보이면(bfcache) 버튼을 다시 쓸 수 있게 합니다.
  useEffect(() => {
    const reset = () => setBusy(null);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);
  const locked = disabled || busy !== null;
  const button = (provider: Provider) => {
    const label = busy === provider ? LABELS[provider].busy : LABELS[provider].idle;
    const className = `${styles.provider} ${provider === "kakao" ? styles.kakao : styles.google}`;
    if (locked) return <span className={className} role="link" aria-disabled="true" aria-busy={busy === provider}>{provider === "kakao" ? <KakaoSymbol /> : <GoogleSymbol />}<span>{label}</span></span>;
    return <a className={className} href={`/api/auth/${provider}?next=${encodeURIComponent(next)}`} onClick={() => setBusy(provider)}>{provider === "kakao" ? <KakaoSymbol /> : <GoogleSymbol />}<span>{label}</span></a>;
  };
  return <>{button("kakao")}{button("google")}</>;
}

export default function LoginScreen({ next, error = "", disabled = false }: { next: string; error?: string; disabled?: boolean }) {
  return <main className={styles.page}>
    <section className={styles.hero}>
      <div className={styles.art}><Image src={pinCouple} alt="서로를 안고 있는 두 캐릭터" sizes="(max-height: 500px) 150px, 260px" priority /></div>
      <h1 className={styles.title}>데이트맵에 오신 것을<br />환영해요 :)</h1>
      <p className={styles.subtitle}>SNS에서 발견한 장소를 지도에 모아 보세요</p>
    </section>
    <section className={styles.actions} aria-label="로그인 방법">
      {error && <p className={styles.error} role="alert">{error}</p>}
      <ProviderButtons next={next} disabled={disabled} />
    </section>
  </main>;
}
