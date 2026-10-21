import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { readFileSync } from "node:fs";

describe("홈 화면 앱의 이동 범위", () => {
  it("iPhone 180px와 Android 192px·512px PNG 아이콘을 실제 크기로 제공", () => {
    const dimensions = (file: string) => {
      const png = readFileSync(file);
      expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      return [png.readUInt32BE(16), png.readUInt32BE(20)];
    };
    expect(dimensions("src/app/apple-icon.png")).toEqual([180, 180]);
    for (const size of [192, 512]) {
      const icon = manifest().icons!.find((i) => i.sizes === `${size}x${size}`)!;
      expect(icon.type).toBe("image/png"); expect(dimensions(`public${icon.src}`)).toEqual([size, size]);
    }
  });
  it("설치한 화면·공유 링크와 무관하게 같은 앱으로 지도를 시작", () => {
    const app = manifest();
    expect(app.display).toBe("standalone");
    for (const installedFrom of ["/enter?next=%2F", "/setup", "/add?url=shared-link", "/?place=123"]) {
      const base = new URL(installedFrom, "https://datemap.example");
      expect(new URL(app.id!, base).href).toBe("https://datemap.example/");
      expect(new URL(app.start_url!, base).href).toBe("https://datemap.example/");
    }
  });
  it("PIN·이름 선택·지도·저장·설정·상세가 모두 같은 앱 범위에 포함", () => {
    const scope = new URL(manifest().scope!, "https://datemap.example");
    for (const path of ["/enter", "/setup", "/choose", "/", "/?place=123", "/add?url=shared-link", "/settings", "/confirm/123"]) {
      const target = new URL(path, scope);
      expect(target.origin).toBe(scope.origin);
      expect(target.pathname.startsWith(scope.pathname)).toBe(true);
    }
    expect(scope.pathname).toBe("/");
  });
});
