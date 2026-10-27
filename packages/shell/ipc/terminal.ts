// terminal host와 shell renderer 사이 경계. renderer는 PTY를 직접 갖지 않는다.
import { z } from "zod";

const ref = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/);
const generation = z.number().int().positive();

export const terminalOpenSchema = z
  .object({
    project: ref,
    folder_ref: ref.optional(),
  })
  .strict();

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

/** 대기 목록에서 누른 coding session의 터미널 탭을 고른다. */
export const terminalFocusSessionSchema = z
  .object({
    session: z.string().regex(/^ses_[0-7][0-9a-hjkmnp-tv-z]{25}$/),
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

export type TerminalOpen = { project: string; folder_ref?: string };
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

export type TerminalFocusSession = { session: string };
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
  | "host_lost"
  | "no_terminal";

/** coding TUI의 첫 prompt 전달 결과. argv는 `none`, 입력 전달은 pending에서 셋 중 하나로 끝난다. */
type PromptOutcome = "none" | "pending" | "delivered" | "not_delivered";

/** coding session의 터미널 탭 표지. coding 탭은 제목으로 구별하고 끝나면 끝난 상태로만 보인다. */
type TerminalCodingSession = {
  session: string;
  app: string;
  prompt: PromptOutcome;
};

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
};

export type TerminalRuntime = {
  terminal_ref: string;
  project: string;
  folder_ref: string;
  cwd_at_start: string;
  program_path: string;
  launch_kind: "shell" | "coding_tui";
  state: TerminalStateName;
  generation: number;
  columns: number;
  rows: number;
  exit_code: number | null;
  failure_reason: TerminalFailure | null;
  output_seq: number;
  dropped_output: boolean;
  /** coding session의 탭일 때만 있다. */
  coding_session?: TerminalCodingSession;
  /** 탭 제목이다. coding 탭은 제목으로 구별한다. */
  title?: string;
  /** 탭 icon을 고르는 제품 이름(harness id)이다. */
  product?: string;
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
  /** 그 session의 터미널 탭을 고른다. 없으면 `no_terminal`로 거절한다. */
  focusSession(
    input: TerminalFocusSession,
  ): Promise<TerminalCall<TerminalReply>>;
  /** terminal에서 Ctrl/Cmd-click한 link를 main에 넘긴다. */
  openLink(input: TerminalLink): Promise<TerminalCall<null>>;
  /** main이 push한 bridge 요청에 browser 탭을 열었는지 답한다. */
  ackBridgeOpen(input: TerminalBridgeAck): Promise<TerminalCall<null>>;
  /** main이 URL을 browser 탭으로 열어 달라고 push한다. 구독 해지를 돌려준다. */
  onBridgeOpen(listener: (open: TerminalBridgeOpen) => void): () => void;
  /** main이 새 터미널(coding 탭 포함)을 열거나 상태가 바뀔 때마다 runtime을 보낸다. 구독 해지를 돌려준다. */
  onRuntime(listener: (runtime: TerminalRuntime) => void): () => void;
  /** main이 그 터미널 탭을 골라 보이라고 보낸다(OS 알림 누름). 구독 해지를 돌려준다. */
  onReveal(listener: (reveal: TerminalReveal) => void): () => void;
}

export const TERMINAL_STATE_CHANNEL = "shell:terminal-state";
export const TERMINAL_OPEN_CHANNEL = "shell:terminal-open";
export const TERMINAL_INPUT_CHANNEL = "shell:terminal-input";
export const TERMINAL_RESIZE_CHANNEL = "shell:terminal-resize";
export const TERMINAL_CLOSE_CHANNEL = "shell:terminal-close";
export const TERMINAL_RESTART_CHANNEL = "shell:terminal-restart";
export const TERMINAL_SNAPSHOT_CHANNEL = "shell:terminal-snapshot";
export const TERMINAL_FOCUS_CHANNEL = "shell:terminal-focus";
export const TERMINAL_FOCUS_SESSION_CHANNEL = "shell:terminal-focus-session";
export const TERMINAL_LINK_CHANNEL = "shell:terminal-link";
export const TERMINAL_BRIDGE_ACK_CHANNEL = "shell:terminal-bridge-ack";
export const TERMINAL_BRIDGE_OPEN_CHANNEL = "shell:terminal-bridge-open";
export const TERMINAL_REVEAL_CHANNEL = "shell:terminal-reveal";
