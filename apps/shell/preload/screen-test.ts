// 앱 화면 검사 host만 test session에 더하는 preload(shell#T46). CSP가 막은 fetch·이미지·frame
// 요청은 renderer 안에서 끝나 session webRequest에 닿지 않는다. 그래서 DOM의
// `securitypolicyviolation`을 isolated world에서 듣고 막힌 주소만 main에 보낸다. 페이지에는
// 아무 이름도 더하지 않는다. 앱 preload(`app.ts`)는 그대로 함께 돈다.
import { ipcRenderer } from "electron";

import { SCREEN_TEST_BLOCKED_CHANNEL } from "../ipc/screen-test.ts";

interface ViolationTarget {
  addEventListener(
    type: string,
    listener: (event: { blockedURI?: unknown }) => void,
    capture: boolean,
  ): void;
}

const document = (globalThis as unknown as { document: ViolationTarget })
  .document;
document.addEventListener("securitypolicyviolation", (event) => {
  if (typeof event.blockedURI === "string") {
    ipcRenderer.send(SCREEN_TEST_BLOCKED_CHANNEL, event.blockedURI);
  }
}, true);
