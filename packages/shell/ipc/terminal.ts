// terminal host와 shell renderer 사이 경계. renderer는 PTY를 직접 갖지 않는다.
import { z } from "zod";

const ref = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/);
const generation = z.number().int().positive();

// 저장한 coding agent session을 다시 연다. id는 hook이 준 그대로이고 main이 harness의 resume 명령으로 바꿔 친다.
const resume = z
  .object({
    harness: z.string().min(1).max(40),
    external_session: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9._:-]+$/),
  })
  .strict();

export const terminalOpenSchema = z
  .object({
    project: ref,
    folder_ref: ref.optional(),
    resume: resume.optional(),
  })
  .strict();

export const terminalAgentSessionsSchema = z.object({ project: ref }).strict();

export const terminalInputSchema = z
  .object({
    terminal_ref: ref,
    generation,
    text: z.string().max(8192),
  })
  .strict();

export const terminalResizeSchema = z
  .object({
    terminal_ref: ref,
    generation,
    columns: z.number().int().min(1).max(512),
    rows: z.number().int().min(1).max(256),
  })
  .strict();

export const terminalCloseSchema = z
  .object({
    terminal_ref: ref,
    generation,
  })
  .strict();

export const terminalRestartSchema = z
  .object({
    terminal_ref: ref,
    generation,
  })
  .strict();

export const terminalSnapshotSchema = z
  .object({
    terminal_ref: ref,
    /** 이 seq 뒤의 chunk만 받는다. 없으면 살아 있는 buffer 전체다. */
    after_seq: z.number().int().min(0).optional(),
  })
  .strict();

/** 사람이 고른 탭이 이 터미널인지. main의 focus 표가 입력 검사에 쓴다. */
export const terminalFocusSchema = z
  .object({
    terminal_ref: ref,
    generation,
    focused: z.boolean(),
  })
  .strict();

/** terminal에서 Ctrl/Cmd-click한 link. 어디에서 열지는 main이 정한다. */
export const terminalLinkSchema = z
  .object({
    terminal_ref: ref,
    url: z.string().max(8192),
  })
  .strict();

/** main이 push한 bridge 요청에 renderer가 browser 탭을 열었는지 답한다. */
export const terminalBridgeAckSchema = z
  .object({
    request: z.string().min(1).max(64),
    opened: z.boolean(),
  })
  .strict();

export type TerminalResume = { harness: string; external_session: string };
export type TerminalOpen = {
  project: string;
  folder_ref?: string;
  /** 있으면 shell이 뜬 뒤 main이 그 harness의 resume 명령을 친다. */
  resume?: TerminalResume;
};
export type TerminalAgentSessionsQuery = { project: string };
export type TerminalInput = {
  terminal_ref: string;
  generation: number;
  text: string;
};
export type TerminalResize = {
  terminal_ref: string;
  generation: number;
  columns: number;
  rows: number;
};
export type TerminalClose = { terminal_ref: string; generation: number };
export type TerminalSnapshot = { terminal_ref: string; after_seq?: number };
export type TerminalFocus = {
  terminal_ref: string;
  generation: number;
  focused: boolean;
};

export type TerminalLink = { terminal_ref: string; url: string };
export type TerminalBridgeAck = { request: string; opened: boolean };
/** terminal 안 프로그램이 URL을 browser 탭으로 열어 달라고 했다. */
export type TerminalBridgeOpen = {
  request: string;
  terminal_ref: string;
  url: string;
};

type TerminalStateName = "starting" | "running" | "exited" | "unknown";

export type TerminalFailure =
  | "no_folder"
  | "choose_folder"
  | "not_directory"
  | "unreadable"
  | "spawn_failed"
  | "kill_unconfirmed"
  | "host_lost";

/**
 * 터미널 안에서 도는 coding agent(harness). 무엇이 도는지는 foreground process나 hook이, 상태는
 * hook만 알린다. shell main이 정하고 바뀔 때마다 runtime을 다시 보낸다.
 */
export type TerminalAgent = {
  /** harness id(`claude`, `codex`, `opencode`, `pi`, ...). 탭 icon을 고른다. */
  harness: string;
  /** 첫 hook 전이거나 사람이 Esc·Ctrl-C로 끊은 뒤는 unknown이다. */
  state: "running" | "waiting" | "idle" | "unknown";
  /** 사람이 그 탭을 보지 않는 사이 turn이 끝났거나 물음이 왔다. 그 탭을 고르면 지워진다. */
  unseen: boolean;
  /** 이 harness의 hook을 한 번이라도 들었다. 끊어서 state가 unknown이 돼도 남는다. */
  hooked: boolean;
  /** hook이 알려 준 harness의 session id. 저장한 session과 이 터미널을 잇는다. */
  session?: string;
  /** 그 session의 첫 prompt 한 줄. 모르면 없다. */
  title?: string;
};

/**
 * lophn 터미널에서 hook이 session id를 알려 준 coding agent session 하나. shell main이 project마다 저장한다.
 * 상태(running·waiting)는 저장하지 않는다.
 */
export type TerminalAgentSession = {
  harness: string;
  external_session: string;
  project: string;
  folder_ref: string;
  cwd: string;
  /** 첫 prompt 한 줄. 모르면 null이다. */
  title: string | null;
  /** epoch ms. */
  started_at: number;
  last_at: number;
  /** harness에 resume 규칙이 있어 다시 열 수 있다. */
  resumable: boolean;
};

/** 그 project의 저장한 session이 바뀌었다. 새것부터다. */
export type TerminalAgentSessionsChanged = {
  project: string;
  sessions: TerminalAgentSession[];
};

export type TerminalRuntime = {
  terminal_ref: string;
  project: string;
  folder_ref: string;
  cwd_at_start: string;
  program_path: string;
  state: TerminalStateName;
  generation: number;
  columns: number;
  rows: number;
  exit_code: number | null;
  failure_reason: TerminalFailure | null;
  output_seq: number;
  dropped_output: boolean;
  /** 지금 이 터미널에서 도는 coding agent. 없으면 없다. */
  agent?: TerminalAgent;
};

/** OS 알림을 누르면 main이 그 터미널 탭을 고르라고 보낸다. */
export type TerminalReveal = { terminal_ref: string };

export type TerminalOutput = {
  terminal_ref: string;
  generation: number;
  seq: number;
  chunk: string;
  dropped_output: boolean;
};

export type TerminalFolderChoice = { folder_ref: string; path: string };

type TerminalReject = {
  ok: false;
  reason: TerminalFailure;
  message: string;
  /** choose_folder일 때 고를 수 있는 등록 폴더. */
  folders?: TerminalFolderChoice[];
};

type TerminalAccept = { ok: true; runtime: TerminalRuntime };
export type TerminalReply = TerminalAccept | TerminalReject;

/**
 * 살아 있는 host buffer를 다시 읽은 결과. runtime은 지금 상태(종료·exit
 * code·결과 불명)이고 output은 after_seq 뒤의 chunk다.
 */
export type TerminalSnapshotReply = {
  ok: true;
  runtime: TerminalRuntime;
  output: TerminalOutput[];
};

/** IPC 경계의 결과. main의 guard 거절은 error다. */
export type TerminalCall<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: {
        code: "invalid_input" | "forbidden" | "unavailable";
        message: string;
      };
    };

/** preload가 shell renderer에 여는 터미널 통로. renderer는 PTY를 직접 갖지 않는다. */
export interface TerminalApi {
  open(input: TerminalOpen): Promise<TerminalCall<TerminalReply>>;
  input(input: TerminalInput): Promise<TerminalCall<TerminalReply>>;
  resize(input: TerminalResize): Promise<TerminalCall<TerminalReply>>;
  close(input: TerminalClose): Promise<TerminalCall<TerminalReply>>;
  restart(input: TerminalClose): Promise<TerminalCall<TerminalReply>>;
  snapshot(
    input: TerminalSnapshot,
  ): Promise<TerminalCall<TerminalSnapshotReply | TerminalReject>>;
  focus(input: TerminalFocus): Promise<TerminalCall<null>>;
  /** terminal에서 Ctrl/Cmd-click한 link를 main에 넘긴다. */
  openLink(input: TerminalLink): Promise<TerminalCall<null>>;
  /** main이 push한 bridge 요청에 browser 탭을 열었는지 답한다. */
  ackBridgeOpen(input: TerminalBridgeAck): Promise<TerminalCall<null>>;
  /** main이 URL을 browser 탭으로 열어 달라고 push한다. 구독 해지를 돌려준다. */
  onBridgeOpen(listener: (open: TerminalBridgeOpen) => void): () => void;
  /** main이 새 터미널을 열거나 상태가 바뀔 때마다 runtime을 보낸다. 구독 해지를 돌려준다. */
  onRuntime(listener: (runtime: TerminalRuntime) => void): () => void;
  /** main이 그 터미널 탭을 골라 보이라고 보낸다(OS 알림 누름). 구독 해지를 돌려준다. */
  onReveal(listener: (reveal: TerminalReveal) => void): () => void;
  /** 그 project에서 저장한 coding agent session. 새것부터다. */
  agentSessions(
    input: TerminalAgentSessionsQuery,
  ): Promise<TerminalCall<TerminalAgentSession[]>>;
  /** 저장한 session이 바뀔 때마다 그 project의 목록을 보낸다. 구독 해지를 돌려준다. */
  onAgentSessions(
    listener: (change: TerminalAgentSessionsChanged) => void,
  ): () => void;
}

export const TERMINAL_STATE_CHANNEL = "shell:terminal-state";
export const TERMINAL_OPEN_CHANNEL = "shell:terminal-open";
export const TERMINAL_INPUT_CHANNEL = "shell:terminal-input";
export const TERMINAL_RESIZE_CHANNEL = "shell:terminal-resize";
export const TERMINAL_CLOSE_CHANNEL = "shell:terminal-close";
export const TERMINAL_RESTART_CHANNEL = "shell:terminal-restart";
export const TERMINAL_SNAPSHOT_CHANNEL = "shell:terminal-snapshot";
export const TERMINAL_FOCUS_CHANNEL = "shell:terminal-focus";
export const TERMINAL_LINK_CHANNEL = "shell:terminal-link";
export const TERMINAL_BRIDGE_ACK_CHANNEL = "shell:terminal-bridge-ack";
export const TERMINAL_BRIDGE_OPEN_CHANNEL = "shell:terminal-bridge-open";
export const TERMINAL_REVEAL_CHANNEL = "shell:terminal-reveal";
export const TERMINAL_AGENT_SESSIONS_CHANNEL = "shell:terminal-agent-sessions";
export const TERMINAL_AGENT_SESSIONS_CHANGED_CHANNEL =
  "shell:terminal-agent-sessions-changed";
