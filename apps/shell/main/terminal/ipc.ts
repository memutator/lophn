// shell renderer의 terminal IPC. main frame·focus·generation을 확인한 뒤에만 host로 보낸다.
// 터미널 출력은 agent로 자동 전송하지 않는다.

import type { ZodType } from "zod";

import {
  type TerminalClose,
  type TerminalInput,
  type TerminalOpen,
  type TerminalReply,
  type TerminalResize,
  type TerminalRuntime,
  terminalCloseSchema,
  terminalInputSchema,
  terminalOpenSchema,
  terminalResizeSchema,
  terminalRestartSchema,
} from "../../ipc/terminal.ts";
import {
  checkCaller,
  checkInput,
  type ContentsRegistry,
  type IpcEvent,
  type IpcResult,
} from "../desktop/ipc-guard.ts";

export type FocusTable = {
  focused(contentsId: number, terminalRef: string): boolean;
};

export type FolderSource = {
  folders(project: string): Promise<readonly { folder_ref: string; path: string }[]>;
};

export type TerminalIpc = {
  open(event: IpcEvent, input: unknown): Promise<IpcResult<TerminalReply>>;
  input(event: IpcEvent, input: unknown): Promise<IpcResult<TerminalReply>>;
  resize(event: IpcEvent, input: unknown): Promise<IpcResult<TerminalReply>>;
  close(event: IpcEvent, input: unknown): Promise<IpcResult<TerminalReply>>;
  restart(event: IpcEvent, input: unknown): Promise<IpcResult<TerminalReply>>;
};

const runningStub = (ref: string, generation: number): TerminalRuntime => ({
  terminal_ref: ref,
  project: "",
  folder_ref: "",
  cwd_at_start: "",
  program_path: "",
  launch_kind: "shell",
  state: "running",
  generation,
  columns: 80,
  rows: 24,
  exit_code: null,
  failure_reason: null,
  output_seq: 0,
  dropped_output: false,
});

export function createTerminalIpc(deps: {
  registry: ContentsRegistry;
  focus: FocusTable;
  folders: FolderSource;
  host: { request(message: unknown): Promise<TerminalReply> };
  /** 살아 있는 탭을 닫기 전에 사람이 확인한다. false면 runtime을 유지한다. */
  confirmClose?: (runtime: TerminalRuntime) => Promise<boolean>;
}): TerminalIpc {
  async function guarded<T>(
    event: IpcEvent,
    schema: ZodType<T>,
    input: unknown,
    run: (value: T) => Promise<TerminalReply>,
  ): Promise<IpcResult<TerminalReply>> {
    const caller = checkCaller(deps.registry, event);
    if (!caller.ok) return caller;
    const parsed = checkInput(schema, input);
    if (!parsed.ok) return parsed;
    return { ok: true, value: await run(parsed.value) };
  }

  return {
    open: (event, input) =>
      guarded<TerminalOpen>(event, terminalOpenSchema, input, async (value) => {
        const folders = await deps.folders.folders(value.project);
        return await deps.host.request({
          type: "open",
          project: value.project,
          folder_ref: value.folder_ref,
          folders,
          columns: 80,
          rows: 24,
        });
      }),
    input: (event, input) =>
      guarded<TerminalInput>(event, terminalInputSchema, input, async (value) => {
        if (!deps.focus.focused(event.sender.id, value.terminal_ref)) {
          return { ok: false, reason: "host_lost", message: "terminal is not focused" };
        }
        return await deps.host.request({ type: "input", ...value });
      }),
    resize: (event, input) =>
      guarded<TerminalResize>(event, terminalResizeSchema, input, async (value) => {
        if (!deps.focus.focused(event.sender.id, value.terminal_ref)) {
          return { ok: false, reason: "host_lost", message: "terminal is not focused" };
        }
        return await deps.host.request({ type: "resize", ...value });
      }),
    close: (event, input) =>
      guarded<TerminalClose>(event, terminalCloseSchema, input, async (value) => {
        if (deps.confirmClose) {
          const allowed = await deps.confirmClose(
            runningStub(value.terminal_ref, value.generation),
          );
          if (!allowed) {
            return { ok: false, reason: "host_lost", message: "close cancelled" };
          }
        }
        return await deps.host.request({ type: "close", ...value });
      }),
    restart: (event, input) =>
      guarded(event, terminalRestartSchema, input, async (value) => {
        if (!deps.focus.focused(event.sender.id, value.terminal_ref)) {
          return { ok: false, reason: "host_lost", message: "terminal is not focused" };
        }
        return await deps.host.request({ type: "restart", ...value });
      }),
  };
}
