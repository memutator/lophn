// 터미널 module이 core의 다른 쪽에 내는 것과 받는 것이다. route handler, coding agent tracker, 폰의 터미널 보기, extension host가
// 이 port로 터미널에 닿고 PTY host와 그 줄은 모른다.
import type { z } from "zod";
import type { Result } from "../../base/mod.ts";
import type { terminalViewSnapshot } from "../../protocol/coding-agent/terminal-view.ts";
import type {
  TerminalAgent,
  TerminalOutput,
  TerminalProject,
  TerminalRuntime,
} from "../../protocol/coding-agent/terminals.ts";

// 열기. project는 Home(`home`)일 수 있고 그 폴더는 사람의 home 폴더다. cwd는 등록 폴더 안이어야 한다. command는 첫 출력 뒤 잠잠할 때 한 번 넣고, resume은 그 harness의 resume 명령을 친다.
export type TerminalOpen = {
  project: TerminalProject;
  folder_ref?: string;
  cwd?: string;
  command?: string;
  resume?: { harness: string; external_session: string };
};

// 터미널 하나를 열 때 그 PTY에 더할 env(hook socket, browser bridge)를 준다. 터미널 참조는 PTY host가 열면서 정하므로 env는 열기 전에
// 받고, 열린 뒤 `opened`로 그 터미널을(열지 못했으면 null을) 알린다. 터미널이 끝난 것은 `onRuntime`의 exited로 안다.
export type TerminalEnvHook = (open: TerminalOpen) => {
  env: Readonly<Record<string, string>>;
  opened(runtime: TerminalRuntime | null): void;
};

// host가 파싱해 둔 화면을 서식 run의 줄로 읽은 것(폰의 터미널 보기). lines는 viewport 전체이고 scrollback은 그 위 tail줄이다.
export type TerminalScreen = Omit<
  z.output<typeof terminalViewSnapshot.output>,
  "terminal" | "input"
>;

// foreground process의 argv가 바뀌었다. shell 자신이 foreground면 null이다.
export type TerminalForeground = {
  terminal_ref: string;
  generation: number;
  argv: string[] | null;
};

// 실패는 오류 code와 `details.reason`(TerminalFailure)이다.
export type Terminals = {
  open(input: TerminalOpen): Promise<Result<TerminalRuntime>>;
  close(terminal: string, generation: number): Promise<Result<TerminalRuntime>>;
  restart(
    terminal: string,
    generation: number,
  ): Promise<Result<TerminalRuntime>>;
  // human이면 사람(화면, 폰)이 친 것이라 `onHumanInput`이 듣는다. xterm의 질의 답이나 core가 치는 명령은 human이 아니다.
  write(
    terminal: string,
    text: string,
    options: { generation?: number; human: boolean },
  ): Promise<Result<void>>;
  // foreground process group에 보낸다. foreground가 shell이면 아무 일도 없다.
  signal(
    terminal: string,
    generation: number,
    signal: "SIGINT" | "SIGTERM",
  ): Promise<Result<void>>;
  // remote면 폰이 잡은 크기(`remote_size`)이고, 아니면 보이는 칸의 크기라 폰이 잡은 크기를 놓는다.
  resize(
    terminal: string,
    generation: number,
    size: { columns: number; rows: number },
    options: { remote: boolean },
  ): Promise<Result<TerminalRuntime>>;
  snapshot(
    terminal: string,
    afterSeq?: number,
  ): Promise<Result<{ runtime: TerminalRuntime; output: TerminalOutput[] }>>;
  screen(terminal: string, tail: number): Promise<Result<TerminalScreen>>;
  list(project?: TerminalProject): readonly TerminalRuntime[];
  runtime(terminal: string): TerminalRuntime | null;
  // tracker가 정한 agent(null이면 뺀다)와 탭 이름을 runtime에 싣는다. 바뀌면 `onRuntime`이 듣는다.
  patch(
    terminal: string,
    patch: { agent?: TerminalAgent | null; tab_name?: string },
  ): void;
  onRuntime(listener: (runtime: TerminalRuntime) => void): () => void;
  onOutput(listener: (output: readonly TerminalOutput[]) => void): () => void;
  onForeground(listener: (change: TerminalForeground) => void): () => void;
  onHumanInput(listener: (terminal: string, text: string) => void): () => void;
  useEnv(hook: TerminalEnvHook): () => void;
  // 살아 있는 터미널이 있다. 있는 동안 core는 스스로 끝나지 않는다.
  anyOpen(): boolean;
  // host stdin을 닫아 모든 PTY를 끝낸다.
  stop(): Promise<void>;
};

// 사람의 login shell env(PATH 등)와 `lophn` launcher 경로다. core가 OS 서비스로 떠도 터미널과 CLI가 사람의 환경을 받는다.
export type PersonEnv = {
  env(): Promise<Record<string, string>>;
  // 터미널과 extension이 부를 `lophn` launcher의 절대 경로. 모르면 null이다.
  cli: string | null;
};
