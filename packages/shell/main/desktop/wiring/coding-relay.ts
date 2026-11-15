// 터미널 탭의 GUI handle을 `/host-link`로 core에 잇는다(폰의 coding session). 일은 `terminal/coding-relay.ts`가 한다.
// 터미널 coding agent 집합의 보고(`coding_report`)는 tracker를 가진 `agent.ts`가 같은 연결로 보낸다.
import { createCodingRelay } from "../../terminal/coding-relay.ts";
import type { Coding } from "./coding.ts";
import type { Registered, ShellContext } from "./context.ts";

export function register(
  ctx: ShellContext,
  coding: Pick<Coding, "gui" | "terminals">,
): Registered {
  return createCodingRelay({
    gui: coding.gui,
    link: {
      send: (frame) => ctx.hostLink.send(frame),
      onOpen: (handler) => ctx.hostLink.onOpen(handler),
      onInput: (handler) => ctx.hostLink.onRequest("coding_input", handler),
      onSwitch: (handler) => ctx.hostLink.onRequest("coding_switch", handler),
    },
    after(ms, run) {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    },
    alive: (terminalRef) =>
      coding.terminals
        .runtimes()
        .some(
          (runtime) =>
            runtime.terminal_ref === terminalRef &&
            runtime.state !== "exited" &&
            runtime.state !== "unknown",
        ),
    platform: process.platform,
  });
}
