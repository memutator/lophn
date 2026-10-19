import { ipcRenderer } from "electron";

import { installAnnotate } from "./annotate/mod.ts";

// artifact page의 preload. 표시하기 층만 싣는다. lophnApp bridge도 오류 보고도 없다.
installAnnotate({
  send: (channel, payload) => ipcRenderer.send(channel, payload),
  on: (channel, listener) =>
    ipcRenderer.on(channel, (_event, payload) => listener(payload)),
});
