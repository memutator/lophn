// extension 입구. open intent(`lophn gui <harness>`)를 받아 harness의 adapter로 창 하나를 연다.
import type {
  AcpSessionHandle,
  ExtensionContext,
  ExtensionSpawn,
  HarnessGuiOpen,
} from "../../../../../protocol/extensions/mod.ts";
import { HARNESS_GUI_ADAPTERS } from "./adapter.ts";

let stopAll: (() => void) | undefined;

const PATH_BEGIN = "<<lophn-path-begin>>";
const PATH_END = "<<lophn-path-end>>";
const PATH_WAIT_MS = 5000;

// 데스크톱 메뉴나 autostart로 뜬 앱의 PATH에는 사람의 shell 설정(nvm 등)이 없다. 사람의 login shell에서 PATH를 읽는다.
// rc file이 다른 글을 찍을 수 있어 표시 사이의 값만 쓴다. 못 읽으면 undefined라 shell main의 PATH를 그대로 쓴다.
function loginPath(spawn: ExtensionSpawn): Promise<string | undefined> {
  return new Promise((resolve) => {
    const proc = spawn(process.env.SHELL || "/bin/sh", [
      "-ilc",
      `printf '%s' "${PATH_BEGIN}$PATH${PATH_END}"`,
    ]);
    let out = "";
    const timer = setTimeout(() => {
      proc.kill();
      resolve(undefined);
    }, PATH_WAIT_MS);
    proc.onStdout((text) => {
      out += text;
    });
    proc.onExit(() => {
      clearTimeout(timer);
      const start = out.indexOf(PATH_BEGIN);
      const end = out.indexOf(PATH_END, start);
      const path =
        start < 0 || end < 0 ? "" : out.slice(start + PATH_BEGIN.length, end);
      resolve(path === "" ? undefined : path);
    });
  });
}

export function activate(ctx: ExtensionContext): void {
  const sessions = new Set<AcpSessionHandle>();
  let login: Promise<string | undefined> | undefined;

  // 부른 쪽이 PATH를 따로 정했을 때만 그대로 둔다. SDK는 shell main의 PATH를 env에 복사해 오므로 그 값은 정한 것이 아니다.
  async function spawnWithLoginPath(): Promise<ExtensionSpawn> {
    login ??= loginPath(ctx.spawn);
    const path = await login;
    if (path === undefined) return ctx.spawn;
    return (command, args, options) =>
      ctx.spawn(command, args, {
        ...options,
        env: {
          ...options?.env,
          ...(options?.env?.PATH === undefined ||
          options.env.PATH === process.env.PATH
            ? { PATH: path }
            : {}),
        },
      });
  }

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
    const spawn = await spawnWithLoginPath();
    const started = await HARNESS_GUI_ADAPTERS[intent.harness].start({
      cwd: intent.cwd,
      ...(intent.resume === undefined ? {} : { resume: intent.resume }),
      session,
      spawn,
      clock: ctx.clock,
      ids: ctx.ids,
    });
    if (!started.ok) {
      // 창은 열어 두고 오류를 끝난 turn으로 보인다. 닫는 것은 사람이다.
      session.publish({
        type: "turn_ended",
        turn: ctx.ids.newId("trn"),
        at: ctx.clock.now(),
        outcome: "failed",
        active_ms: null,
        error: {
          code: started.error.code,
          message: started.error.message,
        },
        messages: [],
        seq: 1,
      });
      return;
    }
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
