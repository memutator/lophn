// appearance(모드, 모드별 theme, accent, 글꼴, 글자 크기, 밀도)는 core 설정(`shell.*`)이고 theme은 그 설정의 항목
// (`shell.themes.<id>`, `<data root>/themes/<id>.json`)이다. main은 core 설정의 사본을 따라 모든 문서에 CSS를 넣고,
// renderer는 같은 설정을 core에서 읽는다. 값을 main에 보내는 channel은 없다. 남은 것은 OS 파일 관리자를 여는 일뿐이다.
// 이 파일은 main·preload·renderer가 함께 부르므로 import가 없다.

/** theme 항목을 가진 folder 설정의 key. */
export const THEMES_SETTING_KEY = "shell.themes";

export const THEMES_FOLDER_CHANNEL = "shell:themes-folder";

export interface AppearanceApi {
  /** theme file 폴더를 OS 파일 관리자로 연다. */
  openThemesFolder(): void;
}
