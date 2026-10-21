// host main.ts가 coding TUI 시작을 받는 모양이다. 구현(launch-plan.ts)은 protocol의 plan schema로 검사하고
// 이 모양을 채운다. main.ts는 protocol을 import하지 않는다.

import type { TerminalFailure } from "../ipc/terminal.ts";

/** host가 runtime을 만들 때 읽는 plan 값이다. */
type CodingPlanView = {
  session: string;
  app: string;
  harness_id: string;
  title: string;
  /** `argv`면 첫 prompt가 argv로 이미 넘어갔다. 아니면 core가 hook을 받은 뒤 `input`으로 보낸다. */
  prompt_by_argv: boolean;
};

type CodingLaunch = {
  plan: CodingPlanView;
  file: string;
  /** `argv[0]`은 명령 이름이라 빼고 executable에 넘기는 인자다. */
  args: string[];
  cwd: string;
  env: Record<string, string>;
};

type PrepareContext = {
  env: Readonly<Record<string, string | undefined>>;
  checkFolder: (
    path: string,
  ) => { ok: true; path: string } | {
    ok: false;
    reason: "not_directory" | "unreadable";
  };
};

type PrepareResult =
  | { ok: true; launch: CodingLaunch }
  | { ok: false; reason: TerminalFailure; message: string };

export type CodingHost = {
  prepare(raw: unknown, context: PrepareContext): PrepareResult;
};
