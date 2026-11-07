// 전역 float(workspace를 넘는 앱 panel 화면)의 저장·복원. desktop 창 본문만 부른다. 값 검증은 store의 파일 schema가 한다.
import { z } from "zod";

import {
  GLOBAL_FLOATS_READ_CHANNEL,
  GLOBAL_FLOATS_SAVE_CHANNEL,
  type GlobalFloatsReadResult,
  type GlobalFloatsSaveResult,
} from "../../../ipc/global-floats.ts";
import type { GlobalFloatsStore } from "../../workspace/global-floats.ts";
import {
  type ContentsRegistry,
  checkCaller,
  checkInput,
  type IpcEvent,
} from "../ipc-guard.ts";

const saveInput = z.strictObject({ floats: z.array(z.unknown()) });

interface GlobalFloatsIpcMain {
  handle(
    channel: string,
    listener: (event: IpcEvent, input: unknown) => Promise<unknown>,
  ): void;
  removeHandler(channel: string): void;
}

interface GlobalFloatsIpcDeps {
  registry: ContentsRegistry;
  store: GlobalFloatsStore;
}

export function registerGlobalFloatsIpc(
  ipc: GlobalFloatsIpcMain,
  deps: GlobalFloatsIpcDeps,
): void {
  const allowed = (event: IpcEvent): boolean => {
    const caller = checkCaller(deps.registry, event);
    return caller.ok && caller.value.origin.host === "desktop";
  };

  ipc.handle(
    GLOBAL_FLOATS_READ_CHANNEL,
    async (event): Promise<GlobalFloatsReadResult> => {
      if (!allowed(event)) {
        return { ok: false, code: "forbidden", message: "" };
      }
      return { ok: true, floats: await deps.store.read() };
    },
  );

  ipc.handle(
    GLOBAL_FLOATS_SAVE_CHANNEL,
    async (event, input): Promise<GlobalFloatsSaveResult> => {
      if (!allowed(event)) {
        return { ok: false, code: "forbidden", message: "" };
      }
      const parsed = checkInput(saveInput, input);
      if (!parsed.ok) {
        return { ok: false, code: "invalid_input", message: "" };
      }
      const written = await deps.store.write(parsed.value.floats);
      if (written.ok) return { ok: true };
      return {
        ok: false,
        code:
          written.error.code === "invalid_input"
            ? "invalid_input"
            : "unavailable",
        message: "",
      };
    },
  );
}

export function removeGlobalFloatsIpc(ipc: GlobalFloatsIpcMain): void {
  ipc.removeHandler(GLOBAL_FLOATS_READ_CHANNEL);
  ipc.removeHandler(GLOBAL_FLOATS_SAVE_CHANNEL);
}
