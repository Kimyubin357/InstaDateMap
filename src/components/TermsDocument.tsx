import { TERMS, type TermsKey } from "@/lib/terms";
import styles from "./Terms.module.css";

/** 약관 본문. 동의 화면의 펼쳐 보기와 공개 약관 페이지가 함께 씁니다. */
export default function TermsDocument({ doc, headingId }: { doc: TermsKey; headingId?: string }) {
  const t = TERMS[doc];
  return <article className={styles.document} aria-labelledby={headingId}>
    {t.sections.map((s, i) => <section key={i}>{s.heading && <h3>{s.heading}</h3>}{s.body.map((p, i) => <p key={i}>{p}</p>)}</section>)}
  </article>;
}
