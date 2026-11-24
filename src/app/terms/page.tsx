import Link from "next/link";
import Icon from "@/components/Icon";
import { TERMS, TERMS_ORDER } from "@/lib/terms";
import styles from "@/components/Terms.module.css";
export const dynamic = "force-static";
export const metadata = { title: "약관 보기 · 데이트맵" };

/** 설정 → 약관 보기: 약관·정책을 한곳에 모아 보여줍니다. 로그인하지 않아도 열립니다. */
export default function TermsIndexPage() {
  return <main className={`form-page settings-page ${styles.page}`}>
    <header className="page-header"><Link href="/settings" className="icon-btn" aria-label="설정으로"><Icon name="back" /></Link><h1>약관 보기</h1><span className="header-spacer" /></header>
    <section className="settings-group" aria-label="약관·정책 목록">
      {TERMS_ORDER.map((k) => <Link key={k} className="settings-row settings-link" href={`/terms/${k}`}><Icon name="list" /><span className="settings-copy"><span>{TERMS[k].title} <span className={TERMS[k].required ? styles.tag : `${styles.tag} ${styles.optional}`}>({TERMS[k].required ? "필수" : "선택"})</span></span></span><Icon name="chevron" width="18" /></Link>)}
    </section>
  </main>;
}
