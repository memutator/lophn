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

export type TerminalReject = {
  ok: false;
  reason: TerminalFailure;
  message: string;
};

export type TerminalAccept = { ok: true; runtime: TerminalRuntime };
export type TerminalReply = TerminalAccept | TerminalReject;

export const TERMINAL_OUTPUT_CHANNEL = "shell:terminal-output";
export const TERMINAL_STATE_CHANNEL = "shell:terminal-state";
export const TERMINAL_OPEN_CHANNEL = "shell:terminal-open";
export const TERMINAL_INPUT_CHANNEL = "shell:terminal-input";
export const TERMINAL_RESIZE_CHANNEL = "shell:terminal-resize";
export const TERMINAL_CLOSE_CHANNEL = "shell:terminal-close";
export const TERMINAL_RESTART_CHANNEL = "shell:terminal-restart";
export const TERMINAL_SNAPSHOT_CHANNEL = "shell:terminal-snapshot";
