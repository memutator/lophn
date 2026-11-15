// 폰의 터미널 보기. core가 `/host-link`로 켜고 끄는 화면 밀어 올리기와 폰의 입력을 터미널 영역에 잇는다.
import { createTerminalView } from "../../terminal/terminal-view.ts";
import type { Coding } from "./coding.ts";
import type { Registered, ShellContext } from "./context.ts";

export function register(ctx: ShellContext, coding: Coding): Registered {
  const runtime = (ref: string) =>
    coding.terminals.runtimes().find((item) => item.terminal_ref === ref);
  const view = createTerminalView({
    screen: (ref, tail) => coding.terminalIpc.screen(ref, tail),
    send: (frame) => ctx.hostLink.send(frame),
    connected: () => ctx.hostLink.connected(),
    runtime,
    type: (ref, generation, text) =>
      coding.terminalIpc.typeInto(ref, generation, text),
    humanInput: (ref, text) => coding.humanInput(ref, text),
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
  ctx.hostLink.onRequest("terminal_stream", (payload) =>
    Promise.resolve(view.stream(payload)),
  );
  ctx.hostLink.onRequest("terminal_input", (payload) => view.input(payload));
  ctx.hostLink.onOpen(() => view.reset());
  return {
    stop() {
      off();
      view.reset();
    },
  };
}
