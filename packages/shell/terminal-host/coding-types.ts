// host main.ts가 coding TUI 시작을 받는 모양이다. contracts를 import하지 않아 shell tsc와 node 시험이 이
// 파일만 따라간다. 구현(launch-plan.ts)은 contracts의 LaunchPlan을 검사하고 이 모양을 채운다.

import type { PromptOutcome, TerminalFailure } from "../ipc/terminal.ts";

export type PromptDeliveryInput =
  | { mode: "argv" }
  | { mode: "stdin_after_ready"; readiness: string; deadline_ms: number };

/** host가 runtime을 만들 때 읽는 plan 값이다. */
export type CodingPlanView = {
  project: string;
  folder_ref: string;
  ticket: string;
  connection: string;
  operation_id: string;
  prompt_delivery: PromptDeliveryInput;
};

export type CodingLaunch = {
  plan: CodingPlanView;
  file: string;
  /** `argv[0]`은 명령 이름이라 빼고 executable에 넘기는 인자다. */
  args: string[];
  cwd: string;
  /** observe 경로를 더하기 전의 환경이다. */
  baseEnv: Record<string, string>;
  /** 설치된 helper 절대 경로(loader identity). 있으면 TUI 아래 MCP·CLI process를 관측한다. */
  credential_helper?: string;
};

export type PrepareContext = {
  env: Readonly<Record<string, string | undefined>>;
  /** main이 준 설치 helper 절대 경로. 절대 경로가 아니면 관측하지 않는다. */
  credential_helper?: string;
  checkFolder: (
    path: string,
  ) => { ok: true; path: string } | {
    ok: false;
    reason: "not_directory" | "unreadable";
  };
};

export type PrepareResult =
  | { ok: true; launch: CodingLaunch }
  | { ok: false; reason: TerminalFailure; message: string };

export type CodingAttachment = {
  /** socket을 열고 starting 관측을 낸다. 환경에 더할 observe 경로를 돌려준다. */
  begin(): Promise<{ ok: true; env: Record<string, string> } | { ok: false }>;
  /** PTY가 열렸다. 첫 hook 전까지 지금 상태는 unknown이고 prompt 기한이 시작한다. */
  spawned(write: (text: string) => void, pid?: number): void;
  output(chunk: string): void;
  /** 연결된 process exit. ended는 ticket 완료나 claim 해제가 아니다. */
  exited(): void;
  /** 종료를 확인하지 못했거나 수집이 끊겼다. */
  lost(reason: string): void;
  /** spawn 전에 실패했다. socket만 정리한다. */
  abandon(): void;
};

export type CodingHost = {
  prepare(raw: unknown, context: PrepareContext): PrepareResult;
  attach(
    launch: CodingLaunch,
    ref: { runtime_ref: string; generation: number },
    onPrompt: (outcome: PromptOutcome) => void,
  ): CodingAttachment;
};
