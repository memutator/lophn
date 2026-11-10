import { contextBridge, ipcRenderer } from "electron";

import { installAnnotate } from "./annotate/mod.ts";
import { createTabHead } from "./tab-head.ts";

// artifact page의 preload. 표시하기 층과 자기 탭 머리 줄만 싣는다. 머리 줄은 품은 renderer와만 오가므로
// main을 부르는 bridge(tool 호출, 오류 보고)는 여전히 없다. page는 kit(`LophnKit.useTabHead`)으로 쓴다.
contextBridge.exposeInMainWorld(
  "lophnTabHead",
  createTabHead({
    sendToHost: (channel, input) => ipcRenderer.sendToHost(channel, input),
    on: (channel, listener) =>
      ipcRenderer.on(channel, (_event, payload) => listener(payload)),
  }),
);

installAnnotate({
  send: (channel, payload) => ipcRenderer.send(channel, payload),
  on: (channel, listener) =>
    ipcRenderer.on(channel, (_event, payload) => listener(payload)),
});
