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
import { app, type IpcMainInvokeEvent } from "electron";
import { z } from "zod";

import { nodeTreeDeps, signalTree } from "../../../../base/os/mod.ts";
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
import type { Registered, ShellContext } from "./context.ts";

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

// env는 `cliEnv`(data root를 넣고 상위 session 표지를 지운다). CLI는 자기 process group으로 띄우고 group째 끈다:
// CLI가 띄운 명령(tool, background task)이 CLI가 죽은 뒤에도 남지 않게 한다.
const nodeSpawn =
  (dataRoot: string): ExtensionSpawn =>
  (command, args, options) => {
    const child = spawn(command, [...args], {
      cwd: options?.cwd,
      env: cliEnv({ base: process.env, dataRoot, given: options?.env }),
      detached: process.platform !== "win32",
    });
    // 시작하지 못하면 'error'가 오고, 처리하지 않으면 main이 죽는다.
    const exits: Array<(code: number | null) => void> = [];
    child.on("error", () => exits.forEach((listener) => listener(null)));
    child.on("exit", (code) => exits.forEach((listener) => listener(code)));
    return {
      pid: child.pid,
      write: (text) => void child.stdin.write(text),
      end: () => void child.stdin.end(),
      kill() {
        if (child.pid === undefined) {
          child.kill("SIGTERM");
          return;
        }
        if (process.platform === "win32") {
          void signalTree(child.pid, "SIGTERM", "win32", nodeTreeDeps(spawn));
          return;
        }
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          // 이미 끝난 group이다.
        }
      },
      onStdout(listener) {
        child.stdout.setEncoding("utf8").on("data", listener);
      },
      onStderr(listener) {
        child.stderr.setEncoding("utf8").on("data", listener);
      },
      onExit: (listener) => void exits.push(listener),
    };
  };

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
  const repoRoot = join(ctx.here, "..", "..", "..", "..");
  // packaged는 설치 root의 extensions/다(tools/package/main.ts가 채운다).
  const bundled = app.isPackaged
    ? join(packagedInstall(process.resourcesPath).root, "extensions")
    : join(ctx.here, "..", "extensions", "bundled");
  const clock = systemClock;
  const ids = createIdSource({ clock, random: cryptoRandom });
  const { acp, tab } = createAcp(ids, coding.gui);
  // 마지막으로 맞춘 core 연결 session. 못 올렸으면 비워 다음 확인에서 다시 맞춘다.
  let connected: unknown;
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
  const sync = () =>
    void registry
      .sync()
      .catch((cause) => ctx.log(`extensions: ${String(cause)}`));

  // 켜졌는지는 sync가 정한다. 탭의 `<harness> gui`와 toggle이 부른다. 이미 켜져 있으면 sync를 건너뛴다: 설정을 바꾸면
  // SettingsChanged가 sync를 돌려 끄고, toggle마다 manifest와 설정과 tool 목록을 다시 읽는 것은 시간만 쓴다.
  coding.bindTabGui({
    async handlers() {
      if (tab() !== undefined) return tab();
      await registry
        .sync()
        .catch((cause) => ctx.log(`extensions: ${String(cause)}`));
      return tab();
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
        await registry
          .sync()
          .catch((cause) => ctx.log(`extensions: ${String(cause)}`));
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

  ctx.relay.conditions.push({ types: ["SettingsChanged"] });
  ctx.relay.events.push((event) => {
    if (
      event.type === "SettingsChanged" &&
      event.payload.keys.some((key) => key.startsWith("extensions."))
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
    },
  };
}
