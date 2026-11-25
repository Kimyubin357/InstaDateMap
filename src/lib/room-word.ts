/**
 * 화면 용어는 "방"만 씁니다(2026-11-25 사용자 결정). DB 함수가 돌려주는 안내(raise exception)에는
 * 아직 "폴더"가 남아 있어, 사용자에게 보내기 전에 조사까지 맞춰 바꿉니다.
 */
const PARTICLES: [RegExp, string][] = [
  [/폴더”는/g, "방”은"], [/폴더”를/g, "방”을"], [/폴더”가/g, "방”이"],
  [/폴더를/g, "방을"], [/폴더가/g, "방이"], [/폴더는/g, "방은"], [/폴더와/g, "방과"],
  [/폴더로/g, "방으로"], [/폴더라(?=[^가-힣]|$|서|고|도)/g, "방이라"], [/폴더예요/g, "방이에요"], [/폴더야/g, "방이야"],
  [/폴더/g, "방"],
];
export function roomWord(text: string) {
  return PARTICLES.reduce((s, [from, to]) => s.replace(from, to), text);
}
