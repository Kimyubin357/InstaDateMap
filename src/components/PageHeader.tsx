"use client";
import ShellLink from "./ShellLink";
import Icon from "./Icon";
import { useBoardSync } from "./BoardProvider";
export default function PageHeader({ title, backHref }: { title: string; backHref?: string }) {
  const { homeHref } = useBoardSync();
  return <header className="page-header"><ShellLink href={backHref ?? homeHref} className="icon-btn" aria-label="이전 화면으로"><Icon name="back" /></ShellLink><h1>{title}</h1><span className="header-spacer" /></header>;
}
