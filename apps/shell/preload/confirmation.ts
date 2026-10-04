import { contextBridge, ipcRenderer } from "electron";

// 보호 preload. 이 창의 표시 읽기·결정 제출·취소만 연다.
// 일반 shell API·앱 호출·파일 접근은 없다. handle 원문도 없다.
const api = Object.freeze({
  getDisplay: () => ipcRenderer.invoke("confirmation:display"),
  submit: (submission: unknown) =>
    ipcRenderer.invoke("confirmation:submit", submission),
  cancel: () => ipcRenderer.invoke("confirmation:cancel"),
});

contextBridge.exposeInMainWorld("lophnConfirmation", api);
