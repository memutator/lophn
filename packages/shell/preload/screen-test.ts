// 앱 화면 검사 host만 test session에 더하는 preload. 앱 preload(`app.ts`)는
// 그대로 함께 돈다.
// - CSP가 막은 fetch·이미지·frame 요청은 renderer 안에서 끝나 session webRequest에 닿지 않는다.
//   그래서 DOM의 `securitypolicyviolation`을 isolated world에서 듣고 막힌 주소만 main에 보낸다.
// - host main이 `app-test:probe`로 요청하면 host가 화면 origin에서 내주는 예약 script를 페이지에
//   붙인다(처리되지 않은 `error`·`unhandledrejection`·`lophn:render-error` 하나씩, 또는 main
//   thread 막기). 화면 자신의 script와 같은 경로로 도니 오류도 실제 그대로 난다. 페이지에는
//   아무 이름도 더하지 않는다.
import { ipcRenderer } from "electron";

import {
  SCREEN_TEST_BLOCKED_CHANNEL,
  SCREEN_TEST_PROBE_CHANNEL,
  SCREEN_TEST_PROBE_SCRIPTS,
} from "../ipc/screen-test.ts";

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

interface ProbeDocument {
  baseURI: string;
  documentElement: { appendChild(node: unknown): unknown };
  createElement(tag: string): { src: string };
}

ipcRenderer.on(SCREEN_TEST_PROBE_CHANNEL, (_event, request: unknown) => {
  const kind = typeof request === "object" && request !== null
    ? (request as { kind?: unknown }).kind
    : undefined;
  if (kind !== "errors" && kind !== "block") return;
  const page = (globalThis as unknown as { document: ProbeDocument }).document;
  const script = page.createElement("script");
  script.src = new URL(SCREEN_TEST_PROBE_SCRIPTS[kind], page.baseURI).href;
  page.documentElement.appendChild(script);
});
