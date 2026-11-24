import { randomBytes, createHash } from "node:crypto";
/** 세션·초대 토큰: 원문은 쿠키·링크에만 두고 DB에는 해시만 저장합니다. */
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("hex");
