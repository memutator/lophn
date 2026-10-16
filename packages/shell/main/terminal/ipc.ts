// shell renderer의 terminal IPC. main frame·focus·generation을 확인한 뒤에만 host로 보낸다.
// 터미널 출력은 agent로 자동 전송하지 않는다.

import type { ZodType } from "zod";

import {
  type TerminalClose,
  terminalCloseSchema,
  type TerminalFocus,
  terminalFocusSchema,
  type TerminalFocusSession,
  terminalFocusSessionSchema,
  type TerminalInput,
  terminalInputSchema,
  type TerminalOpen,
  terminalOpenSchema,
  type TerminalReply,
  type TerminalResize,
  terminalResizeSchema,
  terminalRestartSchema,
  type TerminalRuntime,
  type TerminalSnapshot,
  type TerminalSnapshotReply,
  terminalSnapshotSchema,
} from "../../ipc/terminal.ts";
import {
  checkCaller,
  checkInput,
  type ContentsRegistry,
  type IpcEvent,
  type IpcResult,
} from "../desktop/ipc-guard.ts";

export type FocusTable = {
  focused(
    contentsId: number,
    terminalRef: string,
    generation?: number,
  ): boolean;
  focus(contentsId: number, terminalRef: string, generation?: number): void;
  blur(contentsId: number, terminalRef: string): void;
};

export type FolderSource = {
  folders(
    project: string,
  ): Promise<readonly { folder_ref: string; path: string }[]>;
};

export type TerminalIpc = {
  open(event: IpcEvent, input: unknown): Promise<IpcResult<TerminalReply>>;
  input(event: IpcEvent, input: unknown): Promise<IpcResult<TerminalReply>>;
  resize(event: IpcEvent, input: unknown): Promise<IpcResult<TerminalReply>>;
  close(event: IpcEvent, input: unknown): Promise<IpcResult<TerminalReply>>;
  restart(event: IpcEvent, input: unknown): Promise<IpcResult<TerminalReply>>;
  snapshot(
    event: IpcEvent,
    input: unknown,
  ): Promise<IpcResult<TerminalReply | TerminalSnapshotReply>>;
  /** 사람이 고른 탭이 바뀌었다. 표에 적을 뿐 host에는 보내지 않는다. */
  focus(event: IpcEvent, input: unknown): Promise<IpcResult<null>>;
  /** 대기 목록에서 누른 coding session의 탭을 고른다. 탭이 없으면 `no_terminal`로 거절한다. */
  focusSession(
    event: IpcEvent,
    input: unknown,
  ): Promise<IpcResult<TerminalReply>>;
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
  /** coding session ↔ 터미널 탭 표. 탭 runtime을 창에 다시 알리고 돌려준다. */
  coding?: { reveal(session: string): TerminalRuntime | undefined };
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
        const reply = await deps.host.request({
          type: "open",
          project: value.project,
          folder_ref: value.folder_ref,
          folders,
          columns: 80,
          rows: 24,
        });
        // 여러 등록 폴더면 시작하지 않고 고를 목록을 돌려준다.
        if (!reply.ok && reply.reason === "choose_folder") {
          return {
            ...reply,
            folders: folders.map((folder) => ({
              folder_ref: folder.folder_ref,
              path: folder.path,
            })),
          };
        }
        return reply;
      }),
    input: (event, input) =>
      guarded<TerminalInput>(
        event,
        terminalInputSchema,
        input,
        async (value) => {
          if (
            !deps.focus.focused(
              event.sender.id,
              value.terminal_ref,
              value.generation,
            )
          ) {
            return {
              ok: false,
              reason: "host_lost",
              message: "terminal is not focused",
            };
          }
          return await deps.host.request({ type: "input", ...value });
        },
      ),
    resize: (event, input) =>
      guarded<TerminalResize>(
        event,
        terminalResizeSchema,
        input,
        async (value) => {
          if (!deps.focus.focused(event.sender.id, value.terminal_ref)) {
            return {
              ok: false,
              reason: "host_lost",
              message: "terminal is not focused",
            };
          }
          return await deps.host.request({ type: "resize", ...value });
        },
      ),
    close: (event, input) =>
      guarded<TerminalClose>(
        event,
        terminalCloseSchema,
        input,
        async (value) => {
          if (deps.confirmClose) {
            const allowed = await deps.confirmClose(
              runningStub(value.terminal_ref, value.generation),
            );
            if (!allowed) {
              return {
                ok: false,
                reason: "host_lost",
                message: "close cancelled",
              };
            }
          }
          return await deps.host.request({ type: "close", ...value });
        },
      ),
    restart: (event, input) =>
      guarded(event, terminalRestartSchema, input, async (value) => {
        if (!deps.focus.focused(event.sender.id, value.terminal_ref)) {
          return {
            ok: false,
            reason: "host_lost",
            message: "terminal is not focused",
          };
        }
        return await deps.host.request({ type: "restart", ...value });
      }),
    snapshot: (event, input) =>
      guarded<TerminalSnapshot>(
        event,
        terminalSnapshotSchema,
        input,
        async (value) =>
          await deps.host.request({
            type: "snapshot",
            terminal_ref: value.terminal_ref,
            after_seq: value.after_seq,
          }),
      ),
    focus: (event, input) => {
      const caller = checkCaller(deps.registry, event);
      if (!caller.ok) return Promise.resolve(caller);
      const parsed = checkInput<TerminalFocus>(terminalFocusSchema, input);
      if (!parsed.ok) return Promise.resolve(parsed);
      const value = parsed.value;
      if (value.focused) {
        deps.focus.focus(event.sender.id, value.terminal_ref, value.generation);
      } else {
        deps.focus.blur(event.sender.id, value.terminal_ref);
      }
      return Promise.resolve({ ok: true, value: null });
    },
    focusSession: (event, input) =>
      guarded<TerminalFocusSession>(
        event,
        terminalFocusSessionSchema,
        input,
        (value) => {
          const runtime = deps.coding?.reveal(value.session);
          return Promise.resolve(
            runtime === undefined
              ? {
                ok: false,
                reason: "no_terminal",
                message: "session has no terminal tab",
              }
              : { ok: true, runtime },
          );
        },
      ),
  };
}
