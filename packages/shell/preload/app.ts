import { contextBridge, ipcRenderer } from "electron";

import { APP_CONTENT_SIZE_CHANNEL } from "../ipc/app-content-size.ts";
import { installAnnotate } from "./annotate/mod.ts";

import {
  createAppTool,
  createViewErrorReport,
  watchMainWorldErrors,
} from "./app-tool.ts";

const transport = {
  invoke: (channel: string, input: unknown) =>
    ipcRenderer.invoke(channel, input),
  send: (channel: string, input: unknown) => ipcRenderer.send(channel, input),
  sendToHost: (channel: string, input: unknown) =>
    ipcRenderer.sendToHost(channel, input),
  on: (channel: string, listener: (payload: unknown) => void) =>
    ipcRenderer.on(channel, (_event, payload) => listener(payload)),
};

contextBridge.exposeInMainWorld(
  "lophnApp",
  createAppTool(transport, location.search),
);
// 페이지의 처리되지 않은 오류는 main world에만 보인다. 감시 함수를 그 world에서 돌리고 보고
// 함수는 인자로만 넘겨 window에 새 이름을 만들지 않는다.
contextBridge.executeInMainWorld({
  func: watchMainWorldErrors,
  args: [createViewErrorReport(transport, () => Date.now())],
});

// 표시하기 층. 페이지가 고른 항목을 main으로 보내고 main의 mode·capture 요청을 받는다.
installAnnotate({
  send: (channel, payload) => ipcRenderer.send(channel, payload),
  on: (channel, listener) =>
    ipcRenderer.on(channel, (_event, payload) => listener(payload)),
});

// tray popup은 화면 내용에 맞춰 크기를 정한다(앱이 선언한 범위 안에서). 그 자리에서만 내용 크기를 재서 올린다.
if (new URLSearchParams(location.search).get("place") === "tray") {
  const report = () => {
    const root = document.documentElement;
    const body = document.body;
    if (body === null) return;
    const clientWidth = root.clientWidth;
    const height = body.getBoundingClientRect().height;
    // DOMContentLoaded 직후 빈 root(height 0)나 크기가 잡히기 전(clientWidth 0) 값은 올리지 않는다.
    if (height <= 0 || clientWidth <= 0) return;
    // 문서 너비는 늘 popup 너비라서 내용이 더 좁은지는 그대로 재서는 알 수 없다. root를 잠깐 max-content로 놓고
    // 내용이 바라는 너비를 잰 뒤 같은 task 안에서 되돌린다(그 사이 paint가 없어 보이지 않는다).
    const was = root.style.getPropertyValue("width");
    const priority = root.style.getPropertyPriority("width");
    root.style.setProperty("width", "max-content", "important");
    const content = root.getBoundingClientRect().width;
    if (was === "") root.style.removeProperty("width");
    else root.style.setProperty("width", was, priority);
    ipcRenderer.sendToHost(APP_CONTENT_SIZE_CHANNEL, {
      // 세로 scrollbar가 자리를 차지하면 그만큼 넓어야 내용이 가로로 넘치지 않는다.
      width: content + (window.innerWidth - clientWidth),
      height,
    });
  };
  const watch = () => {
    const resized = new ResizeObserver(report);
    resized.observe(document.documentElement);
    if (document.body !== null) {
      resized.observe(document.body);
      // 글만 바뀌어 내용 너비가 달라지면 문서 크기는 그대로라 ResizeObserver가 모른다.
      new MutationObserver(report).observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    }
    report();
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", watch, { once: true });
  } else watch();
}
