import { contextBridge, ipcRenderer } from "electron";

import {
  CONFIRMATION_CANCEL_CHANNEL,
  CONFIRMATION_DISPLAY_CHANNEL,
  CONFIRMATION_SUBMIT_CHANNEL,
} from "../ipc/confirmation-channels.ts";

// 보호 preload. 이 창의 표시 읽기·결정 제출·취소와 표시 갱신 구독만 연다.
// 일반 shell API·앱 호출·파일 접근은 없다. handle 원문도 없다.
const api = Object.freeze({
  getDisplay: () => ipcRenderer.invoke(CONFIRMATION_DISPLAY_CHANNEL),
  submit: (submission: unknown) =>
    ipcRenderer.invoke(CONFIRMATION_SUBMIT_CHANNEL, submission),
  cancel: () => ipcRenderer.invoke(CONFIRMATION_CANCEL_CHANNEL),
  subscribe(listener: (display: unknown) => void): () => void {
    // Electron event는 페이지로 넘기지 않는다.
    const callback = (_event: unknown, display: unknown) => listener(display);
    ipcRenderer.on(CONFIRMATION_DISPLAY_CHANNEL, callback);
    return () =>
      ipcRenderer.removeListener(CONFIRMATION_DISPLAY_CHANNEL, callback);
  },
});

contextBridge.exposeInMainWorld("lophnConfirmation", api);
