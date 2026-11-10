// 앱 view의 event 통로. page의 `lophnApp.events.subscribe`는 page 안에서 listener를 모으고, main이 그 view의 release가
// 선언한 구독(`subscriptions`)에 맞는 event를 이 channel로 보낸다. page는 아무것도 요청하지 않는다.
// main·preload가 함께 부르므로 import가 없다.

/** main → page. 값은 `{source, event, payload}`다. source는 발행 앱의 slug나 `lophn`이다. */
export const APP_EVENT_CHANNEL = "app:event";
