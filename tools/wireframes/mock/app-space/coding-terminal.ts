// lophn이 연 coding 터미널의 가짜 통로. 앱 공간 pane은 core 요청으로 열린 runtime에 붙을 뿐이라, 이 통로가 runtime 하나를
// 알리고(emit) 정해 둔 TUI 출력을 준다. 입력은 받지만 아무 일도 하지 않는다.
import type {
  TerminalApi,
  TerminalCall,
  TerminalOutput,
  TerminalRuntime,
} from "../../../../packages/shell/ipc/terminal.ts";
import { TASK } from "./data.ts";

export type CodingScene = "running" | "permission" | "ended";

const CODING_SESSION = "ses_01h455vb4pex5v6nkc6gd5fd03";
const REF = "term_coding";

const HEAD = "✻ Claude Code\n  /home/mina/.lophn/apps/orders/source";

const WORK = [
  `> ${TASK}.`,
  "  Expected 42.00, got 41.99 for order 1042.",
  "",
  "● Read(src/orders/totals.ts)",
  "  ⎿  Read 64 lines",
  "● Update(src/orders/totals.ts)",
  "  ⎿  Updated src/orders/totals.ts with 3 additions",
].join("\n");

const ASK = [
  "",
  "Bash command",
  "  git diff --stat origin/main",
  "",
  " Do you want to proceed?",
  " ❯ 1. Yes",
  "   2. Yes, and don't ask again for git diff",
  "   3. No, and tell Claude what to do (esc)",
].join("\n");

function screen(scene: CodingScene): string {
  const text = scene === "running"
    ? `${HEAD}\n\n${WORK}\n\n✻ Running the tests… (42s · esc to interrupt)\n\n> `
    : scene === "permission"
    ? `${HEAD}\n\n${WORK}\n${ASK}`
    : `${HEAD}\n\n${WORK}\n\n● Done. Discounted totals now round to the nearest cent.\n`;
  return text.replaceAll("\n", "\r\n");
}

interface CodingBridge extends TerminalApi {
  /** lophn이 터미널을 열었다고 알린다. */
  emit(): void;
}

const ok = <T>(value: T): Promise<TerminalCall<T>> =>
  Promise.resolve({ ok: true, value });

export function codingBridge(
  scene: CodingScene,
  project: string,
): CodingBridge {
  const listeners = new Set<(runtime: TerminalRuntime) => void>();
  const chunk: TerminalOutput = {
    terminal_ref: REF,
    generation: 1,
    seq: 1,
    chunk: screen(scene),
    dropped_output: false,
  };
  const runtime = (): TerminalRuntime => ({
    terminal_ref: REF,
    project,
    folder_ref: "fld_gallery",
    cwd_at_start: "/home/mina/.lophn/apps/orders/source",
    program_path: "/usr/bin/claude",
    launch_kind: "coding_tui",
    state: scene === "ended" ? "exited" : "running",
    generation: 1,
    columns: 80,
    rows: 24,
    exit_code: scene === "ended" ? 0 : null,
    failure_reason: null,
    output_seq: 1,
    dropped_output: false,
    coding_session: {
      session: CODING_SESSION,
      app: "app_01h455vb4pex5v6nkc6gd5fd01",
      prompt: "delivered",
    },
    title: "lophn coding · Claude Code",
    product: "Claude Code",
  });
  const reply = () => ok({ ok: true as const, runtime: runtime() });
  return {
    emit() {
      for (const listener of [...listeners]) listener(runtime());
    },
    open: reply,
    input: reply,
    resize: reply,
    close: reply,
    restart: reply,
    snapshot: ({ after_seq }) =>
      ok({
        ok: true as const,
        runtime: runtime(),
        output: (after_seq ?? 0) < chunk.seq ? [chunk] : [],
      }),
    focus: () => ok(null),
    focusSession: reply,
    openLink: () => ok(null),
    ackBridgeOpen: () => ok(null),
    onBridgeOpen: () => () => {},
    onRuntime(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
