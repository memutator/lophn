// 터미널 탭의 GUI handle을 `/host-link`로 core에 잇는다(폰의 coding session). 일은 `terminal/coding-relay.ts`가 한다.
// 터미널 coding agent 집합의 보고(`coding_report`)는 tracker를 가진 `agent.ts`가 같은 연결로 보낸다.
// 폰이 연 coding session(`coding_open`)은 `terminal/coding-open.ts`가 창 요청 길(`surface.ts`)로 터미널 탭을 열어 GUI로 띄운다.
import {
  createIdSource,
  cryptoRandom,
  systemClock,
} from "../../../../base/mod.ts";
import type { HostToolOutput } from "../../../../protocol/lophn-agent/host-queue.ts";
import { createCodingOpen } from "../../terminal/coding-open.ts";
import { createCodingRelay } from "../../terminal/coding-relay.ts";
import type { Coding } from "./coding.ts";
import type { Registered, ShellContext } from "./context.ts";

// `coding_open`의 resume은 ledger session id뿐이고 그 CLI session id는 core만 안다. 요청이 CLI id를 싣기 전까지 되살리지 못한다.
const RESUME_UNSUPPORTED =
  "Continuing a saved session as chat is not available yet. Open it in the terminal on the computer.";

export function register(
  ctx: ShellContext,
  coding: Pick<Coding, "gui" | "terminals" | "openTab">,
): Registered {
  const after = (ms: number, run: () => void) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  };
  const ids = createIdSource({ clock: systemClock, random: cryptoRandom });
  const open = createCodingOpen({
    gui: coding.gui,
    projectOf: (terminalRef) =>
      coding.terminals
        .runtimes()
        .find((runtime) => runtime.terminal_ref === terminalRef)?.project,
    // 사람 쪽으로 펴진 float로 연다: 보이지 않는 탭은 터미널을 열지 않아 GUI가 시작하지 않는다.
    openTab: ({ project, harness, resume }) =>
      coding.openTab({
        id: ids.newId("hrq"),
        kind: "tab_open",
        workspace: { kind: "project", id: project },
        payload: {
          tab: ids.newId("tab"),
          target: { coding: { harness } },
          relation: "glance",
          source: null,
          resume:
            resume === null ? null : { harness, external_session: resume },
          handoff: null,
        },
      }),
    after,
  });
  ctx.hostLink.onRequest(
    "coding_open",
    async (payload): Promise<HostToolOutput> => {
      if (process.platform === "win32") {
        return {
          error: {
            code: "unavailable",
            message: "Chat view is not available on Windows.",
          },
        };
      }
      if (payload.resume !== undefined) {
        return { error: { code: "unavailable", message: RESUME_UNSUPPORTED } };
      }
      const done = await open({
        project: payload.project,
        harness: payload.harness,
      });
      return done.ok
        ? {
            content: [
              {
                type: "text",
                text: JSON.stringify({ terminal_ref: done.terminal_ref }),
              },
            ],
          }
        : { error: { code: done.code, message: done.message } };
    },
  );
  return createCodingRelay({
    gui: coding.gui,
    link: {
      send: (frame) => ctx.hostLink.send(frame),
      onOpen: (handler) => ctx.hostLink.onOpen(handler),
      onInput: (handler) => ctx.hostLink.onRequest("coding_input", handler),
      onSwitch: (handler) => ctx.hostLink.onRequest("coding_switch", handler),
    },
    after,
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
