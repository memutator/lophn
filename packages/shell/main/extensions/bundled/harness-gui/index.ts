// extension 입구. open intent(`lophn gui <harness>`)를 받아 harness의 adapter로 창 하나를 연다.
import type {
  AcpSessionHandle,
  ExtensionContext,
  HarnessGuiOpen,
} from "../../../../../protocol/extensions/mod.ts";
import { HARNESS_GUI_ADAPTERS } from "./adapter.ts";

let stopAll: (() => void) | undefined;

export function activate(ctx: ExtensionContext): void {
  const sessions = new Set<AcpSessionHandle>();

  async function open(intent: HarnessGuiOpen): Promise<void> {
    const session = ctx.acp.open({
      harness: intent.harness,
      cwd: intent.cwd,
      title: intent.harness,
    });
    sessions.add(session);
    let stop: (() => void) | undefined;
    let closed = false;
    session.onClose(() => {
      closed = true;
      sessions.delete(session);
      stop?.();
    });
    const started = await HARNESS_GUI_ADAPTERS[intent.harness].start({
      cwd: intent.cwd,
      ...(intent.resume === undefined ? {} : { resume: intent.resume }),
      session,
      spawn: ctx.spawn,
      clock: ctx.clock,
      ids: ctx.ids,
    });
    if (!started.ok) return session.close();
    stop = started.value.stop;
    // 시작하는 동안 창이 닫혔다.
    if (closed) stop();
  }

  const off = ctx.acp.onOpenIntent(open);
  stopAll = () => {
    off();
    for (const session of [...sessions]) session.close();
  };
}

export function deactivate(): void {
  stopAll?.();
  stopAll = undefined;
}
