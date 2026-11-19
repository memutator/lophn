// 다른 기계의 터미널을 그리는 길. 그 기계의 날 출력(`TerminalOutputAppended`)은 기계 사이 연결을 넘쳐 그 연결의 다른 event와
// 부르기를 끊어서(`terminal-agent.md`의 잰 값) 받지 않는다. 그 기계가 파싱한 화면 사본(`terminal_view/*`)을 받아 xterm에 다시
// 쓴다: 화면이 바뀌었다는 `TerminalScreenChanged`가 오면 `TerminalDisplays`가 바뀐 줄(diff)만 덮어쓰고, diff가 없거나 맞지 않으면
// snapshot을 다시 읽는다.
import type { z } from "zod";

import type { Route } from "../../../protocol/base/route.ts";
import {
  type TerminalScreenDiff,
  terminalViewResize,
  terminalViewSnapshot,
  terminalViewWatch,
} from "../../../protocol/coding-agent/terminal-view.ts";
import type {
  TerminalOutput,
  TerminalRuntime,
} from "../../../protocol/coding-agent/terminals.ts";
import type { CoreSource } from "../desktop/connection/connection.ts";
import type { EventClient } from "../desktop/connection/events/client.ts";
import {
  createTerminalCore,
  type TerminalCore,
  type TerminalReply,
  terminalCaller,
} from "./core.ts";

type Screen = z.output<(typeof terminalViewSnapshot)["output"]>;
type Run = Screen["lines"][number]["runs"][number];

// 사본에 싣는 viewport 위 scrollback 줄 수. 화면이 바뀔 때마다 통째로 오므로 route의 최대(500)보다 작게 둔다.
const TAIL = 200;

function sgrColor(value: string, base: 38 | 48): string {
  if (!value.startsWith("#")) return `${base};5;${value.slice(1)}`;
  const rgb = Number.parseInt(value.slice(1), 16);
  return `${base};2;${(rgb >> 16) & 255};${(rgb >> 8) & 255};${rgb & 255}`;
}

function runText(run: Run): string {
  const codes = ["0"];
  if (run.bold) codes.push("1");
  if (run.dim) codes.push("2");
  if (run.italic) codes.push("3");
  if (run.underline) codes.push("4");
  if (run.inverse) codes.push("7");
  if (run.fg !== undefined) codes.push(sgrColor(run.fg, 38));
  if (run.bg !== undefined) codes.push(sgrColor(run.bg, 48));
  return `\x1b[${codes.join(";")}m${run.text}`;
}

/** 화면 사본을 비운 xterm(사본의 열과 줄 수)에 쓸 글 하나로 바꾼다. 줄은 scrollback부터 쓰고 커서는 viewport 기준이다. */
export function screenText(screen: Screen): string {
  const lines = [...screen.scrollback, ...screen.lines].map(
    (line) => `${line.runs.map(runText).join("")}\x1b[0m`,
  );
  const { x, y, hidden } = screen.cursor;
  return `${lines.join("\r\n")}\x1b[${y + 1};${x + 1}H\x1b[?25${hidden ? "l" : "h"}`;
}

/** diff의 바뀐 줄만 지금 xterm에 덮어쓰는 글 하나다(줄을 지우고 다시 쓴 뒤 커서를 둔다). viewport 맨 아래에 있을 때만 쓴다. */
export function diffText(diff: TerminalScreenDiff): string {
  const rows = diff.lines.map(
    ({ row, runs }) =>
      `\x1b[${row + 1};1H\x1b[2K${runs.map(runText).join("")}\x1b[0m`,
  );
  const { x, y, hidden } = diff.cursor;
  return `${rows.join("")}\x1b[${y + 1};${x + 1}H\x1b[?25${hidden ? "l" : "h"}`;
}

/**
 * 다른 기계의 `TerminalCore`. 열기·닫기·목록은 그 기계의 `terminals/*`이고, 출력은 화면 사본이다: `watch`는 사본의 lease,
 * `snapshot`은 runtime(`terminals/list`)과 사본 하나, `resize`는 사본을 보는 기기의 크기 잡기(`terminal_view/resize`)다.
 */
export function createScreenCopyCore(
  core: CoreSource,
  events: EventClient,
): TerminalCore {
  const call = terminalCaller(core);
  const base = createTerminalCore(core, events);
  const runtimeOf = async (
    terminal: string,
  ): Promise<TerminalReply<TerminalRuntime>> => {
    const list = await base.list();
    const runtime = list?.find((one) => one.terminal_ref === terminal);
    if (runtime !== undefined) return { ok: true, value: runtime };
    return {
      ok: false,
      code: list === null ? "unavailable" : "not_found",
      reason: null,
    };
  };
  return {
    ...base,
    async resize(terminal, _generation, columns, rows) {
      const sized = await call(terminalViewResize as Route, {
        terminal,
        columns: Math.min(512, Math.max(10, columns)),
        rows: Math.min(256, Math.max(4, rows)),
      });
      return sized.ok ? runtimeOf(terminal) : sized;
    },
    async snapshot(terminal, afterSeq) {
      const [runtime, screen] = await Promise.all([
        runtimeOf(terminal),
        call<Screen>(terminalViewSnapshot as Route, { terminal }),
      ]);
      if (!runtime.ok) return runtime;
      // 사본이 아직 없거나(lease 전) 이미 받은 것이면 runtime만 준다.
      if (
        !screen.ok ||
        screen.value.seq <= afterSeq ||
        screen.value.generation !== runtime.value.generation
      ) {
        return { ok: true, value: { runtime: runtime.value, output: [] } };
      }
      const output: TerminalOutput = {
        terminal_ref: terminal,
        generation: screen.value.generation,
        seq: screen.value.seq,
        chunk: screenText(screen.value),
        dropped_output: false,
      };
      return {
        ok: true,
        value: {
          runtime: {
            ...runtime.value,
            columns: screen.value.columns,
            rows: screen.value.rows,
          },
          output: [output],
        },
      };
    },
    // 사본의 lease는 shell main이 이 컴퓨터 창들의 보는 수를 세어 마지막 창이 놓을 때 그 기계로 `on: false`를 보낸다.
    watch: (terminal, on) =>
      call(
        terminalViewWatch as Route,
        on ? { terminal, on: true, tail: TAIL } : { terminal, on: false },
      ),
    subscribe: (listener) =>
      events.subscribe(
        { types: ["TerminalScreenChanged", "TerminalRuntimeChanged"] },
        listener,
      ),
  };
}
