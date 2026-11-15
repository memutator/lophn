// 폰이 연 coding session(core의 `coding_open`)을 desktop에 연다. 그 project를 보이는 창에 coding 탭 열기를 넣어 새 터미널이
// `<harness> gui`(되살리면 `--resume <id>`)를 치게 하고(사람이 친 것과 같은 길: hook → `gui.request` → extension이 handle을 연다),
// 그 project의 터미널에 그 harness의 새 handle이 생길 때까지 기다린다. Electron을 모르고 deps로만 일한다.
import {
  type GuiHarness,
  isGuiHarness,
} from "../../../protocol/extensions/mod.ts";
import type { TabGui } from "./gui.ts";

// core가 연결 요청을 60초 기다린다. 그보다 먼저 답해야 이유가 폰에 닿는다.
const OPEN_WAIT_MS = 55_000;

export type CodingOpenDeps = {
  gui: Pick<TabGui, "onHandle" | "tabSessions">;
  /** 그 터미널의 project. 없는 터미널이면 undefined. */
  projectOf(terminalRef: string): string | undefined;
  /** 그 project를 보이는 창에 coding 탭 열기를 넣는다. 창이 탭을 열었다고 답하면 true다. */
  openTab(input: {
    project: string;
    harness: GuiHarness;
    resume: string | null;
  }): Promise<boolean>;
  after(ms: number, run: () => void): () => void;
};

export type CodingOpenResult =
  | { ok: true; terminal_ref: string }
  | {
      ok: false;
      code: "invalid_input" | "conflict" | "unavailable";
      message: string;
    };

export function createCodingOpen(deps: CodingOpenDeps) {
  return async function open(input: {
    project: string;
    harness: string;
    /** 이어 열 CLI session id. */
    resume?: string;
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
      deps.gui.tabSessions().some((one) => one.cli_session === resume)
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
    let settle: (terminalRef: string | null) => void = () => {};
    const started = new Promise<string | null>((resolve) => {
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
        settle(handle.terminal);
      }
    });
    replaying = false;
    const cancel = deps.after(OPEN_WAIT_MS, () => settle(null));
    try {
      const opened = await deps.openTab({
        project,
        harness,
        resume: resume ?? null,
      });
      if (!opened) {
        return {
          ok: false,
          code: "unavailable",
          message:
            "No lophn window on the computer shows this project, so the terminal tab was not opened. Open the project on the computer.",
        };
      }
      const terminalRef = await started;
      return terminalRef === null
        ? {
            ok: false,
            code: "unavailable",
            message: "The coding agent did not start in chat view in time.",
          }
        : { ok: true, terminal_ref: terminalRef };
    } finally {
      off();
      cancel();
    }
  };
}
