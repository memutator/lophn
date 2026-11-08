// preload의 터미널 통로(lophnTerminal)가 없는 일반 browser용 가짜. PTY 없이 터미널 탭이 열린 모양을
// 보이려고, 열면 running으로 답하고 정해 둔 출력을 준다. 입력은 그대로 되돌려 보여 준다.
import type {
  TerminalAgent,
  TerminalApi,
  TerminalCall,
  TerminalOutput,
  TerminalRuntime,
} from "../../../packages/shell/ipc/terminal.ts";

const PROMPT = "\x1b[32mmina@lophn\x1b[0m:\x1b[34m~/Documents/grocery\x1b[0m$ ";
const FIRST = [
  `${PROMPT}ls\r\n`,
  "budget.md  receipts.md  plan.md  weekly\r\n",
  `${PROMPT}git status --short\r\n`,
  " M budget.md\r\n",
  PROMPT,
].join("");

function ok<T>(value: T): Promise<TerminalCall<T>> {
  return Promise.resolve({ ok: true, value });
}

/** `agent`를 주면 그 터미널에서 coding agent가 도는 것으로 runtime이 알린다. */
export function fakeTerminal(
  project: string,
  agent?: TerminalAgent,
): TerminalApi {
  const listeners = new Set<(output: readonly TerminalOutput[]) => void>();
  const ref = "term_gallery";
  const chunks: TerminalOutput[] = [
    {
      terminal_ref: ref,
      generation: 1,
      seq: 1,
      chunk: FIRST,
      dropped_output: false,
    },
  ];
  const runtime = (): TerminalRuntime => ({
    terminal_ref: ref,
    project,
    folder_ref: "fld_gallery",
    cwd_at_start: "/home/mina/Documents/grocery",
    program_path: "/bin/bash",
    state: "running",
    generation: 1,
    columns: 80,
    rows: 24,
    exit_code: null,
    failure_reason: null,
    output_seq: chunks.length,
    dropped_output: false,
    ...(agent === undefined ? {} : { agent }),
  });
  return {
    open: () => ok({ ok: true, runtime: runtime() }),
    restart: () => ok({ ok: true, runtime: runtime() }),
    close: () => ok({ ok: true, runtime: runtime() }),
    resize: () => ok({ ok: true, runtime: runtime() }),
    input({ text }) {
      chunks.push({
        terminal_ref: ref,
        generation: 1,
        seq: chunks.length + 1,
        chunk: text === "\r" ? `\r\n${PROMPT}` : text,
        dropped_output: false,
      });
      for (const listener of listeners) listener([chunks.at(-1)!]);
      return ok({ ok: true, runtime: runtime() });
    },
    respond: () => ok({ ok: true, runtime: runtime() }),
    onOutput(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot({ after_seq }) {
      const after = after_seq ?? 0;
      return ok({
        ok: true,
        runtime: runtime(),
        output: chunks.filter((chunk) => chunk.seq > after),
      });
    },
    focus: () => ok(null),
    setTabName: () => ok(null),
    onRuntime: () => () => {},
    openLink: () => ok(null),
    copy: () => ok(null),
    paste: () => ok(""),
    trace: () => ok(false),
    ackBridgeOpen: () => ok(null),
    onBridgeOpen: () => () => {},
    onReveal: () => () => {},
    agentSessions: () => ok([]),
    renameAgentSession: () => ok([]),
    onAgentSessions: () => () => {},
  };
}
