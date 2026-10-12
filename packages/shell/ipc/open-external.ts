// shell 크롬의 외부 링크 열기(shell/app-frame#R7). renderer는 URL 하나만 보내고 main이 검사해 OS
// 기본 browser로 연다. 앱 view의 `app:open-external`과 채널·caller·검사 모듈이 다르다.
// 이 파일은 main·preload·renderer가 함께 부르므로 import가 없다.

export const OPEN_EXTERNAL_CHANNEL = "shell:open-external";

export type OpenExternalReply =
  | { ok: true }
  | { ok: false; code: "forbidden" | "invalid_input" | "unavailable" };

export interface OpenExternalApi {
  openExternal(url: string): Promise<OpenExternalReply>;
}
