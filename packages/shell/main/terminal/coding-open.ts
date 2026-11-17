// 폰이 연 coding session(core의 `coding_open`)과 터미널(`terminal_open`)을 desktop에 연다. 그 project를 보이는 창에(없으면 focus 없이 그
// project의 창을 하나 열어) 탭 열기를 넣는다. coding session은 새 터미널이
// `<harness> gui`(되살리면 `--resume <id>`)를 치게 하고(사람이 친 것과 같은 길: hook → `gui.request` → extension이 handle을 연다),
// 그 project의 터미널에 그 harness의 새 handle이 생길 때까지 기다린다. 되살리면 그 ledger session을 그 터미널이 끝날 때까지
// hold해 headless turn이 같은 CLI session에 둘째 process를 띄우지 않게 한다. Electron을 모르고 deps로만 일한다.
import {
  type GuiHarness,
  isGuiHarness,
} from "../../../protocol/extensions/mod.ts";
import type { TabGui, TabHandle } from "./gui.ts";

// core가 연결 요청을 60초 기다린다. 그보다 먼저 답해야 이유가 폰에 닿는다.
const OPEN_WAIT_MS = 55_000;
const NO_WINDOW =
  "The lophn app could not open a window for this project on the computer, so the terminal tab was not opened. Try again; if it fails again, open the project on the computer.";

export type CodingOpenDeps = {
  gui: Pick<TabGui, "onHandle" | "tabSessions">;
  /** 그 터미널의 project. 없는 터미널이면 undefined. */
  projectOf(terminalRef: string): string | undefined;
  /** 그 project를 보이는 창(없으면 새로 연 창)에 coding 탭 열기를 넣는다. 창이 탭을 열었다고 답하면 true다. */
  openTab(input: {
    project: string;
    harness: GuiHarness;
    resume: string | null;
  }): Promise<boolean>;
  after(ms: number, run: () => void): () => void;
  /** resume이면 그 ledger session을 TUI 탭처럼 hold한다(`HarnessTui.holdGui`). 여는 동안부터 그 터미널이 끝날 때까지다. */
  hold(key: string, session: string): void;
  release(key: string): void;
  /** 그 터미널이 끝나면(process가 끝났거나 terminal host가 사라졌다) 한 번 부른다. */
  onTerminalEnd(terminalRef: string, run: () => void): void;
};

export type CodingOpenResult =
  | { ok: true; terminal_ref: string }
  | {
      ok: false;
      code: "invalid_input" | "conflict" | "unavailable";
      message: string;
    };

export function createCodingOpen(deps: CodingOpenDeps) {
  let opens = 0;
  return async function open(input: {
    project: string;
    harness: string;
    /** 이어 열 ledger session과 그 CLI session id. */
    resume?: { session: string; cli_session: string };
  }): Promise<CodingOpenResult> {
    const { project, harness, resume } = input;
    if (!isGuiHarness(harness)) {
      return {
        ok: false,
        code: "invalid_input",
        message: `${harness} cannot open as chat.`,
      };
    }
    // 한 CLI session에 process 둘을 띄우지 않는다.
    if (
      resume !== undefined &&
      deps.gui
        .tabSessions()
        .some((one) => one.cli_session === resume.cli_session)
    ) {
      return {
        ok: false,
        code: "conflict",
        message: "This session is already open on the computer.",
      };
    }
    // 탭 열기 전에 듣는다. 이미 handle이 있던 터미널(구독할 때 한 번씩 받는다)은 새것이 아니다.
    const known = new Set<string>();
    let replaying = true;
    let settle: (handle: TabHandle | null) => void = () => {};
    const started = new Promise<TabHandle | null>((resolve) => {
      settle = resolve;
    });
    const off = deps.gui.onHandle((handle) => {
      if (replaying) {
        known.add(handle.terminal);
        return;
      }
      if (
        handle.harness === harness &&
        !known.has(handle.terminal) &&
        deps.projectOf(handle.terminal) === project
      ) {
        settle(handle);
      }
    });
    replaying = false;
    const cancel = deps.after(OPEN_WAIT_MS, () => settle(null));
    // core가 건 30초 예약이 끝나기 전에, 탭이 열리기 전부터 쥔다. 실패하면 놓고 성공하면 그 터미널이 끝날 때 놓는다.
    const key = `open-${++opens}`;
    if (resume !== undefined) deps.hold(key, resume.session);
    let holding = false;
    try {
      const opened = await deps.openTab({
        project,
        harness,
        resume: resume?.cli_session ?? null,
      });
      if (!opened) {
        return {
          ok: false,
          code: "unavailable",
          message: NO_WINDOW,
        };
      }
      const handle = await started;
      if (handle === null) {
        return {
          ok: false,
          code: "unavailable",
          message: "The coding agent did not start in chat view in time.",
        };
      }
      if (resume !== undefined) {
        holding = true;
        // handle이 닫혀도 놓지 않는다: 사람이 채팅을 터미널로 바꾸면 handle은 닫히고 같은 CLI session을 그 터미널의 TUI가 이어 쓴다.
        deps.onTerminalEnd(handle.terminal, () => deps.release(key));
      }
      return { ok: true, terminal_ref: handle.terminal };
    } finally {
      off();
      cancel();
      if (!holding) deps.release(key);
    }
  };
}

export type TerminalOpenDeps = {
  /** 그 project를 보이는 창(없으면 새로 연 창)에 터미널 탭 열기를 넣는다. 창이 탭을 열었다고 답하면 true다. */
  openTab(project: string): Promise<boolean>;
  /** 지금 있는 터미널. */
  terminals(): readonly string[];
  /** host가 알린 runtime을 듣는다. 돌려받은 함수로 그만 듣는다. */
  onRuntime(
    listener: (runtime: { terminal_ref: string; project: string }) => void,
  ): () => void;
  after(ms: number, run: () => void): () => void;
};

/** 폰이 연 터미널. 탭을 연 뒤 그 project에 처음 생긴 터미널이 그 탭의 것이다. */
export function createTerminalOpen(deps: TerminalOpenDeps) {
  return async function open(project: string): Promise<CodingOpenResult> {
    const before = new Set(deps.terminals());
    let settle: (terminal: string | null) => void = () => {};
    const started = new Promise<string | null>((resolve) => {
      settle = resolve;
    });
    const off = deps.onRuntime((runtime) => {
      if (!before.has(runtime.terminal_ref) && runtime.project === project) {
        settle(runtime.terminal_ref);
      }
    });
    const cancel = deps.after(OPEN_WAIT_MS, () => settle(null));
    try {
      if (!(await deps.openTab(project))) {
        return { ok: false, code: "unavailable", message: NO_WINDOW };
      }
      const terminal = await started;
      return terminal === null
        ? {
            ok: false,
            code: "unavailable",
            message: "The terminal did not start in time.",
          }
        : { ok: true, terminal_ref: terminal };
    } finally {
      off();
      cancel();
    }
  };
}
