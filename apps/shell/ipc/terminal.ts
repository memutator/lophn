// terminal host와 shell renderer 사이 경계. renderer는 PTY를 직접 갖지 않는다.
import { z } from "zod";

const ref = z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/);
const generation = z.number().int().positive();

export const terminalOpenSchema = z.object({
  project: ref,
  folder_ref: ref.optional(),
}).strict();

export const terminalInputSchema = z.object({
  terminal_ref: ref,
  generation,
  text: z.string().max(8192),
}).strict();

export const terminalResizeSchema = z.object({
  terminal_ref: ref,
  generation,
  columns: z.number().int().min(1).max(512),
  rows: z.number().int().min(1).max(256),
}).strict();

export const terminalCloseSchema = z.object({
  terminal_ref: ref,
  generation,
}).strict();

export const terminalRestartSchema = z.object({
  terminal_ref: ref,
  generation,
}).strict();

export const terminalSnapshotSchema = z.object({
  terminal_ref: ref,
  /** 이 seq 뒤의 chunk만 받는다. 없으면 살아 있는 buffer 전체다. */
  after_seq: z.number().int().min(0).optional(),
}).strict();

/** 사람이 고른 탭이 이 터미널인지. main의 focus 표가 입력 검사에 쓴다. */
export const terminalFocusSchema = z.object({
  terminal_ref: ref,
  generation,
  focused: z.boolean(),
}).strict();

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

export type TerminalStateName = "starting" | "running" | "exited" | "unknown";

export type TerminalFailure =
  | "no_folder"
  | "choose_folder"
  | "not_directory"
  | "unreadable"
  | "spawn_failed"
  | "kill_unconfirmed"
  | "host_lost";

export type TerminalRuntime = {
  terminal_ref: string;
  project: string;
  folder_ref: string;
  cwd_at_start: string;
  program_path: string;
  launch_kind: "shell";
  state: TerminalStateName;
  generation: number;
  columns: number;
  rows: number;
  exit_code: number | null;
  failure_reason: TerminalFailure | null;
  output_seq: number;
  dropped_output: boolean;
};

export type TerminalOutput = {
  terminal_ref: string;
  generation: number;
  seq: number;
  chunk: string;
  dropped_output: boolean;
};

export type TerminalFolderChoice = { folder_ref: string; path: string };

export type TerminalReject = {
  ok: false;
  reason: TerminalFailure;
  message: string;
  /** choose_folder일 때 고를 수 있는 등록 폴더. */
  folders?: TerminalFolderChoice[];
};

export type TerminalAccept = { ok: true; runtime: TerminalRuntime };
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
}

export const TERMINAL_OUTPUT_CHANNEL = "shell:terminal-output";
export const TERMINAL_STATE_CHANNEL = "shell:terminal-state";
export const TERMINAL_OPEN_CHANNEL = "shell:terminal-open";
export const TERMINAL_INPUT_CHANNEL = "shell:terminal-input";
export const TERMINAL_RESIZE_CHANNEL = "shell:terminal-resize";
export const TERMINAL_CLOSE_CHANNEL = "shell:terminal-close";
export const TERMINAL_RESTART_CHANNEL = "shell:terminal-restart";
export const TERMINAL_SNAPSHOT_CHANNEL = "shell:terminal-snapshot";
export const TERMINAL_FOCUS_CHANNEL = "shell:terminal-focus";
