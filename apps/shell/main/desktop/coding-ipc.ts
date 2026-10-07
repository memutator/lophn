// coding agent 연결·[Start]의 renderer IPC(shell#T50). desktop 창 본문만 부르고, 호출 이름과 모양을 schema로
// 거른 뒤 연결은 coding-connection이, 시작은 coding-start가 다시 검사한다. 사람이 누른 [Start]가 허락이라서
// 확인 창이 없다. 한 클릭이 일회 handle을 발급하고 곧바로 그 handle로 시작한다.
import {
  CODING_CHANNEL,
  codingCallSchema,
  type CodingReply,
  type FolderChoiceView,
  type SessionView,
  type StartView,
} from "../../ipc/coding.ts";
import type { CodingStart } from "../terminal/coding-start.ts";
import type { CodingConnection } from "./coding-connection.ts";
import {
  checkCaller,
  checkInput,
  type ContentsRegistry,
  type IpcEvent,
} from "./ipc-guard.ts";

export interface CodingIpcDeps {
  registry: ContentsRegistry;
  connection: CodingConnection;
  start: CodingStart;
  /** 등록된 project 폴더 전부. 사람이 [Start] 앞에서 고른다. */
  folders(): Promise<readonly FolderChoiceView[]>;
  /** lophn이 [Start]로 연 coding TUI와 지금 관측한 상태. */
  sessions(): readonly SessionView[];
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
    // overlay·앱 view는 연결을 만들거나 시작하지 않는다. desktop 창 본문만 연다.
    if (!caller.ok || caller.value.origin.host !== "desktop") {
      return refused("forbidden");
    }
    const parsed = checkInput(codingCallSchema, input);
    if (!parsed.ok) return refused("invalid_input");
    const call = parsed.value;
    switch (call.op) {
      case "detect":
        return await deps.connection.detect("detect");
      case "refresh":
        return await deps.connection.detect("refresh");
      case "connect":
        return await deps.connection.connect(call.request);
      case "folders": {
        try {
          return { ok: true, value: await deps.folders() };
        } catch {
          return {
            ok: false,
            error: { code: "unavailable", message: "folders were not read" },
          };
        }
      }
      case "sessions":
        return { ok: true, value: deps.sessions() };
      case "start": {
        const issued = deps.start.issue(call.click);
        if (!issued.ok) return refused("invalid_input");
        const result = await deps.start.start(issued.human_start_handle);
        const view: StartView = result.ok
          ? { ok: true, runtime_ref: result.runtime.terminal_ref }
          : {
            ok: false,
            reason: result.reason,
            next: result.next,
            own_terminal: result.guide !== undefined,
          };
        return { ok: true, value: view };
      }
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
