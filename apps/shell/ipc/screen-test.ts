// 앱 화면 검사 host(`--app-screen-test`)의 test 전용 session preload가 쓰는 통로. 운영 shell은
// 이 preload와 통로를 등록하지 않는다. 이 파일은 main·preload가 함께 부르므로 import가 없다.

/** CSP가 renderer 안에서 막은 요청의 주소(`blockedURI`). */
export const SCREEN_TEST_BLOCKED_CHANNEL = "app-test:blocked-request";

/** host main이 test view의 preload에 보내는 probe 요청 채널. 본문은 `{kind}`다. */
export const SCREEN_TEST_PROBE_CHANNEL = "app-test:probe";

/**
 * probe 요청 종류마다 host가 화면 origin에서 내주는 예약 script 이름(화면 폴더의 같은 이름
 * 파일보다 먼저 쓴다). preload가 `<script src>`로 붙이면 화면 자신의 script처럼 실제
 * 처리되지 않은 오류가 난다.
 */
export const SCREEN_TEST_PROBE_SCRIPTS = {
  errors: "lophn-probe-errors.js",
  block: "lophn-probe-block.js",
} as const;
