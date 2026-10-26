import { MapEntry } from "@/components/BoardProvider";
import { legacyRedirect, requirePageBoard } from "@/lib/access";
import { syncAccess } from "@/lib/sync-server";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams: query }: { searchParams: Promise<{ t?: string; place?: string; saved?: string; view?: string; section?: string; collection?: string; organize?: string }> }) {
  const searchParams = await query;
  let next = searchParams.place ? `/?place=${encodeURIComponent(searchParams.place)}` : searchParams.saved ? `/?saved=${encodeURIComponent(searchParams.saved)}` : searchParams.view === "list" ? "/?view=list" : "/";
  const destination = new URL(next, "http://localhost");
  if (searchParams.view === "list") destination.searchParams.set("view", "list");
  if (searchParams.section === "collections") destination.searchParams.set("section", "collections");
  for (const key of ["collection", "organize"] as const) if (searchParams[key] && /^[0-9a-f-]{36}$/i.test(searchParams[key]!)) destination.searchParams.set(key, searchParams[key]!);
  next = destination.pathname + destination.search;
  legacyRedirect(searchParams.t, next);
  const board = await requirePageBoard(next);
  return <MapEntry access={syncAccess(board)} />;
}
