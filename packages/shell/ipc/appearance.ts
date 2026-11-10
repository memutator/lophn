// 사람이 고른 appearance(모드, 모드별 theme, accent, 글꼴, 글자 크기, 밀도)를 main에 알린다. shell renderer만
// data-theme을 쓰고 overlay·보호 입력 창·앱 view는 별도 문서다. main이 값을 검사해 nativeTheme.themeSource를
// 맞추고(그 문서들의 prefers-color-scheme), token을 덮어쓰는 CSS를 모든 문서에 넣는다.
// theme file(`<data root>/themes/`)은 main이 읽고 지켜본다. Settings는 목록을 받아 보이고, 바뀌면 알림을 받는다.
// 이 파일은 main·preload·renderer가 함께 부르므로 type import만 있다.
import type { Appearance } from "../../design/appearance.ts";
import type { Themes } from "../../design/themes.ts";

export const APPEARANCE_CHANNEL = "shell:appearance";
export const THEMES_CHANNEL = "shell:themes";
export const THEMES_CHANGED_CHANNEL = "shell:themes-changed";
export const THEMES_FOLDER_CHANNEL = "shell:themes-folder";

export interface AppearanceApi {
  set(appearance: Appearance): void;
  /** 고를 수 있는 theme(내장과 theme file)과 쓸 수 없는 file. */
  themes(): Promise<Themes>;
  /** theme file이 바뀌면 부른다. 해제는 반환 함수다. */
  onThemesChanged(listener: () => void): () => void;
  /** theme file 폴더를 OS 파일 관리자로 연다. */
  openThemesFolder(): void;
}
