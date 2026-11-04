// Appearance가 읽고 쓰는 통로. 값은 General과 같은 선언 설정(`shell.*`)이다. 화면은 이 interface만 보고
// core route 이름은 core-source.ts만 안다.
import type { SourceResult } from "../source.ts";

export type { SourceResult };

export type AppearanceId =
  | "theme"
  | "accent"
  | "background"
  | "font"
  | "font_custom"
  | "code_font"
  | "code_font_custom"
  | "reading_font"
  | "reading_font_custom"
  | "text_size"
  | "reading_width"
  | "density";

/** 지금 값. 사람이 고르지 않았으면 선언의 기본값이다. */
export type AppearanceValues = Readonly<Record<AppearanceId, string>>;

export interface AppearanceSource {
  /** core 연결 상태를 듣는다. 준비되면 화면이 다시 읽는다. 해제는 반환 함수다. */
  watch(listener: (state: { readonly state: string }) => void): () => void;
  values(): Promise<SourceResult<AppearanceValues>>;
  /** 한 줄의 값을 정한다. 틀린 값이면 code가 거절 이유다. */
  choose(id: AppearanceId, value: string): Promise<SourceResult<null>>;
}
