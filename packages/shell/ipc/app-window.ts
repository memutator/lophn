// shell renderer가 main에 부탁하는 앱 창 일(shell/desktop#R13, R14). 앱 공간의 [Open in new
// window]와 OS 앱 바로가기 추가·삭제다. 입력은 앱 ID 하나뿐이고 이름·실행 파일 경로는 main이
// core 기록과 검증한 실행 파일에서 정한다.
import { z } from "zod";

const ULID = "[0-7][0-9a-hjkmnp-tv-z]{25}";

export const APP_WINDOW_OPEN_CHANNEL = "shell:app-window-open";
export const APP_SHORTCUT_ADD_CHANNEL = "shell:app-shortcut-add";
export const APP_SHORTCUT_REMOVE_CHANNEL = "shell:app-shortcut-remove";

export const appWindowRequestSchema = z.object({
  app: z.string().regex(new RegExp(`^app_${ULID}$`)),
}).strict();

export type AppWindowRequest = z.infer<typeof appWindowRequestSchema>;

/**
 * 실패는 사람이 겪는 영향 하나로 묶는다. `not_installed`는 설치한 lophn이 아닌 실행(개발·headless)
 * 이라 OS에 등록하지 않았다는 뜻이다.
 */
export type AppWindowErrorCode =
  | "invalid_input"
  | "forbidden"
  | "unavailable"
  | "not_installed"
  | "os_failed";

export type AppWindowReply =
  | { ok: true }
  | { ok: false; code: AppWindowErrorCode };

/** shell preload의 앱 창 API. 실패도 값으로 돌려준다. */
export interface LophnAppWindowsApi {
  openWindow(input: AppWindowRequest): Promise<AppWindowReply>;
  addShortcut(input: AppWindowRequest): Promise<AppWindowReply>;
  removeShortcut(input: AppWindowRequest): Promise<AppWindowReply>;
}
