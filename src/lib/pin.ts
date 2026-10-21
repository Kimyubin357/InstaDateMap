import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
export const validPin = (pin: unknown): pin is string => typeof pin === "string" && /^\d{6}$/.test(pin);
export function pinFromDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("사귄 날짜를 선택해 주세요.");
  const value = new Date(`${date}T00:00:00Z`);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  if (!Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== date || date > today) throw new Error("오늘 이전의 올바른 날짜를 선택해 주세요.");
  return date.slice(2).replaceAll("-", "");
}
function derive(pin: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(pin, salt, 32, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (err, key) => err ? reject(err) : resolve(key)));
}
export async function hashPin(pin: string): Promise<string> {
  if (!validPin(pin)) throw new Error("PIN은 숫자 6자리로 입력해 주세요.");
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${(await derive(pin, salt)).toString("hex")}`;
}
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  if (!validPin(pin)) return false;
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !/^[0-9a-f]{32}$/.test(salt ?? "") || !/^[0-9a-f]{64}$/.test(hash ?? "")) return false;
  return timingSafeEqual(await derive(pin, salt), Buffer.from(hash, "hex"));
}
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("hex");
