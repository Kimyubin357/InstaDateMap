"use client";
import Link from "next/link";
import type { ComponentProps } from "react";
import { useBoardSync } from "./BoardProvider";
import { navigateShell } from "@/lib/shell-navigation";
export default function ShellLink({ href, onClick, replace, ...props }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const { store } = useBoardSync();
  return <Link {...props} href={href} replace={replace} prefetch={false} onClick={(event) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || props.target === "_blank") return;
    const access = store.getSnapshot().access;
    if (!access || store.isSuspended() || new Date(access.expiresAt).getTime() <= Date.now()) return;
    if (navigateShell(href, replace)) { event.preventDefault(); (document.activeElement as HTMLElement | null)?.blur(); }
  }} />;
}
