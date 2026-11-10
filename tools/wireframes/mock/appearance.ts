// gallery의 창에는 main이 없어 appearance를 모든 문서에 넣는 일(wiring/appearance.ts)이 없다. 같은 순수 함수
// (appearanceCss)로 만든 CSS를 이 문서에 넣는 통로를 두어 Settings › Appearance가 실제처럼 바로 적용되게 한다.
// 다른 화면을 preset으로 보려면 주소에 `?appearance=mode:dark,dark_theme:tokyo-night,text_size:large`처럼 쓴다
// (쉼표로 나누고 첫 `:`가 키와 값의 경계다. accent hex는 `accent:%231d5bbf`). 값을 안 쓴 항목은 기본이다.
// theme file은 Appearance 화면의 견본 file과 같다.
import {
  type Appearance,
  APPEARANCE_DEFAULTS,
  appearanceCss,
  loadThemes,
  parseAppearance,
} from "@lophn/ui";
import type { AppearanceApi } from "../../../packages/shell/ipc/appearance.ts";
import { FAKE_THEME_FILES } from "../../../packages/shell/renderer/desktop/settings/appearance/testdata/fake-source.ts";

const themes = loadThemes(FAKE_THEME_FILES);

function apply(appearance: Appearance): void {
  let style = document.getElementById("lophn-appearance");
  if (style === null) {
    style = document.createElement("style");
    style.id = "lophn-appearance";
    document.head.append(style);
  }
  style.textContent = appearanceCss(appearance, themes.list);
}

export function installAppearanceApi(query: string | null): void {
  const api: AppearanceApi = {
    set: apply,
    themes: () => Promise.resolve(themes),
    onThemesChanged: () => () => {},
    openThemesFolder: () => {},
  };
  (globalThis as { lophnAppearance?: AppearanceApi }).lophnAppearance = api;
  if (query === null) return;
  const entries = Object.fromEntries(
    query.split(",").map((pair) => {
      const at = pair.indexOf(":");
      return [pair.slice(0, at), pair.slice(at + 1)];
    }),
  );
  const appearance = parseAppearance({ ...APPEARANCE_DEFAULTS, ...entries });
  if (appearance !== undefined) apply(appearance);
}
