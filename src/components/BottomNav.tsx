"use client";
import Link from "next/link";
import Icon from "./Icon";
export default function BottomNav({ hidden, current }: { hidden: boolean; current: "map" | "search" | "list" }) {
  return <nav className="bottom-nav" aria-label="주요 화면" hidden={hidden}>
    {([{ id: "map", href: "/", label: "지도" }, { id: "list", href: "/?view=list", label: "리스트" }] as const).map((item) =>
      <Link key={item.id} href={item.href} scroll={false} aria-label={item.label} aria-current={current === item.id ? "page" : undefined} onClick={() => (document.activeElement as HTMLElement | null)?.blur()}><Icon name={item.id} width="23" /></Link>)}
  </nav>;
}
