import { contextBridge, ipcRenderer } from "electron";

import {
  SECRET_INPUT_CANCEL_CHANNEL,
  SECRET_INPUT_DISPLAY_CHANNEL,
  SECRET_INPUT_FIT_CHANNEL,
  SECRET_INPUT_SUBMIT_CHANNEL,
  type SecretInputApi,
} from "../ipc/secret-input.ts";

// 보호 입력 창 preload. 표시 읽기·값 제출·취소·창 높이 맞추기만 연다.
// 일반 shell API·앱 호출·파일 접근은 없다.
const api = Object.freeze({
  getDisplay: () => ipcRenderer.invoke(SECRET_INPUT_DISPLAY_CHANNEL),
  submit: (input) => ipcRenderer.invoke(SECRET_INPUT_SUBMIT_CHANNEL, input),
  cancel: () => ipcRenderer.invoke(SECRET_INPUT_CANCEL_CHANNEL),
  fit: (height) => ipcRenderer.invoke(SECRET_INPUT_FIT_CHANNEL, { height }),
} satisfies SecretInputApi);

contextBridge.exposeInMainWorld("lophnSecretInput", api);
