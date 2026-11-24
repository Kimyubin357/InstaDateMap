"use client";
import ProfileEditor from "@/components/ProfileEditor";
import type { Profile } from "@/lib/profile";
import styles from "@/app/login/Login.module.css";
import welcome from "./Welcome.module.css";

/** 가입 직후: 카카오·구글에서 가져온 이름·사진을 확인하고 바꿀 수 있습니다. */
export default function WelcomeScreen({ profile, next }: { profile: Profile; next: string }) {
  return <main className={`${styles.page} ${welcome.page}`}>
    <section className={`${styles.hero} ${welcome.hero}`}>
      <h1 className={styles.title}>어떻게 불러 드릴까요?</h1>
      <p className={styles.subtitle}>{profile.provider === "google" ? "구글" : "카카오"} 프로필을 가져왔어요. 이름과 사진은 나중에 설정에서도 바꿀 수 있어요.</p>
    </section>
    <section className={welcome.form}>
      <ProfileEditor initial={profile} submitLabel="이 이름으로 시작하기" busyLabel="시작하는 중…" onSaved={() => { window.location.assign(next); }} />
    </section>
  </main>;
}
