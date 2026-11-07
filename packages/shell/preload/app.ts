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
    const body = document.body;
    if (body === null) return;
    ipcRenderer.sendToHost(APP_CONTENT_SIZE_CHANNEL, {
      overflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
      height: body.getBoundingClientRect().height,
    });
  };
  const watch = () => {
    const observer = new ResizeObserver(report);
    observer.observe(document.documentElement);
    if (document.body !== null) observer.observe(document.body);
    report();
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", watch, { once: true });
  } else watch();
}
