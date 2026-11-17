// extension registry를 shell main에 올린다. 켜진 extension만 load하고, core가 준비되면 한 번, 설정이 바뀔 때마다 맞춘다.
import { spawn } from "node:child_process";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { app, type IpcMainInvokeEvent } from "electron";
import { z } from "zod";

import {
  nodeTreeDeps,
  prependPath,
  signalTree,
} from "../../../../base/os/mod.ts";
import {
  createIdSource,
  cryptoRandom,
  type IdSource,
  systemClock,
} from "../../../../base/mod.ts";
import {
  type AcpInput,
  acpInputSchema,
  type AcpState,
  EMPTY_ACP_STATE,
  reduceAcp,
} from "../../../../protocol/acp/mod.ts";
import { createRpcClient } from "../../../../protocol/client/mod.ts";
import type {
  AcpSessionHandle,
  ExtensionAcp,
  ExtensionContext,
  ExtensionSpawn,
} from "../../../../protocol/extensions/mod.ts";
import {
  type HostRequest,
  type HostToolOutput,
  hostToolOutputSchema,
} from "../../../../protocol/lophn-agent/host-queue.ts";
import {
  createExtensionRegistry,
  type ExtensionFiles,
} from "../../extensions/registry.ts";
import { nodeFetch } from "../core/node-io.ts";
import { routeByName } from "../core/routes.ts";
import {
  EXTENSIONS_CHANNEL,
  extensionsCallSchema,
  type ExtensionsReply,
} from "../../../ipc/extensions.ts";
import {
  HARNESS_GUI_TAB_ACK_CHANNEL,
  HARNESS_GUI_TAB_CONNECT_CHANNEL,
  HARNESS_GUI_TAB_DISCONNECT_CHANNEL,
  HARNESS_GUI_TAB_IMAGE_CHANNEL,
  HARNESS_GUI_TAB_IMAGE_READ_CHANNEL,
  HARNESS_GUI_TAB_TOOL_BODY_CHANNEL,
  HARNESS_GUI_TAB_INPUT_CHANNEL,
  HARNESS_GUI_TAB_REWIND_PREVIEW_CHANNEL,
  HARNESS_GUI_TAB_RUNNING_CHANNEL,
  HARNESS_GUI_TAB_CURRENT_CHANNEL,
  HARNESS_GUI_TAB_SESSIONS_CHANNEL,
  HARNESS_GUI_TAB_TOGGLE_CHANNEL,
} from "../../../ipc/harness-gui.ts";
import { cliEnv, type TabGui, type TabHandle } from "../../terminal/gui.ts";
import { checkCaller, checkInput, type IpcEvent } from "../ipc-guard.ts";
import { packagedInstall } from "../paths.ts";
import type { Coding } from "./coding.ts";
import { changedIds, type Registered, type ShellContext } from "./context.ts";

const nodeFiles: ExtensionFiles = {
  read: (path) => readFile(path, "utf8").catch(() => null),
  write: async (path, text) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  },
  list: (dir) => readdir(dir).catch(() => null),
  mkdir: async (path) => void (await mkdir(path, { recursive: true })),
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

// SIGTERM 뒤 group에 남은 process를 SIGKILL하기까지 기다리는 시간이다.
const KILL_GRACE_MS = 3000;
// `exit` 뒤 `close`(stdio가 다 닫힘)를 기다리는 시간이다. CLI가 띄운 손자가 pipe를 물려받으면 `close`가 오지 않는다.
const DRAIN_MS = 250;

const ENV_BEGIN = "<<lophn-env-begin>>";
const ENV_END = "<<lophn-env-end>>";
const ENV_WAIT_MS = 5000;
// login shell을 한 번 띄운 값이라 이 process의 것이다. CLI에 물려주면 틀리다.
const LOGIN_ONLY = new Set(["PWD", "OLDPWD", "SHLVL", "_"]);

// macOS 12 이하의 BSD `env`에는 -0이 없어 darwin은 줄바꿈으로 나뉜 출력을 읽는다. `NAME=`로 시작하지 않는 줄은 앞 값의 이어진 줄이다.
function splitEnv(text: string, nul: boolean): string[] {
  if (nul) return text.split("\0");
  const entries: string[] = [];
  for (const line of text.replace(/\n$/, "").split("\n")) {
    if (entries.length > 0 && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(line)) {
      entries[entries.length - 1] += `\n${line}`;
    } else {
      entries.push(line);
    }
  }
  return entries;
}

/** `env -0`의 출력(표시 사이의 NUL로 나뉜 `NAME=value`)을 읽는다. 표시가 없으면 undefined. darwin은 `env`의 줄바꿈 출력이다. */
function parseLoginEnv(
  out: string,
  platform: string = process.platform,
): Record<string, string> | undefined {
  const start = out.indexOf(ENV_BEGIN);
  const end = out.indexOf(ENV_END, start);
  if (start < 0 || end < 0) return undefined;
  const env: Record<string, string> = {};
  const body = out.slice(start + ENV_BEGIN.length, end);
  for (const entry of splitEnv(body, platform !== "darwin")) {
    const eq = entry.indexOf("=");
    if (eq <= 0) continue;
    const name = entry.slice(0, eq);
    if (!LOGIN_ONLY.has(name)) env[name] = entry.slice(eq + 1);
  }
  return Object.keys(env).length === 0 ? undefined : env;
}

// 데스크톱 메뉴나 autostart로 뜬 앱의 env에는 사람의 shell 설정(nvm의 PATH, rc file에 둔 API key)이 없다. 사람의 login shell에서
// env 전체를 읽는다. rc file이 tmux나 updater를 띄우지 않게 막고(Emdash), 다른 글을 찍을 수 있어 표시 사이의 값만 쓴다.
// 못 읽으면 undefined다.
function readLoginEnv(
  spawn: ExtensionSpawn,
): Promise<Record<string, string> | undefined> {
  return new Promise((resolve) => {
    const proc = spawn(
      process.env.SHELL || "/bin/sh",
      [
        "-ilc",
        `printf '%s' '${ENV_BEGIN}'; env${process.platform === "darwin" ? "" : " -0"}; printf '%s' '${ENV_END}'`,
      ],
      {
        env: {
          DISABLE_AUTO_UPDATE: "true",
          ZSH_TMUX_AUTOSTART: "false",
          ZSH_TMUX_AUTOSTARTED: "true",
        },
      },
    );
    let out = "";
    let done = false;
    const finish = (value: Record<string, string> | undefined) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      proc.kill();
      finish(undefined);
    }, ENV_WAIT_MS);
    proc.onStdout((text) => {
      out += text;
    });
    proc.onExit(() => finish(parseLoginEnv(out)));
  });
}

// extension이 띄우는 process의 spawn과 사람의 login shell env를 한 곳에 둔다.
// env는 process.env < login shell env < (`lophn` CLI 폴더를 앞에 둔 PATH) < 넘긴 env다(`cliEnv`가 data root를 넣고 상위 session
// 표지를 지운다). CLI는 자기 process group으로 띄우고 group째 끈다: CLI가 띄운 명령(tool, background task)이 CLI가 죽은 뒤에도
// 남지 않게 한다. 살아 있는 process는 `stopAll`이 앱이 끝날 때 SIGTERM한다.
function createSpawner(dataRoot: string) {
  const live = new Set<() => void>();
  // 성공한 결과만 지닌다. 실패하면 다음에 env가 필요할 때 다시 읽는다.
  let login: Record<string, string> | undefined;
  let reading: Promise<void> | undefined;

  const start = (
    command: string,
    args: readonly string[],
    options: Parameters<ExtensionSpawn>[2],
    withLogin: boolean,
  ): ReturnType<ExtensionSpawn> => {
    const base = { ...process.env, ...(withLogin ? login : undefined) };
    // `LOPHN_CLI`(launcher 경로)는 개발 실행은 사람이, packaged는 shell main이 채운다. 개발 실행은 PATH에 `lophn`이 없다.
    const cli = process.env.LOPHN_CLI;
    const path =
      cli !== undefined && isAbsolute(cli)
        ? prependPath(base, dirname(cli), process.platform)
        : undefined;
    const child = spawn(command, [...args], {
      cwd: options?.cwd,
      env: cliEnv({
        base: path === undefined ? base : { ...base, [path.name]: path.value },
        dataRoot,
        given: options?.env,
      }),
      detached: process.platform !== "win32",
    });
    // 죽는 사이 쓰면 EPIPE 같은 'error'가 오고, 처리하지 않으면 main이 죽는다.
    for (const stream of [child.stdin, child.stdout, child.stderr]) {
      stream.on("error", () => {});
    }
    const exits: Array<(code: number | null) => void> = [];
    const stderrs: Array<(text: string) => void> = [];
    let exited = false;
    const exit = (code: number | null) => {
      if (exited) return;
      exited = true;
      live.delete(kill);
      exits.forEach((listener) => listener(code));
    };
    // 시작하지 못하면 'error'가 오고, 원인(ENOENT, EACCES)은 stderr로 먼저 보낸다. 시작한 뒤의 'error'(kill 실패 등)는 exit가 아니다.
    child.on("error", (error) => {
      if (child.pid !== undefined) return;
      stderrs.forEach((listener) => listener(error.message));
      exit(null);
    });
    // `exit`는 stdout을 다 읽기 전에 올 수 있어 `close`(다 읽음)나 DRAIN_MS 중 먼저 온 때에 알린다.
    child.on("exit", (code) => {
      const timer = setTimeout(() => exit(code), DRAIN_MS);
      child.once("close", () => {
        clearTimeout(timer);
        exit(code);
      });
    });
    child.stderr.setEncoding("utf8").on("data", (text: string) => {
      if (!exited) stderrs.forEach((listener) => listener(text));
    });
    function kill() {
      if (child.pid === undefined) {
        child.kill("SIGTERM");
        return;
      }
      if (process.platform === "win32") {
        void signalTree(child.pid, "SIGTERM", "win32", nodeTreeDeps(spawn));
        return;
      }
      // CLI는 자기 process group의 leader라 group째 끊는다(CLI가 띄운 명령까지). SIGTERM을 무시하거나 멈춘 process가 남지 않게
      // 유예 뒤에도 group에 살아 있는 것이 있으면 SIGKILL을 보낸다(앱이 멈춘 session이 도는 채로 남지 않게 한다).
      const group = -child.pid;
      try {
        process.kill(group, "SIGTERM");
      } catch {
        return; // 이미 끝난 group이다.
      }
      setTimeout(() => {
        try {
          process.kill(group, 0);
          process.kill(group, "SIGKILL");
        } catch {
          // 다 끝났다.
        }
      }, KILL_GRACE_MS).unref();
    }
    live.add(kill);
    return {
      pid: child.pid,
      write(text) {
        if (child.stdin.writable) child.stdin.write(text);
      },
      end() {
        if (child.stdin.writable) child.stdin.end();
      },
      kill,
      onStdout(listener) {
        child.stdout.setEncoding("utf8").on("data", (text: string) => {
          if (!exited) listener(text);
        });
      },
      onStderr: (listener) => void stderrs.push(listener),
      onExit: (listener) => void exits.push(listener),
    };
  };

  /** login env를 읽은 뒤(또는 못 읽어 포기한 뒤) 끝난다. 읽는 중이면 그 하나를 같이 기다린다. win32는 login shell이 없다. */
  const loginReady = (): Promise<void> => {
    if (process.platform === "win32" || login !== undefined) {
      return Promise.resolve();
    }
    reading ??= readLoginEnv((command, args, options) =>
      start(command, args, options, false),
    )
      .then((env) => {
        login = env;
      })
      .finally(() => {
        reading = undefined;
      });
    return reading;
  };

  return {
    loginReady,
    spawn: ((command, args, options) => {
      // spawn은 기다릴 수 없어 env가 없으면 뒤에서 읽고 다음 spawn이 쓴다.
      if (login === undefined) void loginReady();
      return start(command, args, options, true);
    }) as ExtensionSpawn,
    // 앱이 끝나기 전에 동기로 보낸다(비동기 stop을 기다리는 동안 앱이 끝나도 CLI가 남지 않게).
    stopAll() {
      for (const kill of [...live]) kill();
    },
  };
}

/** 탭 쪽이 handle 하나에 붙는 listener. */
type AcpListener = Parameters<TabHandle["attach"]>[0];

// handle은 탭이 닫히거나 extension이 닫을 때까지 update를 접은 상태(`AcpState`) 하나만 쥔다. 늦게 붙는 탭은 그 상태를 snapshot으로
// 한 번 받고 이어서 새 update를 받는다(raw update와 글 조각을 쌓지 않는다).
function createAcp(ids: IdSource, gui: Pick<TabGui, "opened">) {
  let tab: Parameters<ExtensionAcp["onTab"]>[0] | undefined;
  const acp: ExtensionAcp = {
    open(options) {
      const id = ids.newId("win");
      let state: AcpState = EMPTY_ACP_STATE;
      const attached = new Set<AcpListener>();
      const inputs: Array<(input: AcpInput) => void> = [];
      const closers: Array<() => void> = [];
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        state = EMPTY_ACP_STATE;
        for (const listener of [...attached]) listener.closed();
        attached.clear();
        for (const listener of closers) listener();
      };
      const tabHandle: TabHandle = {
        id,
        terminal: options.terminal.id,
        harness: options.harness,
        handoff: options.handoff,
        cwd: options.terminal.cwd,
        state: () => state,
        attach(listener) {
          if (closed) {
            listener.closed();
            return () => {};
          }
          listener.snapshot(state);
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
          state = reduceAcp(state, update);
          for (const listener of attached) listener.update(update);
        },
        onInput: (listener) => void inputs.push(listener),
        onClose: (listener) => void closers.push(listener),
        close,
      };
      // 그 탭을 가진 창이 ack하면 GUI view가 된다.
      gui.opened(tabHandle);
      return handle;
    },
    // 탭 GUI(`terminal/gui.ts`)가 이 handlers를 부른다.
    onTab(next) {
      tab = next;
      return () => {
        if (tab === next) tab = undefined;
      };
    },
  };
  return { acp, tab: () => tab };
}

const handleOnly = z.strictObject({ handle: z.string().min(1).max(100) });
const tabInputSchema = z.strictObject({
  handle: z.string().min(1).max(100),
  input: acpInputSchema,
});
const tabRewindPreviewSchema = z.strictObject({
  handle: z.string().min(1).max(100),
  message: z.string().min(1).max(100),
});
const tabToggleSchema = z.strictObject({
  terminal_ref: z.string().min(1).max(80),
  to: z.enum(["gui", "tui"]),
});
const tabAckSchema = z.strictObject({ request: z.string().min(1).max(100) });
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const tabToolBodySchema = z.strictObject({
  handle: z.string().min(1).max(100),
  tool_call: z.string().min(1).max(200),
  part: z.enum(["input", "output"]),
});
const tabImageReadSchema = z.strictObject({
  handle: z.string().min(1).max(100),
  path: z.string().min(1).max(4096),
});
const tabImageSchema = z.strictObject({
  handle: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  mime: z.string().regex(/^image\//),
  data: z
    .instanceof(Uint8Array)
    .refine((data) => data.byteLength <= IMAGE_MAX_BYTES),
});

// 터미널 탭 안 GUI의 renderer 통로. desktop 창 본문만 부른다. 일은 `terminal/gui.ts`가 한다.
function registerTabGuiIpc(ctx: ShellContext, gui: TabGui): () => void {
  const channels: string[] = [];
  const handle = <T>(
    channel: string,
    schema: z.ZodType<T>,
    run: (event: IpcMainInvokeEvent, input: T) => unknown,
  ) => {
    channels.push(channel);
    ctx.ipc.handle(channel, (event: IpcMainInvokeEvent, input: unknown) => {
      const caller = checkCaller(ctx.overlays.overlayRegistry(), event);
      // 이미지는 byte라 checkInput의 64 KiB 상한(JSON 길이)에 맞지 않는다. 크기는 schema가 본다.
      const parsed = schema.safeParse(input);
      if (
        !caller.ok ||
        !parsed.success ||
        caller.value.origin.host !== "desktop"
      ) {
        return null;
      }
      return run(event, parsed.data);
    });
  };
  const sender = (event: IpcMainInvokeEvent) => ({
    id: event.sender.id,
    send: (channel: string, payload: unknown) =>
      event.sender.send(channel, payload),
    alive: () => !event.sender.isDestroyed(),
  });
  handle(HARNESS_GUI_TAB_ACK_CHANNEL, tabAckSchema, (_event, input) => {
    gui.ack(input.request);
    return true;
  });
  handle(HARNESS_GUI_TAB_CONNECT_CHANNEL, handleOnly, (event, input) =>
    gui.connect(sender(event), input.handle),
  );
  handle(HARNESS_GUI_TAB_DISCONNECT_CHANNEL, handleOnly, (event, input) => {
    gui.disconnect(sender(event), input.handle);
    return true;
  });
  handle(HARNESS_GUI_TAB_INPUT_CHANNEL, tabInputSchema, (_event, input) =>
    gui.input(input.handle, input.input),
  );
  handle(
    HARNESS_GUI_TAB_RUNNING_CHANNEL,
    z.strictObject({ terminal_ref: z.string().min(1).max(80) }),
    (_event, input) => gui.running(input.terminal_ref),
  );
  handle(
    HARNESS_GUI_TAB_CURRENT_CHANNEL,
    z.strictObject({ terminal_ref: z.string().min(1).max(80) }),
    (_event, input) => gui.current(input.terminal_ref),
  );
  handle(HARNESS_GUI_TAB_SESSIONS_CHANNEL, handleOnly, (_event, input) =>
    gui.sessions(input.handle),
  );
  handle(
    HARNESS_GUI_TAB_REWIND_PREVIEW_CHANNEL,
    tabRewindPreviewSchema,
    (_event, input) => gui.rewindPreview(input.handle, input.message),
  );
  handle(HARNESS_GUI_TAB_TOGGLE_CHANNEL, tabToggleSchema, (_event, input) =>
    gui.toggle(input),
  );
  handle(
    HARNESS_GUI_TAB_TOOL_BODY_CHANNEL,
    tabToolBodySchema,
    (_event, input) => gui.toolBody(input.handle, input.tool_call, input.part),
  );
  handle(HARNESS_GUI_TAB_IMAGE_CHANNEL, tabImageSchema, (_event, input) =>
    gui.uploadImage(input.handle, { name: input.name, data: input.data }),
  );
  handle(
    HARNESS_GUI_TAB_IMAGE_READ_CHANNEL,
    tabImageReadSchema,
    (_event, input) => gui.readImage(input.handle, input.path),
  );
  return () => {
    for (const channel of channels) ctx.ipc.removeHandler(channel);
  };
}

/** core가 `tool_call` 요청으로 보낸 extension tool 호출. surface가 가져와 `run`에 넘긴다. */
export type ExtensionTools = {
  run(
    payload: Extract<HostRequest, { kind: "tool_call" }>["payload"],
  ): Promise<HostToolOutput>;
};

export function register(
  ctx: ShellContext,
  /** harness-gui가 꺼져 있을 때 탭이 띄울 Settings › System › Extensions. */
  port: { showExtensionSettings(): void },
  coding: Pick<Coding, "gui" | "bindTabGui">,
): Registered & ExtensionTools {
  // packaged는 설치 root의 extensions/다(tools/package/main.ts가 채운다).
  const bundled = app.isPackaged
    ? join(packagedInstall(process.resourcesPath).root, "extensions")
    : join(ctx.here, "..", "extensions", "bundled");
  const spawner = createSpawner(ctx.dataRoot);
  const clock = systemClock;
  const ids = createIdSource({ clock, random: cryptoRandom });
  const { acp, tab } = createAcp(ids, coding.gui);
  // 마지막으로 맞춘 core 연결 session. 못 올렸으면 비워 다음 확인에서 다시 맞춘다.
  let connected: unknown;
  const registry = createExtensionRegistry({
    roots: [bundled],
    dataRoot: ctx.dataRoot,
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
    spawn: spawner.spawn,
    acp,
    clock,
    ids,
    // core는 manifest를 읽지 못하므로 sync마다 판이 맞는 manifest의 tool을 통째로 올린다. core가 없어 못 올리면 다음 확인에서 다시 올린다.
    publishTools: async (extensions) => {
      const sent = await ctx.coreInternal(
        "memory",
        "extension_tools",
        "publish",
        { extensions },
      );
      if (!sent.ok) {
        // core가 아직 안 붙었을 때만 다시 시도한다. 거절당한 목록을 매초 다시 올리지 않는다.
        if (sent.error.code === "unavailable") connected = undefined;
        throw new Error(sent.error.message);
      }
    },
    log: ctx.log,
  });
  // extension이 activate될 때 login env가 있어야 headless harness도 같은 PATH를 얻는다. sync는 늘 그것을 먼저 기다린다.
  const syncReady = async () => {
    await spawner.loginReady();
    await registry.sync();
  };
  const sync = () =>
    void syncReady().catch((cause) => ctx.log(`extensions: ${String(cause)}`));

  // 켜졌는지는 sync가 정한다. 탭의 `<harness> gui`와 toggle이 부른다. 이미 켜져 있으면 sync를 건너뛴다: 설정을 바꾸면
  // 설정 변경(`StateChanged`의 `settings`)이 sync를 돌려 끄고, toggle마다 manifest와 설정과 tool 목록을 다시 읽는 것은 시간만 쓴다.
  coding.bindTabGui({
    async handlers() {
      if (tab() === undefined) {
        await syncReady().catch((cause) =>
          ctx.log(`extensions: ${String(cause)}`),
        );
      }
      const handlers = tab();
      // GUI를 열기 앞서 login env를 다시 읽을 기회를 준다(앞서 못 읽었으면).
      return handlers === undefined
        ? undefined
        : {
            ...handlers,
            gui: async (request) => {
              await spawner.loginReady();
              return handlers.gui(request);
            },
          };
    },
    showExtensionSettings: port.showExtensionSettings,
  });
  const offTabGui = registerTabGuiIpc(ctx, coding.gui);

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
        await syncReady().catch((cause) =>
          ctx.log(`extensions: ${String(cause)}`),
        );
        return { ok: true, value: await registry.list() };
      }
      const done =
        call.op === "install"
          ? await registry.install(call.id)
          : call.op === "remove"
            ? await registry.remove(call.id)
            : await registry.run(call.command);
      return done.ok ? { ok: true, value: null } : done;
    },
  );

  ctx.relay.conditions.push({ types: ["StateChanged"] });
  ctx.relay.events.push((event) => {
    if (
      changedIds(event, "settings").some(
        (key) => key === null || key.startsWith("extensions."),
      )
    ) {
      sync();
    }
  });
  // core가 준비되면 한 번, core에 다시 붙을 때마다 맞춘다(sync가 tool 목록도 올린다: core는 목록을 메모리에만 둔다).
  // 준비 신호를 main이 받는 길이 없어 연결 session이 바뀌는지 본다. 다시 붙을 때마다 새 session이 선다.
  const watch = setInterval(() => {
    const session = ctx.core.session();
    if (session === null || session === connected) return;
    connected = session;
    sync();
  }, 1000);

  // handler의 `core`는 사람 token이 아니라 그 호출만 쓰는 agent token으로 부른다(`ctx.coreInternal`을 쓰지 않는다).
  const coreWith = (token: string): ExtensionContext["core"] => ({
    async call(kind, resource, method, input) {
      const session = ctx.core.session();
      const route = routeByName(`${kind}:${resource}/${method}`);
      if (session === null || route === undefined) {
        return {
          ok: false,
          error: {
            code: session === null ? "unavailable" : "not_found",
            message: "route is not available",
          },
        };
      }
      return (await createRpcClient({
        baseUrl: `http://127.0.0.1:${session.apiPort}`,
        token,
        fetch: nodeFetch,
      }).call(route as never, input as never)) as never;
    },
  });

  return {
    async run({ extension, tool, input, session, workspace, credential }) {
      const result = await registry.callTool(extension, tool, input, {
        session,
        workspace,
        core: coreWith(credential),
      });
      // core가 형식을 거절하면 기다리는 호출이 끝나지 않는다. 모양이 틀린 결과는 여기서 오류로 바꾼다.
      const output = hostToolOutputSchema.safeParse(
        result.ok ? { content: result.value } : { error: result.error },
      );
      return output.success
        ? output.data
        : {
            error: {
              code: "internal",
              message: "the extension returned an invalid result",
            },
          };
    },
    stop() {
      offTabGui();
      ctx.ipc.removeHandler(EXTENSIONS_CHANNEL);
      clearInterval(watch);
      void registry.stop();
      spawner.stopAll();
    },
  };
}
