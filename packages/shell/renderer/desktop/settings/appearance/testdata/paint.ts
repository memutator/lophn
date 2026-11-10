// 가짜 통로의 화면(gallery, dev mock)에는 core 설정을 따라 CSS를 넣는 main이 없다. 같은 순수 함수(appearanceCss)로 만든
// CSS를 이 문서에 넣어 Settings › Appearance가 실제처럼 바로 적용되게 한다.
import { type Appearance, appearanceCss, type ColorTheme } from "@lophn/ui";

export function paintAppearance(
  appearance: Appearance,
  themes: readonly ColorTheme[],
): void {
  if (typeof document === "undefined") return;
  let style = document.getElementById("lophn-appearance");
  if (style === null) {
    style = document.createElement("style");
    style.id = "lophn-appearance";
    document.head.append(style);
  }
  style.textContent = appearanceCss(appearance, themes);
}
