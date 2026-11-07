// 앱 화면이 "이 page를 workspace를 떠나도 살려 둬"라고 알리는 통로. 탭 머리 줄(app-tab-head.ts)과 같은 길이다:
// 앱 preload가 `sendToHost`로 올리고 renderer는 그 `<webview>` element의 `ipc-message`로 받는다. 신원이 필요 없고
// 보낸 element가 곧 그 화면이다. page가 새로 load되면 shell이 신호를 지우므로 page가 다시 보내야 한다.

/** guest → host. 값은 boolean이다. */
export const APP_KEEP_ALIVE_CHANNEL = "app:keep-alive";
