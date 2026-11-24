/** 프로필: 이름은 모든 폴더에서 같은 이름으로 보이고, 사진은 카카오·구글 사진·직접 올린 사진·없음 중 하나입니다. */
export interface Profile { name: string; avatar: string | null; name_confirmed: boolean; provider: "kakao" | "google" | null; provider_name: string | null; provider_avatar: string | null }
export type AvatarMode = "keep" | "provider" | "custom" | "none";
export const PROVIDER_LABEL = { kakao: "카카오", google: "구글" } as const;
export const MAX_AVATAR_LENGTH = 200000;
export const isAvatarData = (v: unknown): v is string => typeof v === "string" && v.length <= MAX_AVATAR_LENGTH && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v);
export function profileInput(body: unknown): { name: string; mode: AvatarMode; avatar: string | null } | string {
  const b = body as { name?: unknown; avatar_mode?: unknown; avatar?: unknown } | null;
  const name = typeof b?.name === "string" ? b.name.replace(/\s+/g, " ").trim() : "";
  if (name.length < 1 || name.length > 20) return "이름을 1~20자로 입력해 주세요.";
  const mode = (["keep", "provider", "custom", "none"] as const).find((m) => m === b?.avatar_mode) ?? "keep";
  if (mode === "custom" && !isAvatarData(b?.avatar)) return "사진을 다시 골라 주세요. 너무 크면 다른 사진을 골라 주세요.";
  return { name, mode, avatar: mode === "custom" ? b!.avatar as string : null };
}
