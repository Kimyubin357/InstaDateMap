import { NextResponse } from "next/server";
import { accessError } from "@/lib/auth";
import { folderId, noStore, openFolder, requireAccount } from "@/lib/folders-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 이 기기에서 그 폴더를 엽니다. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireAccount(req);
    const id = folderId((await params).id);
    await openFolder(account, id);
    return NextResponse.json({ current: id }, noStore);
  } catch (e) { return accessError(e); }
}
