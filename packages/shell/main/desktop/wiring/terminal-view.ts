// 폰의 터미널 보기. core가 `/host-link`로 켜고 끄는 화면 밀어 올리기, 폰의 입력과 크기 잡기를 터미널 영역에 잇고,
// 폰이 연 터미널(`terminal_open`)을 창 요청 길(`surface.ts`)로 연다.
import {
  createIdSource,
  cryptoRandom,
  systemClock,
} from "../../../../base/mod.ts";
import { createTerminalOpen } from "../../terminal/coding-open.ts";
import { createTerminalView } from "../../terminal/terminal-view.ts";
import type { Coding } from "./coding.ts";
import type { Registered, ShellContext } from "./context.ts";

export function register(ctx: ShellContext, coding: Coding): Registered {
  const runtime = (ref: string) =>
    coding.terminals.runtimes().find((item) => item.terminal_ref === ref);
  const request = async (message: object) => {
    const reply = await coding.terminals.request(message);
    if (!reply.ok) throw new Error(reply.message);
  };
  const view = createTerminalView({
    screen: (ref, tail) => coding.terminalIpc.screen(ref, tail),
    send: (frame) => ctx.hostLink.send(frame),
    connected: () => ctx.hostLink.connected(),
    runtime,
    type: (ref, generation, text) =>
      coding.terminalIpc.typeInto(ref, generation, text),
    humanInput: (ref, text) => coding.humanInput(ref, text),
    resize: (ref, generation, columns, rows) =>
      request({
        type: "resize",
        terminal_ref: ref,
        generation,
        columns,
        rows,
        remote: true,
      }),
    release: (ref, generation) =>
      request({ type: "release", terminal_ref: ref, generation }),
    schedule(run, ms) {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    },
  });
  // 터미널이 목록에서 빠진 것은 core가 lease를 지운다. 여기서는 터미널이 끝날 때만 멈춘다.
  const off = coding.terminals.on({
    output: (chunks) => view.output(chunks),
    runtime: (next) => view.runtime(next),
    hostLost: () => view.reset(),
  });
  const ids = createIdSource({ clock: systemClock, random: cryptoRandom });
  const open = createTerminalOpen({
    // 사람 쪽으로 펴진 float로 연다: 보이지 않는 탭은 터미널을 열지 않는다.
    openTab: (project) =>
      coding.openTab({
        id: ids.newId("hrq"),
        kind: "tab_open",
        workspace: { kind: "project", id: project },
        payload: {
          tab: ids.newId("tab"),
          target: { terminal: {} },
          relation: "glance",
          source: null,
          resume: null,
          handoff: null,
        },
      }),
    terminals: () =>
      coding.terminals.runtimes().map((item) => item.terminal_ref),
    onRuntime: (listener) => coding.terminals.on({ runtime: listener }),
    after(ms, run) {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    },
  });
  ctx.hostLink.onRequest("terminal_stream", (payload) =>
    Promise.resolve(view.stream(payload)),
  );
  ctx.hostLink.onRequest("terminal_input", (payload) => view.input(payload));
  ctx.hostLink.onRequest("terminal_resize", (payload) => view.resize(payload));
  ctx.hostLink.onRequest("terminal_open", async (payload) => {
    const done = await open(payload.project);
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
  });
  ctx.hostLink.onOpen(() => view.reset());
  return {
    stop() {
      off();
      view.reset();
    },
  };
}
