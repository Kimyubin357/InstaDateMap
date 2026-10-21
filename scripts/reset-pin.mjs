import { createRequire } from "node:module";
import { randomBytes, scrypt } from "node:crypto";
const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(process.cwd());
const { createClient } = require("@supabase/supabase-js");

function hiddenPin(prompt) {
  if (!process.stdin.isTTY) throw new Error("PIN을 숨겨 입력할 수 있는 터미널에서 실행해 주세요.");
  process.stdout.write(prompt); process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let pin = "";
    const done = () => { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off("data", input); process.stdout.write("\n"); };
    const input = (chunk) => {
      for (const char of chunk) {
        if (char === "\u0003") { done(); reject(new Error("취소했어요.")); return; }
        if (char === "\r" || char === "\n") { done(); if (/^\d{6}$/.test(pin)) resolve(pin); else reject(new Error("숫자 6자리를 입력해 주세요.")); return; }
        if (char === "\u007f" || char === "\b") { pin = pin.slice(0, -1); continue; }
        if (/\d/.test(char) && pin.length < 6) pin += char;
      }
    };
    process.stdin.on("data", input);
  });
}
try {
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  let query = db.from("boards").select("id, member_names");
  const boardId = process.argv.find((a) => a.startsWith("--board="))?.slice(8) || process.env.APP_BOARD_ID;
  if (boardId) query = query.eq("id", boardId);
  const { data: boards, error } = await query.limit(2);
  if (error || boards?.length !== 1) throw new Error("보드 하나를 APP_BOARD_ID 또는 --board=보드ID로 지정해 주세요.");
  if (boards[0].member_names.length !== 2) throw new Error("처음 받은 지도 주소로 최초 설정을 먼저 완료해 주세요.");
  const pin = await hiddenPin("새 여섯 자리 PIN (입력 내용은 표시되지 않음): ");
  if (pin !== await hiddenPin("새 PIN 한 번 더: ")) throw new Error("두 PIN이 서로 달라요.");
  const salt = randomBytes(16).toString("hex");
  const hash = await new Promise((resolve, reject) => scrypt(pin, salt, 32, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (e, key) => e ? reject(e) : resolve(key.toString("hex"))));
  const { error: resetError } = await db.rpc("dm_reset_pin", { p_board: boards[0].id, p_pin_hash: `scrypt$${salt}$${hash}` });
  if (resetError) throw new Error("PIN 초기화에 실패했어요. 데이터베이스 연결과 마이그레이션을 확인해 주세요.");
  console.log("PIN을 바꿨고 모든 기기를 잠갔어요. 새 PIN으로 다시 열어 주세요.");
} catch (e) { console.error(e instanceof Error ? e.message : "PIN을 초기화하지 못했어요."); process.exitCode = 1; }
