// 사람이 고른 theme을 main에 알린다. shell renderer만 data-theme을 쓰고 overlay·보호 입력 창·앱 view는
// 별도 문서라 data-theme이 없다. main이 nativeTheme.themeSource를 맞추면 그 문서들의
// prefers-color-scheme도 같은 theme을 따른다.
// 이 파일은 main·preload·renderer가 함께 부르므로 import가 없다.

export const THEME_CHANNEL = "shell:theme";

/** system은 OS 설정을 따른다. */
export const THEMES = ["light", "dark", "system"] as const;

export type Theme = (typeof THEMES)[number];

export interface ThemeApi {
  set(theme: Theme): void;
}
