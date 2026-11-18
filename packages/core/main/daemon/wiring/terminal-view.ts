// terminal view: 폰이 coding session 터미널의 raw 화면을 보고(`terminal_view/snapshot`), 보는 동안 core가 PTY host의 화면을 읽으며
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
import type { Id } from "../../../../protocol/base/ids.ts";
import {
  createTerminalView,
  type TerminalView,
} from "../../../terminal-view/mod.ts";
import type { WiringFactory } from "./context.ts";

const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

// lease 기한(30초)을 이 주기로 본다.
const EXPIRE_MS = 5000;

export const terminalViewWiring: WiringFactory = () => {
  let timer: ReturnType<typeof setInterval> | undefined;
  let offList: (() => void) | undefined;
  let view: TerminalView | undefined;
  return {
    name: "terminal-view",
    prepare(ctx) {
      ctx.provide(
        "terminalView",
        createTerminalView({
          clock: ctx.clock,
          publish: (event) => ctx.bus.publish(event),
          terminals: ctx.terminals,
          openTab(project, terminal) {
            ctx.hostQueue.openTab({
              owner: "person",
              workspace: { kind: "project", id: project as Id<"prj"> },
              target: { terminal: { terminal_ref: terminal } },
              relation: null,
              source: null,
            });
          },
          after(ms, run) {
            const once = setTimeout(run, ms);
            once.unref?.();
            return () => clearTimeout(once);
          },
          known: (terminal) =>
            ctx.terminalAgents.coding.terminalKnown(terminal),
          mayType: (principal) =>
            ctx.peek.terminalInputGrant?.(principal) ?? false,
        }),
      );
    },
    build(ctx) {
      const shown = ctx.terminalView;
      view = shown;
      // 목록에서 빠지는 터미널(끝난 터미널, coding agent가 떠난 터미널)의 화면과 lease를 지운다.
      offList = ctx.terminalAgents.coding.onChange(() => shown.pruned());
      timer = setInterval(() => shown.expire(), EXPIRE_MS);
      timer.unref?.();
      return ok({
        memory: [
          [
            key(terminalViewWatch),
            (who, input) =>
              shown.watch(
                who.principal,
                input as { terminal: string; on: boolean; tail?: number },
              ),
          ],
          [
            key(terminalViewInput),
            (who, input) =>
              shown.input(
                who.principal,
                input as { terminal: string; text: string; key: string },
              ),
          ],
          [
            key(terminalViewResize),
            (who, input) =>
              shown.resize(
                who.principal,
                input as { terminal: string; columns: number; rows: number },
              ),
          ],
          [
            key(terminalViewOpen),
            (_who, input) =>
              shown.open(input as { project: string; key: string }),
          ],
        ],
        reads: (reads) =>
          reads.set(key(terminalViewSnapshot), (who, input) =>
            shown.snapshot(
              who.principal,
              (input as { terminal: string }).terminal,
            ),
          ),
      });
    },
    closeWork() {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      offList?.();
      offList = undefined;
      view?.stop();
    },
  };
};
