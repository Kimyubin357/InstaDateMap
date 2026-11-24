import { notFound } from "next/navigation";
import Link from "next/link";
import Icon from "@/components/Icon";
import TermsDocument from "@/components/TermsDocument";
import { isTermsKey, TERMS, TERMS_ORDER } from "@/lib/terms";
import styles from "@/components/Terms.module.css";
export const dynamic = "force-static";
export function generateStaticParams() { return TERMS_ORDER.map((doc) => ({ doc })); }

/** 로그인하지 않아도 볼 수 있는 약관·정책 페이지 */
export default async function TermsPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  if (!isTermsKey(doc)) notFound();
  return <main className={`form-page ${styles.page}`}>
    <header className="page-header"><Link href="/" className="icon-btn" aria-label="데이트맵으로"><Icon name="back" /></Link><h1 id="terms-title">{TERMS[doc].title}</h1><span className="header-spacer" /></header>
    <nav className={styles.tabs} aria-label="약관·정책">{TERMS_ORDER.map((k) => <Link key={k} href={`/terms/${k}`} aria-current={k === doc ? "page" : undefined}>{TERMS[k].title}</Link>)}</nav>
    <TermsDocument doc={doc} headingId="terms-title" />
  </main>;
}
