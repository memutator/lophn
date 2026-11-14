// Appearance가 쓰는 통로. 값은 General과 같은 선언 설정(`shell.*`)이다. 설치된 글꼴 목록은 core가 아니라 이 문서의
// OS 글꼴(local-fonts.ts)이고, theme 목록은 내장 theme과 core 설정의 항목(`shell.themes`)이다.
import type { SourceResult } from "../source.ts";

export type { SourceResult };

export type AppearanceId =
  | "mode"
  | "light_theme"
  | "dark_theme"
  | "accent"
  | "font"
  | "font_custom"
  | "font_weight"
  | "code_font"
  | "code_font_custom"
  | "code_font_weight"
  | "reading_font"
  | "reading_font_custom"
  | "reading_font_weight"
  | "text_size"
  | "reading_width"
  | "density";

/** 지금 값. 사람이 고르지 않았으면 선언의 기본값이다. */
export type AppearanceValues = Readonly<Record<AppearanceId, string>>;

/** OS에 설치된 글꼴 family 하나와 그 family에 있는 굵기(CSS font-weight, 작은 것부터). */
export interface InstalledFont {
  readonly family: string;
  readonly weights: readonly string[];
}

/** Appearance 화면은 값과 theme을 `settings/list`로 읽는다. values는 창 전체에 적용하는 쪽(main.tsx)이 쓴다. */
export interface AppearanceSource {
  values(): Promise<SourceResult<AppearanceValues>>;
  /** 한 줄의 값을 정한다. 틀린 값이면 code가 거절 이유다. */
  choose(id: AppearanceId, value: string): Promise<SourceResult<null>>;
  /** 설치된 글꼴. 읽지 못하면 빈 목록이다. */
  fonts(): Promise<readonly InstalledFont[]>;
  /** theme file 폴더를 연다. */
  openThemesFolder(): void;
}
