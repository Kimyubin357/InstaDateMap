import { notFound } from "next/navigation";
import Link from "next/link";
import Icon from "@/components/Icon";
import TermsDocument from "@/components/TermsDocument";
import { EFFECTIVE_DATE, isTermsKey, TERMS, TERMS_ORDER } from "@/lib/terms";
import styles from "@/components/Terms.module.css";
export const dynamic = "force-static";
export function generateStaticParams() { return TERMS_ORDER.map((doc) => ({ doc })); }

/** 약관·정책 본문. 로그인하지 않아도 열리며, 뒤로 가면 약관 목록(/terms)입니다. */
export default async function TermsPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  if (!isTermsKey(doc)) notFound();
  return <main className={`form-page settings-page ${styles.page}`}>
    <header className="page-header"><Link href="/terms" className="icon-btn" aria-label="약관 목록으로"><Icon name="back" /></Link><h1 id="terms-title">{TERMS[doc].title}</h1><span className="header-spacer" /></header>
    {/* 약관 본문(시안 design-lab/settings 12번): 시행일 한 줄 + 조 바로가기 칩 */}
    <p className={styles.meta}>시행 {EFFECTIVE_DATE}</p>
    <nav className={styles.toc} aria-label="조 바로가기">{TERMS[doc].sections.flatMap((sec, i) => sec.heading ? [<a key={i} href={`#${doc}-${i}`}>{sec.heading.replace(/^제?\s*(\d+)\s*[조.]\s*/, "$1. ").slice(0, 16)}</a>] : [])}</nav>
    <TermsDocument doc={doc} headingId="terms-title" anchors />
  </main>;
}
