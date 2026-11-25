// 기계마다의 터미널 탭 통로. 범위의 묶음(`desktop/machines/data.ts`)이 이 함수로 짓는다.
import type { TerminalApi, TerminalCall } from "../../ipc/terminal.ts";
import type { Route } from "../../../protocol/base/route.ts";
import {
  terminalsInput,
  terminalsRestart,
} from "../../../protocol/coding-agent/terminals.ts";
import type { CoreSource } from "../desktop/connection/connection.ts";
import type { EventClient } from "../desktop/connection/events/client.ts";
import type { MachineRef } from "../desktop/machines/scope.tsx";
import { createTerminalCore, terminalCaller } from "./core.ts";
import { type TerminalDeps, windowTerminalDeps } from "./deps.ts";
import { createScreenCopyCore } from "./screen-copy.ts";
import { TerminalStore } from "./store.ts";
import { createXtermView, type TerminalClipboard } from "./xterm-view.ts";

const done = (): Promise<TerminalCall<null>> =>
  Promise.resolve({ ok: true, value: null });

/**
 * 터미널은 그 기계의 core가 갖는다. 이 컴퓨터의 입력·다시 시작은 focus를 본 shell main을 거친다. 다른 기계의 터미널은 화면
 * 사본으로 그리고(`screen-copy.ts`) 입력·다시 시작은 그 기계의 `terminals/input`·`restart`로 간다: 그 기계는 이 컴퓨터를 기기로 보고
 * 터미널 입력 허락으로 받는다(focus 검사는 이 컴퓨터의 capability를 지키는 것이라 없다). clipboard와 link 열기는 이 컴퓨터의 것이다.
 * 묶음마다 한 번 부른다: store가 살아 있는 xterm과 터미널의 대응을 탭 mount와 따로 든다.
 */
export function machineTerminalDeps(
  machine: MachineRef,
  core: CoreSource,
  events: EventClient,
): TerminalDeps {
  const local =
    (globalThis as { lophnTerminal?: TerminalApi }).lophnTerminal ?? null;
  const clipboard: TerminalClipboard | null =
    local === null
      ? null
      : {
          copy: async (text) => {
            await local.copy({ text: text.slice(0, 60_000) });
          },
          paste: async () => {
            const reply = await local.paste();
            return reply.ok ? reply.value : "";
          },
        };
  const windowsConpty =
    machine === null &&
    typeof navigator === "object" &&
    /Windows/i.test(navigator.userAgent);
  const createView: TerminalDeps["createView"] = (host, edge) =>
    createXtermView(host, edge, undefined, clipboard, { windowsConpty });
  if (machine === null) {
    const terminalCore = createTerminalCore(core, events);
    return windowTerminalDeps(
      terminalCore,
      new TerminalStore(terminalCore, local),
      local,
      createView,
    );
  }

  const terminalCore = createScreenCopyCore(core, events);
  const call = terminalCaller(core);
  const refused = new Set<(terminal: string) => void>();
  const accepted = new Set<(terminal: string) => void>();
  const typed = async (
    route: Route,
    body: { terminal: string },
  ): Promise<TerminalCall<null>> => {
    const reply = await call(route, body);
    if (reply.ok) {
      for (const listener of accepted) listener(body.terminal);
      return { ok: true, value: null };
    }
    if (reply.code === "forbidden") {
      for (const listener of refused) listener(body.terminal);
    }
    return { ok: false, error: { code: reply.code, message: reply.code } };
  };
  const bridge: TerminalApi = {
    input: (input) => typed(terminalsInput as Route, input),
    // 출력의 질의에는 그 기계의 화면이 답한다. 사본은 날 출력이 아니다.
    respond: done,
    restart: (input) => typed(terminalsRestart as Route, input),
    focus: done,
    shown: done,
    openLink: (input) =>
      local?.openLink(input) ??
      Promise.resolve({ ok: true, value: "none" as const }),
    copy: (input) => local?.copy(input) ?? done(),
    paste: () => local?.paste() ?? Promise.resolve({ ok: true, value: "" }),
    trace: () => Promise.resolve({ ok: true, value: false }),
    onReveal: () => () => {},
  };
  return windowTerminalDeps(
    terminalCore,
    new TerminalStore(terminalCore, null),
    bridge,
    createView,
    {
      screenCopy: true,
      onRefused(listener) {
        refused.add(listener);
        return () => refused.delete(listener);
      },
      onAccepted(listener) {
        accepted.add(listener);
        return () => accepted.delete(listener);
      },
    },
  );
}
