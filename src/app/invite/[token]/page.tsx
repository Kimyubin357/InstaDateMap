import { accountFromRequest } from "@/lib/auth";
import { pageRequest } from "@/lib/access";
import { invitePreview } from "@/lib/folders-server";
import InviteScreen from "./InviteScreen";
export const dynamic = "force-dynamic";
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const account = await accountFromRequest(await pageRequest());
  let preview;
  try { preview = await invitePreview(token, account?.userId ?? null); }
  catch { preview = null; }
  return <InviteScreen token={token} preview={preview} loggedIn={!!account} />;
}
