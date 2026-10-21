import Link from "next/link";
import Icon from "./Icon";
export default function PageHeader({ title }: { title: string }) {
  return <header className="page-header"><Link href="/" className="icon-btn" aria-label="우리 지도로 돌아가기"><Icon name="back" /></Link><h1>{title}</h1><span className="header-spacer" /></header>;
}
