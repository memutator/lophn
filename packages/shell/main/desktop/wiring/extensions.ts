// extension registry를 shell main에 올린다. 켜진 extension만 load하고, core가 준비되면 한 번, 설정이 바뀔 때마다 맞춘다.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { app } from "electron";

import {
  createIdSource,
  cryptoRandom,
  type IdSource,
  systemClock,
} from "../../../../base/mod.ts";
import type { AcpInput, AcpUpdate } from "../../../../protocol/acp/mod.ts";
import type {
  AcpSessionHandle,
  ExtensionAcp,
  ExtensionSpawn,
  GuiHarness,
  HarnessGuiOpen,
} from "../../../../protocol/extensions/mod.ts";
import {
  createExtensionRegistry,
  type ExtensionFiles,
} from "../../extensions/registry.ts";
import {
  EXTENSIONS_CHANNEL,
  extensionsCallSchema,
  type ExtensionsReply,
} from "../../../ipc/extensions.ts";
import { checkCaller, checkInput, type IpcEvent } from "../ipc-guard.ts";
import { packagedInstall } from "../paths.ts";
import type { Registered, ShellContext } from "./context.ts";

const nodeFiles: ExtensionFiles = {
  read: (path) => readFile(path, "utf8").catch(() => null),
  write: async (path, text) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  },
  list: (dir) => readdir(dir).catch(() => null),
  // rmdir는 빈 폴더만 지운다. file은 rm이 지운다.
  remove: async (path) => {
    try {
      await rm(path);
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return;
      if (code !== "EISDIR" && code !== "EPERM") throw cause;
      await rmdir(path);
    }
  },
};

// 띄운 process의 `lophn`이 이 shell의 core에 닿게 data root를 늘 넣는다(`--home`만으로 띄우면 env에 없다).
const nodeSpawn =
  (dataRoot: string): ExtensionSpawn =>
  (command, args, options) => {
    const child = spawn(command, [...args], {
      cwd: options?.cwd,
      env: { ...process.env, LOPHN_HOME: dataRoot, ...options?.env },
    });
    // 시작하지 못하면 'error'가 오고, 처리하지 않으면 main이 죽는다.
    const exits: Array<(code: number | null) => void> = [];
    child.on("error", () => exits.forEach((listener) => listener(null)));
    child.on("exit", (code) => exits.forEach((listener) => listener(code)));
    return {
      pid: child.pid,
      write: (text) => void child.stdin.write(text),
      end: () => void child.stdin.end(),
      kill: () => void child.kill(),
      onStdout(listener) {
        child.stdout.setEncoding("utf8").on("data", listener);
      },
      onStderr(listener) {
        child.stderr.setEncoding("utf8").on("data", listener);
      },
      onExit: (listener) => void exits.push(listener),
    };
  };

/** 창 쪽이 handle 하나에 붙는 listener. */
type AcpWindowListener = { update(update: AcpUpdate): void; closed(): void };

/** shell main이 창 쪽(gui-window)에 넘기는 handle 하나의 모습. extension의 `AcpSessionHandle`과 같은 session의 반대쪽이다. */
export type AcpWindowHandle = {
  readonly id: string;
  readonly harness: GuiHarness;
  readonly cwd: string;
  readonly title: string;
  /** 쌓인 update를 처음부터 보내고 이어서 새것을 보낸다. 돌려받은 함수로 그만 듣는다. 이미 닫혔으면 바로 `closed`다. */
  attach(listener: AcpWindowListener): () => void;
  /** 창의 입력을 extension에 준다. */
  input(input: AcpInput): void;
  /** 창이 닫혔다. extension의 `onClose`가 불린다. */
  close(): void;
};

/** 창을 여는 쪽이 채우는 port. 구현은 `gui-window.ts`다. */
export type AcpWindowPort = {
  /** 새 handle의 창을 연다. 열기 전에 쌓인 update는 `attach`가 다시 보내 준다. */
  open(window: AcpWindowHandle): void;
  /** harness-gui가 꺼져 있을 때 open intent가 띄울 Settings › System › Extensions. */
  showExtensionSettings(): void;
};

// handle은 창이 닫히거나 extension이 닫을 때까지 update를 모두 쌓는다(늦게 열린 창이 처음부터 그린다).
function createAcp(ids: IdSource, port: AcpWindowPort) {
  let handler: ((intent: HarnessGuiOpen) => void | Promise<void>) | undefined;
  const acp: ExtensionAcp = {
    open(options) {
      const id = ids.newId("win");
      const updates: AcpUpdate[] = [];
      const attached = new Set<AcpWindowListener>();
      const inputs: Array<(input: AcpInput) => void> = [];
      const closers: Array<() => void> = [];
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        updates.length = 0;
        for (const listener of [...attached]) listener.closed();
        attached.clear();
        for (const listener of closers) listener();
      };
      const window: AcpWindowHandle = {
        id,
        ...options,
        attach(listener) {
          if (closed) {
            listener.closed();
            return () => {};
          }
          for (const update of updates) listener.update(update);
          attached.add(listener);
          return () => void attached.delete(listener);
        },
        input: (input) => inputs.forEach((listener) => listener(input)),
        close,
      };
      const handle: AcpSessionHandle = {
        id,
        publish(update) {
          if (closed) return;
          updates.push(update);
          for (const listener of attached) listener.update(update);
        },
        onInput: (listener) => void inputs.push(listener),
        onClose: (listener) => void closers.push(listener),
        close,
      };
      port.open(window);
      return handle;
    },
    onOpenIntent(next) {
      handler = next;
      return () => {
        if (handler === next) handler = undefined;
      };
    },
  };
  return { acp, handler: () => handler };
}

export function register(
  ctx: ShellContext,
  port: AcpWindowPort,
): Registered & { openHarnessGui(intent: HarnessGuiOpen): void } {
  const repoRoot = join(ctx.here, "..", "..", "..", "..");
  // packaged는 설치 root의 extensions/다. 아직 packaging이 채우지 않아 비어 있을 수 있다.
  const bundled = app.isPackaged
    ? join(packagedInstall(process.resourcesPath).root, "extensions")
    : join(ctx.here, "..", "extensions", "bundled");
  const clock = systemClock;
  const ids = createIdSource({ clock, random: cryptoRandom });
  const { acp, handler } = createAcp(ids, port);
  const registry = createExtensionRegistry({
    roots: [bundled],
    dataRoot: ctx.dataRoot,
    productVersion: app.isPackaged
      ? app.getVersion()
      : JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))
          .version,
    files: nodeFiles,
    load: (path) => Promise.resolve(require(path)),
    core: {
      call: (kind, resource, method, input) =>
        ctx.coreInternal(kind, resource, method, input) as never,
    },
    settings: {
      async get(key) {
        const listed = await ctx.coreInternal("memory", "settings", "list", {
          keys: [key],
        });
        if (!listed.ok) return listed as never;
        const entries = (
          listed.value as {
            settings: { key: string; chosen?: unknown; default?: unknown }[];
          }
        ).settings;
        const entry = entries.find((e) => e.key === key);
        return {
          ok: true,
          value:
            entry === undefined
              ? undefined
              : "chosen" in entry
                ? entry.chosen
                : entry.default,
        };
      },
    },
    spawn: nodeSpawn(ctx.dataRoot),
    acp,
    clock,
    ids,
    log: ctx.log,
  });
  const sync = () =>
    void registry
      .sync()
      .catch((cause) => ctx.log(`extensions: ${String(cause)}`));

  // open intent. 켜졌는지는 sync가 정한다. core가 준비되기 전에 온 intent는 준비된 뒤에 처리한다.
  const pending: HarnessGuiOpen[] = [];
  const dispatch = async (intent: HarnessGuiOpen) => {
    await registry
      .sync()
      .catch((cause) => ctx.log(`extensions: ${String(cause)}`));
    const open = handler();
    if (open === undefined) return port.showExtensionSettings();
    await Promise.resolve(open(intent)).catch((cause) =>
      ctx.log(`extensions: open intent failed: ${String(cause)}`),
    );
  };

  // Settings › Extensions. desktop 창 본문만 부른다. list는 먼저 맞춰 두어 방금 바꾼 켜기·끄기가 보인다.
  const refused = (
    code: "forbidden" | "invalid_input",
  ): ExtensionsReply<never> => ({
    ok: false,
    error: { code, message: "request was refused" },
  });
  ctx.ipc.handle(
    EXTENSIONS_CHANNEL,
    async (
      event: IpcEvent,
      input: unknown,
    ): Promise<ExtensionsReply<unknown>> => {
      const caller = checkCaller(ctx.overlays.overlayRegistry(), event);
      if (!caller.ok || caller.value.origin.host !== "desktop") {
        return refused("forbidden");
      }
      const parsed = checkInput(extensionsCallSchema, input);
      if (!parsed.ok) return refused("invalid_input");
      const call = parsed.value;
      if (call.op === "list") {
        await registry
          .sync()
          .catch((cause) => ctx.log(`extensions: ${String(cause)}`));
        return { ok: true, value: await registry.list() };
      }
      const done =
        call.op === "install"
          ? await registry.install(call.id)
          : await registry.remove(call.id);
      return done.ok ? { ok: true, value: null } : done;
    },
  );

  ctx.relay.conditions.push({ types: ["SettingsChanged"] });
  ctx.relay.events.push((event) => {
    if (
      event.type === "SettingsChanged" &&
      event.payload.keys.some((key) => key.startsWith("extensions."))
    ) {
      sync();
    }
  });
  // core가 준비되면 한 번 맞춘다. 준비 신호를 main이 받는 길이 없어 상태를 본다(agent.ts와 같다).
  const startup = setInterval(() => {
    if (ctx.core.state.state === "starting") return;
    clearInterval(startup);
    if (ctx.core.state.state === "ready") sync();
    for (const intent of pending.splice(0)) void dispatch(intent);
  }, 1000);

  return {
    openHarnessGui(intent) {
      if (ctx.core.state.state === "starting") pending.push(intent);
      else void dispatch(intent);
    },
    stop() {
      ctx.ipc.removeHandler(EXTENSIONS_CHANNEL);
      clearInterval(startup);
      void registry.stop();
    },
  };
}
