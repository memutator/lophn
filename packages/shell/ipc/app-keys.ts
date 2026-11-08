// 앱 view의 key 맞추기와 shell 사이 통로. shell(renderer)은 이 앱의 key 글과 shell이 넘겨받을 홑 타 글을 `element.send`로
// 보내고, 앱 preload는 맞은 key를 삼켜 앱 handler를 부르거나 shell 글이면 `sendToHost`로 넘긴다. 같은 element의
// `ipc-message`로 받으므로 신원이 필요 없다(app-tab-head.ts와 같은 길).

/** host → guest. 값은 `AppKeysPayload`다. page가 새로 load되면 다시 보낸다. */
export const APP_KEYS_CHANNEL = "app:keys";
/** guest → host. 값은 맞은 shell key의 글(payload.forward의 하나)이다. */
export const APP_KEYS_FORWARD_CHANNEL = "app:keys-forward";

export interface AppKeysPayload {
  /** 앱 key의 이름(선언의 `id`) → 지금 듣는 글. 사람이 바꾼 키가 반영된다. */
  readonly keys: Readonly<Record<string, readonly string[]>>;
  /** 앱 page가 맞으면 삼키고 shell로 넘길 홑 타 글. 지금 부를 수 있는 shell 기능만 든다. */
  readonly forward: readonly string[];
}
