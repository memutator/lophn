// 사람이 고른 appearance(theme, accent, 배경, 글꼴, 글자 크기, 밀도)를 main에 알린다. shell renderer만
// data-theme을 쓰고 overlay·보호 입력 창·앱 view는 별도 문서다. main이 값을 검사해 nativeTheme.themeSource를
// 맞추고(그 문서들의 prefers-color-scheme), token을 덮어쓰는 CSS를 모든 문서에 넣는다.
// 이 파일은 main·preload·renderer가 함께 부르므로 type import만 있다.
import type { Appearance } from "../../design/appearance.ts";

export const APPEARANCE_CHANNEL = "shell:appearance";

export interface AppearanceApi {
  set(appearance: Appearance): void;
}
