import { expect, it } from "vitest";
import { roomWord } from "@/lib/room-word";
it("DB 안내의 '폴더'를 조사까지 맞춰 '방'으로 바꾼다", () => {
  expect(roomWord("폴더를 만든 사람만 바꿀 수 있어요.")).toBe("방을 만든 사람만 바꿀 수 있어요.");
  expect(roomWord("혼자 있는 폴더는 나가는 대신 삭제해 주세요.")).toBe("혼자 있는 방은 나가는 대신 삭제해 주세요.");
  expect(roomWord("이 폴더의 멤버가 아니에요.")).toBe("이 방의 멤버가 아니에요.");
  expect(roomWord("참여한 폴더만 열 수 있어요.")).toBe("참여한 방만 열 수 있어요.");
  expect(roomWord("‘우리’ 폴더에 이미 같은 이름이 있어요.")).toBe("‘우리’ 방에 이미 같은 이름이 있어요.");
  expect(roomWord("폴더는 30개까지 만들 수 있어요.")).toBe("방은 30개까지 만들 수 있어요.");
});
