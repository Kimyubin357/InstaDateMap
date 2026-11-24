"use client";
import { useEffect, useState } from "react";
import ClientReady from "@/components/ClientReady";
import PageHeader from "@/components/PageHeader";
import ProfileEditor from "@/components/ProfileEditor";
import { useBoardSync } from "@/components/BoardProvider";
import { friendlyMessage, requestJson } from "@/lib/client-request";
import type { Profile } from "@/lib/profile";

/** 설정 → 프로필: 이름·사진 바꾸기. 이름을 바꾸면 이 기기의 입장 정보도 새 이름으로 다시 받습니다. */
export default function ProfilePanel() {
  const sync = useBoardSync();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");
  const load = () => { setError(""); requestJson<Profile>("/api/profile", { cache: "no-store", notifyBoardChange: false }).then(setProfile).catch((e) => setError(friendlyMessage(e, "프로필을 불러오지 못했어요."))); };
  useEffect(load, []);
  return <main className="form-page settings-page"><ClientReady><PageHeader title="프로필" backHref="/settings" />
    {!profile && !error && <p className="hint" role="status">프로필을 불러오고 있어요…</p>}
    {error && <section className="settings-notice"><p className="error" role="alert">{error}</p><button type="button" className="btn" onClick={load}>다시 불러오기</button></section>}
    {profile && <ProfileEditor key={`${profile.name}:${profile.avatar?.slice(-24) ?? ""}`} initial={profile} submitLabel="저장" requireChange onSaved={async (saved) => {
      const renamed = saved.name !== profile.name;
      setProfile(saved);
      if (renamed) await sync.resetAccess();
      sync.notify("프로필을 저장했어요.");
    }} />}
  </ClientReady></main>;
}
