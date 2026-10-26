"use client";
import ShellLink from "./ShellLink";
import Icon from "./Icon";
export default function BottomNav({ hidden, current, mapHref = "/", listHref = "/?view=list" }: { hidden: boolean; current: "map" | "search" | "list"; mapHref?: string; listHref?: string }) {
  return <nav className="bottom-nav" aria-label="주요 화면" hidden={hidden}>
    {([{ id: "map", href: mapHref, label: "지도" }, { id: "list", href: listHref, label: "리스트" }] as const).map((item) =>
      <ShellLink key={item.id} href={item.href} scroll={false} aria-label={item.label} aria-current={current === item.id ? "page" : undefined}><Icon name={item.id} width="23" /></ShellLink>)}
  </nav>;
}
