import { requirePageBoard } from "@/lib/access";
import SettingsForm from "./SettingsForm";
export const dynamic = "force-dynamic";
export default async function SettingsPage() { const board = await requirePageBoard("/settings"); return <SettingsForm who={board.who} names={board.memberNames} />; }
