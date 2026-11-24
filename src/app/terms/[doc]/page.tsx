import { notFound } from "next/navigation";
import Link from "next/link";
import Icon from "@/components/Icon";
import TermsDocument from "@/components/TermsDocument";
import { isTermsKey, TERMS, TERMS_ORDER } from "@/lib/terms";
import styles from "@/components/Terms.module.css";
export const dynamic = "force-static";
export function generateStaticParams() { return TERMS_ORDER.map((doc) => ({ doc })); }

/** 약관·정책 본문. 로그인하지 않아도 열리며, 뒤로 가면 약관 목록(/terms)입니다. */
export default async function TermsPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  if (!isTermsKey(doc)) notFound();
  return <main className={`form-page ${styles.page}`}>
    <header className="page-header"><Link href="/terms" className="icon-btn" aria-label="약관 목록으로"><Icon name="back" /></Link><h1 id="terms-title">{TERMS[doc].title}</h1><span className="header-spacer" /></header>
    <TermsDocument doc={doc} headingId="terms-title" />
  </main>;
}
