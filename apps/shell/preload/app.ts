import { contextBridge, ipcRenderer } from "electron";

import {
  createAppApi,
  createViewErrorReport,
  watchMainWorldErrors,
} from "./app-api.ts";

const transport = {
  invoke: (channel: string, input: unknown) =>
    ipcRenderer.invoke(channel, input),
  send: (channel: string, input: unknown) => ipcRenderer.send(channel, input),
};

contextBridge.exposeInMainWorld("lophnApp", createAppApi(transport));
// 페이지의 처리되지 않은 오류는 main world에만 보인다. 감시 함수를 그 world에서 돌리고 보고
// 함수는 인자로만 넘겨 window에 새 이름을 만들지 않는다.
contextBridge.executeInMainWorld({
  func: watchMainWorldErrors,
  args: [createViewErrorReport(transport, () => Date.now())],
});
