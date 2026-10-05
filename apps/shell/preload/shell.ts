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
import { createShellApi } from "./shell-api.ts";
import { createTerminalApi } from "./terminal-api.ts";

const location =
  (globalThis as unknown as { location: { host: string } }).location;
const role = location.host === "overlay" ? "overlay" : "shell";
contextBridge.exposeInMainWorld(
  "lophnShell",
  createShellApi(ipcRenderer, role),
);
// 터미널은 desktop renderer만 쓴다. overlay view에는 열지 않는다.
if (role === "shell") {
  contextBridge.exposeInMainWorld(
    "lophnTerminal",
    createTerminalApi(ipcRenderer),
  );
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
