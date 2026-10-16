// Settings › Coding agents의 renderer IPC. desktop 창 본문만 부르고, 호출 이름과 모양을 schema로 거른 뒤
// harness 감지(coding-connection)에 넘긴다. 사람이 coding TUI를 직접 여는 길은 없다.
import {
  CODING_CHANNEL,
  codingCallSchema,
  type CodingReply,
} from "../../ipc/coding.ts";
import type { HarnessSettings } from "./coding-connection.ts";
import {
  checkCaller,
  checkInput,
  type ContentsRegistry,
  type IpcEvent,
} from "./ipc-guard.ts";

export interface CodingIpcDeps {
  registry: ContentsRegistry;
  harnesses: HarnessSettings;
}

export interface CodingIpcMain {
  handle(
    channel: string,
    listener: (event: IpcEvent, input: unknown) => Promise<unknown>,
  ): void;
  removeHandler(channel: string): void;
}

function refused(
  code: "forbidden" | "invalid_input",
): CodingReply<never> {
  return { ok: false, error: { code, message: "request was refused" } };
}

export function createCodingIpc(deps: CodingIpcDeps) {
  return async (
    event: IpcEvent,
    input: unknown,
  ): Promise<CodingReply<unknown>> => {
    const caller = checkCaller(deps.registry, event);
    // overlay·앱 view는 감지를 시키지 않는다. desktop 창 본문만 연다.
    if (!caller.ok || caller.value.origin.host !== "desktop") {
      return refused("forbidden");
    }
    const parsed = checkInput(codingCallSchema, input);
    if (!parsed.ok) return refused("invalid_input");
    switch (parsed.value.op) {
      case "harnesses":
        return await deps.harnesses.read();
      case "refresh":
        return await deps.harnesses.refresh();
    }
  };
}

export function registerCodingIpc(
  main: CodingIpcMain,
  handler: ReturnType<typeof createCodingIpc>,
): void {
  main.handle(CODING_CHANNEL, handler);
}

export function removeCodingIpc(main: Pick<CodingIpcMain, "removeHandler">) {
  main.removeHandler(CODING_CHANNEL);
}
