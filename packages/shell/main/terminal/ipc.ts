// shell renderer의 terminal IPC. main frame·focus·generation을 확인한 뒤에만 host로 보낸다.
// 터미널 출력은 agent로 자동 전송하지 않는다.

import type { ZodType } from "zod";

import {
  type TerminalBridgeAck,
  terminalBridgeAckSchema,
  type TerminalClose,
  terminalCloseSchema,
  type TerminalFocus,
  terminalFocusSchema,
  type TerminalInput,
  terminalInputSchema,
  type TerminalLink,
  terminalLinkSchema,
  type TerminalAgentSession,
  type TerminalAgentSessionRename,
  terminalAgentSessionRenameSchema,
  terminalAgentSessionsSchema,
  type TerminalAgentSessionsQuery,
  type TerminalOpen,
  terminalOpenSchema,
  type TerminalReply,
  type TerminalResume,
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
import type { TerminalBridge } from "../browser-bridge/types.ts";
import type { AgentTracker } from "./agent/tracker.ts";
import type { TerminalHooks } from "./agent/ingress.ts";
import { SHELL_INIT_ENV } from "../../terminal-host/shell-integration.ts";

type FocusTable = {
  focused(
    contentsId: number,
    terminalRef: string,
    generation?: number,
  ): boolean;
  focus(contentsId: number, terminalRef: string, generation?: number): void;
  blur(contentsId: number, terminalRef: string): void;
};

type FolderSource = {
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
  /** terminal에서 Ctrl/Cmd-click한 link. 어디에서 열지는 bridge가 정한다. */
  link(event: IpcEvent, input: unknown): Promise<IpcResult<null>>;
  /** bridge push를 받은 renderer의 답. browser 탭을 열었을 때만 온다. */
  bridgeAck(event: IpcEvent, input: unknown): Promise<IpcResult<null>>;
  /** 그 project에서 저장한 coding agent session. 새것부터다. */
  agentSessions(
    event: IpcEvent,
    input: unknown,
  ): Promise<IpcResult<TerminalAgentSession[]>>;
  /** 탭 이름을 저장한 session에 쓰고 고정한다. name이 null이면 고정을 푼다. */
  renameAgentSession(
    event: IpcEvent,
    input: unknown,
  ): Promise<IpcResult<TerminalAgentSession[]>>;
};

const runningStub = (ref: string, generation: number): TerminalRuntime => ({
  terminal_ref: ref,
  project: "",
  folder_ref: "",
  cwd_at_start: "",
  program_path: "",
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
  /** 꺼져 있으면(win32, 준비 실패) 없다. shell 탭은 OS browser를 쓴다. */
  bridge?: TerminalBridge;
  /** 터미널 안 harness hook 길. 꺼져 있으면(win32, 준비 실패) 없다. */
  hooks?: TerminalHooks;
  /** 사람 터미널의 shell에 끼울 시작 층 폴더. 없으면(hook이 꺼짐) shell은 그대로 뜬다. */
  shellInit?: () => string | null;
  /** 터미널 안 coding agent 상태. runtime 답에 agent를 싣고, 사람의 입력·focus를 알린다. */
  agent?: Pick<AgentTracker, "decorate" | "humanInput" | "tabFocused">;
  /** 저장한 coding agent session. 꺼져 있으면 없다. */
  agentSessions?: (project: string) => Promise<TerminalAgentSession[]>;
  /** 저장한 session의 이름을 바꾸고 고정한다. 꺼져 있으면 없다. */
  renameAgentSession?: (
    input: TerminalAgentSessionRename,
  ) => Promise<TerminalAgentSession[]>;
  /** 저장한 session을 다시 여는 명령 한 줄. resume 규칙이 없는 harness면 null이다. */
  resumeLine?: (resume: TerminalResume) => string | null;
}): TerminalIpc {
  const withAgent = (reply: TerminalReply): TerminalReply =>
    deps.agent && reply.ok
      ? { ...reply, runtime: deps.agent.decorate(reply.runtime) }
      : reply;

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
    return { ok: true, value: withAgent(await run(parsed.value)) };
  }

  return {
    open: (event, input) =>
      guarded<TerminalOpen>(event, terminalOpenSchema, input, async (value) => {
        const folders = await deps.folders.folders(value.project);
        const issued = deps.bridge?.issue() ?? null;
        const hooked = deps.hooks?.issue() ?? null;
        const shellInit = deps.shellInit?.() ?? null;
        const env = {
          ...issued?.env,
          ...hooked?.env,
          ...(shellInit === null ? {} : { [SHELL_INIT_ENV]: shellInit }),
        };
        const reply = await deps.host.request({
          type: "open",
          project: value.project,
          folder_ref: value.folder_ref,
          folders,
          columns: 80,
          rows: 24,
          ...(Object.keys(env).length === 0 ? {} : { env }),
        });
        if (reply.ok) {
          if (issued !== null) {
            deps.bridge?.bind(issued.key, reply.runtime.terminal_ref);
          }
          if (hooked !== null) {
            deps.hooks?.bind(hooked.key, reply.runtime.terminal_ref);
          }
          const line =
            value.resume === undefined
              ? null
              : (deps.resumeLine?.(value.resume) ?? null);
          if (line !== null) {
            // main이 치는 글이라 사람 입력용 focus 검사와 humanInput 알림을 거치지 않는다.
            await deps.host.request({
              type: "input",
              terminal_ref: reply.runtime.terminal_ref,
              generation: reply.runtime.generation,
              text: `${line}\r`,
            });
          }
        }
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
          const reply = await deps.host.request({ type: "input", ...value });
          if (reply.ok) deps.agent?.humanInput(value.terminal_ref, value.text);
          return reply;
        },
      ),
    resize: (event, input) =>
      guarded<TerminalResize>(
        event,
        terminalResizeSchema,
        input,
        // 치수는 그 칸의 크기를 따를 뿐 PTY에 글자를 넣지 않는다. focus가 없는 칸(split의 다른 pane)의
        // 터미널도 보이는 채로 크기가 바뀌므로 focus 표를 보지 않는다.
        async (value) => await deps.host.request({ type: "resize", ...value }),
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
          const reply = await deps.host.request({ type: "close", ...value });
          if (reply.ok && reply.runtime.state === "exited") {
            deps.bridge?.revoke(value.terminal_ref);
            deps.hooks?.revoke(value.terminal_ref);
          }
          return reply;
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
        deps.agent?.tabFocused(value.terminal_ref);
      } else {
        deps.focus.blur(event.sender.id, value.terminal_ref);
      }
      return Promise.resolve({ ok: true, value: null });
    },
    link: async (event, input) => {
      const caller = checkCaller(deps.registry, event);
      if (!caller.ok) return caller;
      const parsed = checkInput<TerminalLink>(terminalLinkSchema, input);
      if (!parsed.ok) return parsed;
      await deps.bridge?.openLink(parsed.value);
      return { ok: true, value: null };
    },
    bridgeAck: (event, input) => {
      const caller = checkCaller(deps.registry, event);
      if (!caller.ok) return Promise.resolve(caller);
      const parsed = checkInput<TerminalBridgeAck>(
        terminalBridgeAckSchema,
        input,
      );
      if (!parsed.ok) return Promise.resolve(parsed);
      deps.bridge?.ack(parsed.value.request, parsed.value.opened);
      return Promise.resolve({ ok: true, value: null });
    },
    agentSessions: async (event, input) => {
      const caller = checkCaller(deps.registry, event);
      if (!caller.ok) return caller;
      const parsed = checkInput<TerminalAgentSessionsQuery>(
        terminalAgentSessionsSchema,
        input,
      );
      if (!parsed.ok) return parsed;
      return {
        ok: true,
        value: (await deps.agentSessions?.(parsed.value.project)) ?? [],
      };
    },
    renameAgentSession: async (event, input) => {
      const caller = checkCaller(deps.registry, event);
      if (!caller.ok) return caller;
      const parsed = checkInput<TerminalAgentSessionRename>(
        terminalAgentSessionRenameSchema,
        input,
      );
      if (!parsed.ok) return parsed;
      return {
        ok: true,
        value: (await deps.renameAgentSession?.(parsed.value)) ?? [],
      };
    },
  };
}
