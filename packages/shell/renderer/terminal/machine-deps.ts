// 기계마다의 터미널 탭 통로. 범위의 묶음(`desktop/machines/data.ts`)이 이 함수로 짓는다.
import type { TerminalApi } from "../../ipc/terminal.ts";
import type { CoreSource } from "../desktop/connection/connection.ts";
import type { EventClient } from "../desktop/connection/events/client.ts";
import type { MachineRef } from "../desktop/machines/scope.tsx";
import { createTerminalCore } from "./core.ts";
import { type TerminalDeps, windowTerminalDeps } from "./deps.ts";
import { TerminalStore } from "./store.ts";
import { createXtermView, type TerminalClipboard } from "./xterm-view.ts";

/**
 * 이 컴퓨터의 터미널은 core가 갖고 입력·clipboard는 shell main을 거친다. 다른 기계의 터미널은 아직 없다(undefined).
 * 묶음마다 한 번 부른다: store가 살아 있는 xterm과 터미널의 대응을 탭 mount와 따로 든다.
 */
export function machineTerminalDeps(
  machine: MachineRef,
  core: CoreSource,
  events: EventClient,
): TerminalDeps | undefined {
  if (machine !== null) return undefined;
  const terminalCore = createTerminalCore(core, events);
  const bridge =
    (globalThis as { lophnTerminal?: TerminalApi }).lophnTerminal ?? null;
  const clipboard: TerminalClipboard | null =
    bridge === null
      ? null
      : {
          copy: async (text) => {
            await bridge.copy({ text: text.slice(0, 60_000) });
          },
          paste: async () => {
            const reply = await bridge.paste();
            return reply.ok ? reply.value : "";
          },
        };
  return windowTerminalDeps(
    terminalCore,
    new TerminalStore(terminalCore, bridge),
    (host, edge) => createXtermView(host, edge, undefined, clipboard),
  );
}
