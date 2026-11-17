// harness 하나를 ACP로 옮기는 adapter와 harness마다의 표.
import type { Clock } from "../../../../../base/clock.ts";
import type { IdSource } from "../../../../../base/id.ts";
import type { Result } from "../../../../../base/result.ts";
import type {
  AcpCliSession,
  AcpRewindPreview,
  AcpSessionHandle,
  AcpTerminal,
  ExtensionSpawn,
  GuiHarness,
} from "../../../../../protocol/extensions/mod.ts";
import { antigravityAdapter } from "./antigravity.ts";
import { claudeAdapter } from "./claude.ts";
import { codexAdapter } from "./codex.ts";
import { ompAdapter } from "./omp.ts";
import { opencodeAdapter } from "./opencode.ts";

/**
 * 사람이 GUI에서 고른 값 가운데 CLI가 그 session에 남기지 않는 것. 탭이 run을 넘어 들고 있다가 다음 `start`에 준다
 * (resume, TUI → GUI, `<harness> gui`를 다시 칠 때). 고르지 않은 칸은 없다.
 */
export type HarnessGuiCarry = {
  model?: string;
  effort?: string;
  mode?: string;
};

/** 도는 CLI 하나. restart는 `stop()`이 끝난 뒤 `tuiCommand()`를 치고, shared는 `stop()` 없이 친다. */
export type HarnessGuiRun = {
  /** process가 끝날 때까지 기다린다. */
  stop(): Promise<void>;
  /** 그 session을 TUI로 이을 명령. restart는 resume과 넘길 flag, shared는 같은 server에 붙는 client다. */
  tuiCommand(): string;
  /** 그 CLI 자신의 session id. 모르면 null. */
  sessionId(): string | null;
  /** 다음 run이 이어 갈 값. 그 값을 CLI가 session에 남기는 harness(Codex, OpenCode, omp)는 두지 않는다. */
  carry?(): HarnessGuiCarry;
  /** restart 전 modal이 "멈출 것"을 말하게 한다. `tasks`는 ACP `tasks` 중 `state: running`인 수다. */
  running(): { turn: boolean; tasks: number };
  /** 그 CLI가 이 폴더에서 가진 지난 session, 최근 순. 없으면 `capabilities.resume`도 false다. */
  sessions?(): Promise<AcpCliSession[]>;
  /** 그 사람 메시지(ACP message id)로 rewind하면 되돌아갈 file. 없으면 `rewind_files`도 false다. */
  rewindPreview?(message: string): Promise<AcpRewindPreview>;
};

// 탭 하나의 GUI·TUI 전환 흐름(탭의 `AcpTerminal` 위에서). `handoff`가 어느 길인지 정한다.
// - restart (claude, omp, antigravity): CLI가 session을 한 번에 한 쪽만 쥔다.
//   GUI → TUI: `run.running()`이 turn이나 task를 말하면 modal → `await run.stop()`(process가 끝날 때까지)
//     → `terminal.type(run.tuiCommand() + "\r")`.
//   TUI → GUI: `terminal.state()`가 running·waiting이면 modal → `await adapter.exitTui(terminal)`
//     → `start({terminal, resume: terminal.sessionId()})`.
// - shared (codex, opencode): `start`가 탭 전용 server와 GUI를 띄우고 TUI는 그 server에 붙는 client다.
//   GUI → TUI: `terminal.state()`가 `shell`(PTY에 TUI client가 없다)일 때만 `terminal.type(run.tuiCommand() + "\r")`,
//     그 밖에는 화면만 바꾼다. `stop()`은 부르지 않는다.
//   TUI로 시작한 대화를 처음 GUI로 넘길 때는 restart와 같이 `exitTui` 뒤 `start({resume})`다.
export type HarnessGuiAdapter = {
  handoff: "restart" | "shared";
  /** CLI를 띄워 `session`에 ACP update를 내고 `session`의 입력을 CLI에 준다. 시작하지 못하면 오류다. */
  start(options: {
    /** 묶인 탭. null은 첫 판의 창 길이다(`gui-cleanup` 뒤 lead가 null과 `cwd`를 정리한다). */
    terminal: AcpTerminal | null;
    cwd: string;
    /** 그 CLI 자신의 session id. */
    resume?: string;
    /** 앞 run이 `carry()`로 넘긴 값. */
    carry?: HarnessGuiCarry;
    session: AcpSessionHandle;
    spawn: ExtensionSpawn;
    clock: Clock;
    ids: IdSource;
  }): Promise<Result<HarnessGuiRun>>;
  /** 그 탭 PTY의 TUI를 깔끔하게 끝내고 foreground가 끝날 때 resolve한다. */
  exitTui(terminal: AcpTerminal): Promise<Result<void>>;
};

export const HARNESS_GUI_ADAPTERS: Record<GuiHarness, HarnessGuiAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  opencode: opencodeAdapter,
  omp: ompAdapter,
  antigravity: antigravityAdapter,
};
