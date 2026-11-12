// shell renderer의 terminal IPC. main frame·focus·generation을 확인한 뒤에만 host로 보낸다.
// 터미널 출력은 agent로 자동 전송하지 않는다.

import type { ZodType } from "zod";

import {
  type TerminalAgentSession,
  type TerminalAgentSessionRename,
  type TerminalAgentSessionsQuery,
  type TerminalBridgeAck,
  type TerminalClose,
  type TerminalFocus,
  type TerminalTabName,
  type TerminalInput,
  type TerminalLink,
  type TerminalOpen,
  type TerminalReply,
  type TerminalResize,
  type TerminalResume,
  type TerminalRuntime,
  type TerminalSnapshot,
  type TerminalSnapshotReply,
  type TerminalTraceEvent,
  terminalAgentSessionRenameSchema,
  terminalAgentSessionsSchema,
  terminalBridgeAckSchema,
  terminalCloseSchema,
  terminalFocusSchema,
  terminalTabNameSchema,
  terminalInputSchema,
  terminalCopySchema,
  terminalTraceSchema,
  terminalLinkSchema,
  terminalOpenSchema,
  terminalResizeSchema,
  terminalRestartSchema,
  terminalSnapshotSchema,
} from "../../ipc/terminal.ts";
import { SHELL_INIT_ENV } from "../../terminal-host/shell-integration.ts";
import type { TerminalBridge } from "../browser-bridge/types.ts";
import {
  type ContentsRegistry,
  checkCaller,
  checkInput,
  type IpcEvent,
  type IpcResult,
} from "../desktop/ipc-guard.ts";
import type { TerminalHooks } from "./agent/ingress.ts";
import type { AgentTracker } from "./agent/tracker.ts";
import { folderOfCwd } from "./cwd.ts";

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
  respond(event: IpcEvent, input: unknown): Promise<IpcResult<TerminalReply>>;
  resize(event: IpcEvent, input: unknown): Promise<IpcResult<TerminalReply>>;
  close(event: IpcEvent, input: unknown): Promise<IpcResult<TerminalReply>>;
  restart(event: IpcEvent, input: unknown): Promise<IpcResult<TerminalReply>>;
  snapshot(
    event: IpcEvent,
    input: unknown,
  ): Promise<IpcResult<TerminalReply | TerminalSnapshotReply>>;
  /** 사람이 고른 탭이 바뀌었다. 표에 적을 뿐 host에는 보내지 않는다. */
  focus(event: IpcEvent, input: unknown): Promise<IpcResult<null>>;
  /** 탭 줄에 보이는 이름. 알림 제목용으로 적어 둘 뿐이다. */
  tabName(event: IpcEvent, input: unknown): Promise<IpcResult<null>>;
  /** terminal에서 Ctrl/Cmd-click한 link. 어디에서 열지는 bridge가 정한다. */
  link(event: IpcEvent, input: unknown): Promise<IpcResult<null>>;
  /** 사람이 고른 터미널 글을 OS clipboard에 쓴다. */
  copy(event: IpcEvent, input: unknown): Promise<IpcResult<null>>;
  /** OS clipboard의 글. 붙여 넣기는 renderer의 xterm이 한다. */
  paste(event: IpcEvent, input: unknown): Promise<IpcResult<string>>;
  /** renderer의 진단 기록. 기록이 꺼져 있으면 false다. */
  trace(event: IpcEvent, input: unknown): Promise<IpcResult<boolean>>;
  /** bridge push를 받은 renderer의 답. browser 탭을 열었을 때만 온다. */
  bridgeAck(event: IpcEvent, input: unknown): Promise<IpcResult<null>>;
  /** 지금 coding agent가 도는 터미널의 runtime. */
  agents(event: IpcEvent): Promise<IpcResult<TerminalRuntime[]>>;
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
  /**
   * main이 PTY에 치는 글(열 때 넣는 명령, 탭 GUI의 TUI 명령). 사람 입력의 focus 검사와 humanInput 알림을 거치지 않는다.
   * 새 shell의 시작 층이 끝나기를 기다리는 것은 부르는 쪽 몫이다(이미 도는 shell은 출력이 없어 `settled`가 5초를 쓴다).
   */
  typeInto(
    terminalRef: string,
    generation: number,
    text: string,
  ): Promise<void>;
  /** foreground process group에 signal을 보낸다(host가 Linux에서만 한다). foreground가 shell이면 아무 일도 없다. */
  signalForeground(
    terminalRef: string,
    generation: number,
    signal: "SIGINT" | "SIGTERM",
  ): Promise<void>;
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

/**
 * 열 때 넣을 명령의 입력 글. 한 줄이면 Enter까지 쳐서 실행한다. 여러 줄이면 bracketed paste로 감싸 붙여 넣기만
 * 한다. 줄마다 실행되지 않고 사람이 보고 Enter를 누른다(bash·zsh는 5.1부터 bracketed paste가 기본이다).
 */
function commandInput(command: string | undefined): string | null {
  const text = command?.replace(/\r\n?/g, "\n").replace(/\n+$/, "") ?? "";
  if (text.trim() === "") return null;
  return text.includes("\n") ? `\x1b[200~${text}\x1b[201~` : `${text}\r`;
}

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
  /** 새 터미널 PATH에 더할 CLI 폴더. hook 길과 무관하게 줘서 hook socket이 꺼진 Windows도 `lophn`을 친다. */
  cliPath?: () => Record<string, string>;
  /** 터미널 안 coding agent 상태. runtime 답에 agent를 싣고, 사람의 입력·focus를 알린다. */
  agent?: Pick<AgentTracker, "decorate" | "humanInput" | "tabFocused">;
  /** 탭 줄에 보이는 이름을 적는다. */
  tabName?: (terminalRef: string, name: string) => void;
  /** 지금 coding agent가 도는 터미널의 runtime(agent를 실은 것). */
  agents?: () => TerminalRuntime[];
  /** 저장한 coding agent session. 꺼져 있으면 없다. */
  agentSessions?: (project: string) => Promise<TerminalAgentSession[]>;
  /** 저장한 session의 이름을 바꾸고 고정한다. 꺼져 있으면 없다. */
  renameAgentSession?: (
    input: TerminalAgentSessionRename,
  ) => Promise<TerminalAgentSession[]>;
  /** 저장한 session을 다시 여는 명령 한 줄. resume 규칙이 없는 harness면 null이다. */
  resumeLine?: (resume: TerminalResume) => string | null;
  /** OS clipboard(Electron 44 `clipboard`). 없으면(headless) 복사는 버리고 붙여 넣기는 빈 글이다. */
  clipboard?: {
    writeText(text: string): Promise<void>;
    readText(): Promise<string>;
  };
  /**
   * 터미널 진단 기록에 덧붙인다. window는 보낸 창(webContents id)이다. 기록이 꺼져 있으면(설정 `diagnostics.trace`)
   * 덧붙이지 않고 false라 renderer가 잠시 모으지 않는다.
   */
  trace?: (
    window: number,
    events: readonly TerminalTraceEvent[],
  ) => Promise<boolean>;
  /**
   * 새 shell이 시작 층을 다 읽을 때까지 기다린다(출력이 잠잠해질 때). 그 전에 친 글은 시작 중에 버려진다.
   * 없으면 기다리지 않는다.
   */
  settled?: (terminalRef: string) => Promise<void>;
  outputs?: {
    watch(contentsId: number, terminalRef: string, enabled: boolean): void;
    watching(contentsId: number, terminalRef: string): boolean;
  };
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

  async function typeInto(
    terminalRef: string,
    generation: number,
    text: string,
  ): Promise<void> {
    const reply = await deps.host.request({
      type: "input",
      terminal_ref: terminalRef,
      generation,
      text,
    });
    if (!reply.ok) throw new Error(reply.message);
  }

  return {
    typeInto,
    async signalForeground(terminalRef, generation, signal) {
      const reply = await deps.host.request({
        type: "signal",
        terminal_ref: terminalRef,
        generation,
        signal,
      });
      if (!reply.ok) throw new Error(reply.message);
    },
    open: (event, input) =>
      guarded<TerminalOpen>(event, terminalOpenSchema, input, async (value) => {
        const folders = await deps.folders.folders(value.project);
        const start =
          value.cwd === undefined ? null : folderOfCwd(folders, value.cwd);
        if (start !== null && !start.ok) {
          return {
            ok: false,
            reason: "unreadable",
            message: "cwd is not inside a registered folder",
          };
        }
        const issued = deps.bridge?.issue() ?? null;
        const hooked = deps.hooks?.issue() ?? null;
        const shellInit = deps.shellInit?.() ?? null;
        const env = {
          // 사람 token의 `lophn tab open --url`이 이 project에 탭을 놓게 한다.
          LOPHN_WORKSPACE: JSON.stringify({ project: value.project }),
          ...issued?.env,
          ...hooked?.env,
          ...deps.cliPath?.(),
          ...(shellInit === null ? {} : { [SHELL_INIT_ENV]: shellInit }),
        };
        const reply = await deps.host.request({
          type: "open",
          project: value.project,
          folder_ref: start?.folder_ref ?? value.folder_ref,
          ...(start === null ? {} : { cwd: start.path }),
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
          const typed =
            line !== null ? `${line}\r` : commandInput(value.command);
          if (typed !== null) {
            await deps.settled?.(reply.runtime.terminal_ref);
            // 탭은 이미 열렸다. 친 줄이 거절돼도 open을 실패로 만들지 않고 다시 치지 않는다.
            await typeInto(
              reply.runtime.terminal_ref,
              reply.runtime.generation,
              typed,
            ).catch(() => {});
          }
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
    respond: (event, input) =>
      guarded<TerminalInput>(
        event,
        terminalInputSchema,
        input,
        async (value) => {
          if (!deps.outputs?.watching(event.sender.id, value.terminal_ref)) {
            return {
              ok: false,
              reason: "host_lost",
              message: "terminal is not subscribed",
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
        async (value) => {
          if (value.watch !== undefined) {
            deps.outputs?.watch(
              event.sender.id,
              value.terminal_ref,
              value.watch,
            );
          }
          return await deps.host.request({
            type: "snapshot",
            terminal_ref: value.terminal_ref,
            after_seq: value.after_seq,
          });
        },
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
    tabName: (event, input) => {
      const caller = checkCaller(deps.registry, event);
      if (!caller.ok) return Promise.resolve(caller);
      const parsed = checkInput<TerminalTabName>(terminalTabNameSchema, input);
      if (!parsed.ok) return Promise.resolve(parsed);
      deps.tabName?.(parsed.value.terminal_ref, parsed.value.name);
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
    copy: async (event, input) => {
      const caller = checkCaller(deps.registry, event);
      if (!caller.ok) return caller;
      const parsed = checkInput<{ text: string }>(terminalCopySchema, input);
      if (!parsed.ok) return parsed;
      await deps.clipboard?.writeText(parsed.value.text).catch(() => {});
      return { ok: true, value: null };
    },
    trace: async (event, input) => {
      const caller = checkCaller(deps.registry, event);
      if (!caller.ok) return caller;
      if (deps.trace === undefined) return { ok: true, value: false };
      const parsed = checkInput<{ events: TerminalTraceEvent[] }>(
        terminalTraceSchema,
        input,
      );
      if (!parsed.ok) return parsed;
      return {
        ok: true,
        value: await deps.trace(event.sender.id, parsed.value.events),
      };
    },
    paste: async (event) => {
      const caller = checkCaller(deps.registry, event);
      if (!caller.ok) return caller;
      const text = deps.clipboard
        ? await deps.clipboard.readText().catch(() => "")
        : "";
      return { ok: true, value: text };
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
    agents: (event) => {
      const caller = checkCaller(deps.registry, event);
      if (!caller.ok) return Promise.resolve(caller);
      return Promise.resolve({ ok: true, value: deps.agents?.() ?? [] });
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
