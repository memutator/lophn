// gallery의 창에는 main이 없어 appearance를 모든 문서에 넣는 일(wiring/appearance.ts)이 없다. Settings › Appearance는
// 가짜 통로가 고른 모양을 이 문서에 바로 넣는다(renderer의 testdata/paint.ts). 여기는 다른 화면을 preset으로 보는 길이다:
// 주소에 `?appearance=mode:dark,dark_theme:tokyo-night,text_size:large`처럼 쓴다
// (쉼표로 나누고 첫 `:`가 키와 값의 경계다. accent hex는 `accent:%231d5bbf`). 값을 안 쓴 항목은 기본이다.
// theme file은 Appearance 화면의 견본 file과 같다.
import { APPEARANCE_DEFAULTS, loadThemes, parseAppearance } from "@lophn/ui";
import { FAKE_THEME_FILES } from "../../../packages/shell/renderer/desktop/settings/appearance/testdata/fake-source.ts";
import { paintAppearance } from "../../../packages/shell/renderer/desktop/settings/appearance/testdata/paint.ts";

export function paintAppearancePreset(query: string | null): void {
  if (query === null) return;
  const entries = Object.fromEntries(
    query.split(",").map((pair) => {
      const at = pair.indexOf(":");
      return [pair.slice(0, at), pair.slice(at + 1)];
    }),
  );
  const appearance = parseAppearance({ ...APPEARANCE_DEFAULTS, ...entries });
  if (appearance !== undefined) {
    paintAppearance(appearance, loadThemes(FAKE_THEME_FILES).list);
  }
}
