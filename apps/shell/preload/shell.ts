import { contextBridge, ipcRenderer } from "electron";

import {
  type ConnectionState,
  connectionStateSchema,
  CORE_CALL_CHANNEL,
  CORE_STATE_CHANNEL,
  type CoreCall,
  coreCallSchema,
} from "../ipc/core.ts";
import type { CoreApi, CoreReply } from "../ipc/core-api.ts";
import {
  FOLDER_PICK_CHANNEL,
  type FolderPickerApi,
  type FolderPickReply,
} from "../ipc/folder-picker.ts";
import { createAppWindowsApi } from "./app-window-api.ts";
import { createConfirmationOpener } from "./confirmation-open.ts";
import { createEditorApi } from "./editor-api.ts";
import { createShellApi } from "./shell-api.ts";
import { createIntentApi, createShortcutApi } from "./shortcut-api.ts";
import { createTerminalApi } from "./terminal-api.ts";
import { createViewsApi } from "./views-api.ts";

const location =
  (globalThis as unknown as { location: { host: string } }).location;
const role = location.host === "overlay" ? "overlay" : "shell";
// 앱 view 열기·bounds·숨김·폐기는 desktop renderer만 부른다. overlay view에는 열지 않는다.
// 보호 창 열기는 desktop 창 본문만 갖는다. 창을 열 뿐 결정을 제출하지 못한다.
contextBridge.exposeInMainWorld(
  "lophnShell",
  role === "shell"
    ? Object.freeze({
      ...createShellApi(ipcRenderer, role),
      ...createViewsApi(ipcRenderer),
      openConfirmation: createConfirmationOpener(ipcRenderer),
    })
    : createShellApi(ipcRenderer, role),
);
// 터미널과 창 shortcut, main이 시키는 것은 desktop renderer만 쓴다. overlay view에는 열지 않는다.
if (role === "shell") {
  contextBridge.exposeInMainWorld(
    "lophnTerminal",
    createTerminalApi(ipcRenderer),
  );
  contextBridge.exposeInMainWorld(
    "lophnShortcuts",
    createShortcutApi(ipcRenderer),
  );
  // 프로젝트 등록의 OS 폴더 선택기. 경로는 main이 연 dialog의 결과만 온다.
  contextBridge.exposeInMainWorld(
    "lophnFolders",
    Object.freeze(
      {
        async pick(): Promise<FolderPickReply> {
          try {
            return await ipcRenderer.invoke(
              FOLDER_PICK_CHANNEL,
              {},
            ) as FolderPickReply;
          } catch {
            return { ok: false, code: "unavailable" };
          }
        },
      } satisfies FolderPickerApi,
    ),
  );
  contextBridge.exposeInMainWorld("lophnIntents", createIntentApi(ipcRenderer));
  // 앱 공간의 [Open in new window]와 OS 앱 바로가기. 앱 ID만 보낸다.
  contextBridge.exposeInMainWorld(
    "lophnAppWindows",
    createAppWindowsApi(ipcRenderer),
  );
  // 문서 편집기의 파일 통로(shell/editor#R1). 경로·core port는 main에만 있다.
  contextBridge.exposeInMainWorld("lophnEditor", createEditorApi(ipcRenderer));
}

const unavailable: CoreReply = {
  ok: false,
  error: { code: "unavailable", message: "Core transport is unavailable" },
};

// 상태는 schema로 거르고, call은 이름 모양만 맞을 때 넘긴다. token은 이 통로에 없다.
function createCoreApi(): CoreApi {
  return Object.freeze({
    subscribe(listener: (state: ConnectionState) => void) {
      const callback = (_event: unknown, payload: unknown) => {
        const parsed = connectionStateSchema.safeParse(payload);
        if (parsed.success) listener(parsed.data);
      };
      ipcRenderer.on(CORE_STATE_CHANNEL, callback);
      return () => ipcRenderer.removeListener(CORE_STATE_CHANNEL, callback);
    },
    async call(input: CoreCall): Promise<CoreReply> {
      if (!coreCallSchema.safeParse(input).success) return unavailable;
      try {
        return await ipcRenderer.invoke(CORE_CALL_CHANNEL, input) as CoreReply;
      } catch {
        return unavailable;
      }
    },
  });
}

contextBridge.exposeInMainWorld("lophnCore", createCoreApi());
