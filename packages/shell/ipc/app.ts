// 앱 preload 통로. `app:call-operation`(operation 이름과 입력)과
// `app:open-external`은 앱 페이지의 `lophnApp`이 부르고, `app:view-error`는 설치 preload가 안에서만
// 보낸다. 이 파일은 main·preload가 함께 부르므로 import가 없다.

export const APP_CALL_OPERATION_CHANNEL = "app:call-operation";
export const APP_OPEN_EXTERNAL_CHANNEL = "app:open-external";
export const APP_VIEW_ERROR_CHANNEL = "app:view-error";

/** main이 돌려주는 값. 실패 message는 페이지에 보여도 되는 고정 문구다. */
export type AppReply<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } };
