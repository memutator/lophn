// 앱 화면 검사 host(`--app-screen-test`)의 test 전용 session preload가 쓰는 통로. 운영 shell은
// 이 preload와 통로를 등록하지 않는다. 이 파일은 main·preload가 함께 부르므로 import가 없다.

/** CSP가 renderer 안에서 막은 요청의 주소(`blockedURI`). */
export const SCREEN_TEST_BLOCKED_CHANNEL = "app-test:blocked-request";
