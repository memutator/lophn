// terminal view: 폰이 coding session 터미널의 raw 화면을 보고(`terminal_view/snapshot`), 보는 동안 host가 화면을 밀어 올리게 하며
// (`terminal_view/watch`의 lease), 허락받은 기기만 글을 친다(`terminal_view/input`). 화면은 메모리에 최신 하나만 두고 ledger에는
// 아무것도 없다. 입력 허락은 늦게 채우는 칸 `terminalInputGrant`이고 채워지지 않았으면 입력은 늘 `forbidden`이다.
import { ok } from "../../../../base/mod.ts";
import {
  terminalViewInput,
  terminalViewOpen,
  terminalViewResize,
  terminalViewSnapshot,
  terminalViewWatch,
} from "../../../../protocol/coding-agent/terminal-view.ts";
import { createTerminalView } from "../../../terminal-view/mod.ts";
import type { WiringFactory } from "./context.ts";

const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

// lease 기한(30초)을 이 주기로 본다.
const EXPIRE_MS = 5000;

export const terminalViewWiring: WiringFactory = () => {
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    name: "terminal-view",
    prepare(ctx) {
      ctx.provide(
        "terminalView",
        createTerminalView({
          clock: ctx.clock,
          publish: (event) => ctx.bus.publish(event),
          call: (request) => ctx.hostQueue.callCoding(request),
          known: (terminal) => ctx.codingRelay.terminalKnown(terminal),
          mayType: (principal) =>
            ctx.peek.terminalInputGrant?.(principal) ?? false,
        }),
      );
    },
    build(ctx) {
      const view = ctx.terminalView;
      ctx.hostLink.onFrame("terminal_screen", (frame) => view.screen(frame));
      ctx.hostLink.onOpen(() => view.opened());
      ctx.hostLink.onClose(() => view.closed());
      // 목록에서 빠지는 터미널과 연결이 닫히고 유예가 지나 비워진 목록(session lifecycle wiring의 sweep)을 같이 본다.
      ctx.codingRelay.onChange(() => view.pruned());
      timer = setInterval(() => view.expire(), EXPIRE_MS);
      timer.unref?.();
      return ok({
        memory: [
          [
            key(terminalViewWatch),
            (who, input) =>
              view.watch(
                who.principal,
                input as { terminal: string; on: boolean; tail?: number },
              ),
          ],
          [
            key(terminalViewInput),
            (who, input) =>
              view.input(
                who.principal,
                input as { terminal: string; text: string; key: string },
              ),
          ],
          [
            key(terminalViewResize),
            (who, input) =>
              view.resize(
                who.principal,
                input as { terminal: string; columns: number; rows: number },
              ),
          ],
          [
            key(terminalViewOpen),
            (_who, input) =>
              view.open(input as { project: string; key: string }),
          ],
        ],
        reads: (reads) =>
          reads.set(key(terminalViewSnapshot), (who, input) =>
            view.snapshot(
              who.principal,
              (input as { terminal: string }).terminal,
            ),
          ),
      });
    },
    closeWork() {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    },
  };
};
