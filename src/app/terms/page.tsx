import Link from "next/link";
import Icon from "@/components/Icon";
import { EFFECTIVE_DATE, TERMS, TERMS_ORDER } from "@/lib/terms";
import styles from "@/components/Terms.module.css";
export const dynamic = "force-static";
export const metadata = { title: "약관 및 정책 · 데이트맵" };

/** 설정 → 약관 보기: 약관·정책을 한곳에 모아 보여줍니다. 로그인하지 않아도 열립니다. */
export default function TermsIndexPage() {
  // 약관 및 정책(시안 design-lab/settings 11번): 제목 + › 만, 시행일은 아래 한 줄.
  return <main className={`form-page settings-page ${styles.page}`}>
    <header className="page-header"><Link href="/settings" className="icon-btn" aria-label="설정으로"><Icon name="back" /></Link><h1>약관 및 정책</h1><span className="header-spacer" /></header>
    <section className="set-group" aria-label="약관·정책 목록">
      {TERMS_ORDER.map((k) => <Link key={k} className="set-row" href={`/terms/${k}`}><span className="set-title">{TERMS[k].title}{!TERMS[k].required && <small>선택</small>}</span><Icon name="chevron" width="18" className="set-chevron" /></Link>)}
    </section>
    <p className="set-hint">시행일 {EFFECTIVE_DATE}</p>
  </main>;
}
