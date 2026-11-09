// harness 감지, 터미널 supervisor, 터미널 IPC.

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app, clipboard } from "electron";
import {
  canDeliverMessages,
  HARNESS_ADAPTERS,
  harnessDetectionSchema,
} from "../../../../protocol/coding-agent/mod.ts";
import { createHookAsker } from "../../terminal/agent/hook-ask.ts";
import { createHookInstaller } from "../../terminal/agent/hook-install.ts";
import {
  attachTerminalSurface,
  registerTerminalIpc,
  removeTerminalIpc,
  TerminalFocusTable,
} from "../../terminal/controller.ts";
import { createTabGui, type TabGui } from "../../terminal/gui.ts";
import {
  createHarnessTui,
  type HarnessTui,
} from "../../terminal/harness-tui.ts";
import { createTerminalIpc } from "../../terminal/ipc.ts";
import { createTraceFile } from "../../terminal/trace-file.ts";
import { DIAGNOSTICS_TRACE_SETTING_KEY } from "../../../../protocol/diagnostics/trace.ts";
import { TerminalOutputs } from "../../terminal/output.ts";
import { createSupervisor, spawnNodeHost } from "../../terminal/supervisor.ts";
import {
  childCliRunner,
  createHarnessSettings,
  type HarnessCatalog,
} from "../coding-connection.ts";
import {
  createCodingIpc,
  registerCodingIpc,
  removeCodingIpc,
} from "../coding-ipc.ts";
import { lophnCliPath } from "../paths.ts";
import { createAgentWiring } from "./agent.ts";
import { createBridgeWiring } from "./bridge.ts";
import type { CallResult, Registered, ShellContext } from "./context.ts";
import { type AppSessions, createNoticeWiring } from "./notice.ts";

type CallSession = {
  call(
    kind: string,
    resource: string,
    method: string,
    body: unknown,
  ): Promise<CallResult>;
};

/** 등록 폴더 read. renderer가 믿는 경로를 여기서 다시 읽는다. */
async function projectFolders(
  session: CallSession | null,
  project: string,
): Promise<readonly { folder_ref: string; path: string }[]> {
  if (!session) return [];
  const reply = await session.call("read", "projects", "list", {
    status: "active",
  });
  if (!reply.ok) return [];
  const projects = (reply.value as { projects?: unknown[] }).projects ?? [];
  const found = projects.find(
    (item) => (item as { id?: string }).id === project,
  ) as { folders?: { path: string }[] } | undefined;
  return (found?.folders ?? []).map((folder, index) => ({
    folder_ref: `${project}_${index}`,
    path: folder.path,
  }));
}

function harnessLabel(harness: string): string {
  return harness in HARNESS_ADAPTERS
    ? HARNESS_ADAPTERS[harness as keyof typeof HARNESS_ADAPTERS].label
    : harness;
}

/** 탭 GUI가 extension 영역에서 받는 것. extension 영역이 터미널 영역보다 늦게 서므로 나중에 건다. */
export type TabGuiPort = Pick<
  Parameters<typeof createTabGui>[0],
  "handlers" | "showExtensionSettings"
>;

/** 뒤 영역(종료 흐름)이 쓰는 터미널 supervisor와, extension이 탭을 GUI로 바꾸는 길. */
export type Coding = Registered & {
  terminals: ReturnType<typeof createSupervisor>;
  gui: TabGui;
  /** agent가 `--tui`로 연 TUI 탭의 session 표. surface wiring이 묶고 extension `harness`가 읽는다. */
  tui: HarnessTui;
  bindTabGui(port: TabGuiPort): void;
};

export function register(ctx: ShellContext, appSessions: AppSessions): Coding {
  const { here, dataRoot, overlays, core, ipc } = ctx;
  const terminals = createSupervisor({
    // build가 host를 main과 같은 dist에 묶는다. 생성만 하고 첫 요청 때 띄운다.
    entry: join(here, "terminal-host.cjs"),
    spawnHost: spawnNodeHost,
  });

  // harness 감지와 전역 skill·hook 등록. `lophn` 실행 파일은 설치 묶음에 있다(Linux .deb의 `/usr/bin/lophn`, macOS `Resources/bin/lophn`, Windows `bin\lophn.cmd`).
  // 개발 실행은 LOPHN_CLI(절대 경로)를 준 때만 child를 부르고, 없으면 감지는 unavailable이다.
  // child에는 이 main의 데이터 root만 환경으로 준다.
  const lophnCli = lophnCliPath({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    env: process.env,
  });
  const cliEnv = { ...process.env, LOPHN_HOME: dataRoot };
  const catalog: HarnessCatalog = {
    parse(item) {
      const parsed = harnessDetectionSchema.safeParse(item);
      return parsed.success ? parsed.data : null;
    },
    facts: (id) => ({
      label: HARNESS_ADAPTERS[id].label,
      can_deliver_messages: canDeliverMessages(id),
    }),
  };
  const harnessSettings = createHarnessSettings({
    catalog,
    cli:
      lophnCli === null
        ? null
        : childCliRunner({ command: lophnCli, env: cliEnv }),
  });
  // terminal IPC. sender·frame 검사는 registry로, focus·generation은 ipc.ts가 본다.
  // folder_ref는 documents의 등록 폴더 read를 다시 해석한다. 첫 snapshot 뒤에는 구독한 창에만 출력을 보낸다.
  const terminalFocus = new TerminalFocusTable();
  // 전역 hook·skill 등록은 lophn 창의 dialog로 묻는다. 그 터미널을 고른 창, 모르면 마지막으로 focus를 받은
  // 창이다(detached 창은 창 밖에서 온 일을 받지 않는다). headless는 묻지 않는다.
  const asker = createHookAsker({
    pick(terminalRef) {
      if (ctx.headless.headless) return null;
      const live = [...ctx.windows].filter((window) => !window.isDestroyed());
      const owner =
        terminalRef === undefined
          ? undefined
          : terminalFocus.contentsOf(terminalRef);
      const window =
        live.find((item) => item.webContents.id === owner) ??
        live.filter((item) => !ctx.detached.has(item)).at(-1);
      if (window === undefined) return null;
      const contents = window.webContents;
      return {
        contentsId: contents.id,
        send: (channel, payload) => contents.send(channel, payload),
        // 창이 닫히거나 reload되면 dialog가 사라져 답이 오지 않는다.
        onGone(run) {
          const navigated = (
            details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>,
          ) => {
            if (details.isMainFrame && !details.isSameDocument) run();
          };
          contents.on("did-start-navigation", navigated);
          contents.on("render-process-gone", run);
          window.on("closed", run);
          return () => {
            contents.off("did-start-navigation", navigated);
            contents.off("render-process-gone", run);
            window.off("closed", run);
          };
        },
      };
    },
    requestId: () => randomUUID(),
  });
  const register = {
    ask: (input: { harness: string; files: string[]; terminalRef?: string }) =>
      asker.ask({ ...input, label: harnessLabel(input.harness) }),
    show: (input: {
      harness: string;
      ok: boolean;
      files: string[];
      message?: string;
      terminalRef?: string;
    }) => asker.show({ ...input, label: harnessLabel(input.harness) }),
  };
  // 전역 hook 등록의 묻기·놓기. 사람 터미널이 harness를 처음 알아봤을 때와 Settings가 쓴다.
  const installer = createHookInstaller({
    runCli:
      lophnCli === null
        ? null
        : childCliRunner({
            command: lophnCli,
            env: cliEnv,
            timeout_ms: 15_000,
          }),
    // hook command는 harness 설정 file의 shell 문자열이 된다. Windows는 `\` 대신 `/`로 쓴다(Git Bash와 cmd가 둘 다 읽는다).
    hookCommand:
      app.isPackaged || lophnCli === null
        ? undefined
        : process.platform === "win32"
          ? lophnCli.replaceAll("\\", "/")
          : lophnCli,
    hasHook: (harness) =>
      harness in HARNESS_ADAPTERS &&
      HARNESS_ADAPTERS[harness as keyof typeof HARNESS_ADAPTERS].hook !== null,
    register,
    changed: () => agent.syncSkills(),
  });
  const bridgeWiring = createBridgeWiring(ctx);
  // 터미널 안 coding agent의 hook socket·상태·알림. 사람 터미널은 foreground process가 harness를 알려 준다.
  const notice = createNoticeWiring(
    ctx,
    terminalFocus,
    appSessions,
    (ref) =>
      terminals.runtimes().find((item) => item.terminal_ref === ref)?.project,
    // 탭을 본 것과 같다: 못 본 표시만 끄고 상태는 그대로다.
    (ref) => agent.tracker.tabFocused(ref),
  );
  // 탭 GUI는 tracker와 터미널 IPC가 선 뒤에 만든다. hook socket이 먼저 서므로 그 사이에 온 줄은 버린다.
  let tabGui: TabGui | undefined;
  const agent = createAgentWiring({
    ctx,
    notice,
    run: bridgeWiring.run,
    terminals,
    identified: (harness, terminalRef) =>
      installer.ensureOnce(harness, terminalRef),
    cli:
      lophnCli === null
        ? null
        : childCliRunner({ command: lophnCli, env: cliEnv }),
    gui: (hook) => void tabGui?.request(hook),
  });
  const outputs = new TerminalOutputs((contentsId, channel, value) => {
    const window = [...ctx.windows].find(
      (item) => !item.isDestroyed() && item.webContents.id === contentsId,
    );
    window?.webContents.send(channel, value);
  });
  const offOutputs = terminals.on({
    output: (chunks) => outputs.output(chunks),
    runtime: (runtime) => outputs.runtime(agent.tracker.decorate(runtime)),
    hostLost() {
      for (const runtime of terminals.runtimes())
        outputs.runtime(agent.tracker.decorate(runtime));
    },
  });
  // `npm run dev:mock`의 project는 renderer 메모리에만 있어 core가 그 폴더를 모른다. 그때 터미널은
  // 실행마다 비우는 mock 데이터 root 안의 빈 폴더에서 연다.
  const mockFolder =
    process.env.LOPHN_DEV_MOCK === "1" ? join(dataRoot, "mock-terminal") : null;
  // 터미널 진단 기록. 간헐적인 mouse·화면 문제는 재현이 어려워, Settings › Diagnostics의 trace를 켰을 때만 남긴다.
  // 켬 여부는 core 설정을 처음 쓸 때 읽어 두고, 바뀌었다는 알림(SettingsChanged)이 오면 다시 읽는다. core를 읽지 못하면 꺼진 것으로 보고 다음에 다시 읽는다.
  const traceFile = createTraceFile(join(dataRoot, "logs"));
  let traceOn: boolean | undefined;
  ctx.relay.conditions.push({ types: ["SettingsChanged"] });
  ctx.relay.events.push((event) => {
    if (
      event.type === "SettingsChanged" &&
      event.payload.keys.includes(DIAGNOSTICS_TRACE_SETTING_KEY)
    ) {
      traceOn = undefined;
    }
  });
  const readTrace = async (): Promise<boolean> => {
    if (traceOn !== undefined) return traceOn;
    const listed = await ctx.coreInternal("memory", "settings", "list", {
      keys: [DIAGNOSTICS_TRACE_SETTING_KEY],
    });
    if (!listed.ok) return false;
    const entry = (
      listed.value as {
        settings?: { key: string; default?: unknown; chosen?: unknown }[];
      }
    ).settings?.find((one) => one.key === DIAGNOSTICS_TRACE_SETTING_KEY);
    traceOn =
      (entry && "chosen" in entry ? entry.chosen : entry?.default) === true;
    return traceOn;
  };
  const trace = async (
    window: number,
    events: readonly Record<string, unknown>[],
  ): Promise<boolean> => {
    if (!(await readTrace())) return false;
    traceFile.append(
      events
        .map((event) => `${JSON.stringify({ win: window, ...event })}\n`)
        .join(""),
    );
    return true;
  };
  const terminalIpc = createTerminalIpc({
    outputs,
    registry: overlays.overlayRegistry(),
    focus: terminalFocus,
    folders: {
      folders: async (project) => {
        const found = await projectFolders(core.session(), project);
        if (found.length > 0 || mockFolder === null) return found;
        await mkdir(mockFolder, { recursive: true });
        return [{ folder_ref: `${project}_0`, path: mockFolder }];
      },
    },
    host: terminals,
    bridge: bridgeWiring.bridge,
    hooks: agent.hooks,
    shellInit: agent.shellInit,
    cliPath: agent.cliPath,
    agent: agent.tracker,
    tabName: agent.setTabName,
    agentSessions: agent.listSessions,
    renameAgentSession: agent.renameSession,
    // headless 확인은 사람 장치의 clipboard를 건드리지 않는다.
    ...(ctx.headless.headless ? {} : { clipboard }),
    trace,
    // shell은 시작 층(rc)을 읽는 동안 친 글을 버리고, rc를 읽는 동안은 출력도 없다. 첫 출력(prompt) 뒤 300ms
    // 잠잠하면 친다. prompt는 열기 답보다 늦게 나오므로 듣기 전에 지나가지 않는다. 5초면 그냥 친다.
    settled: (terminalRef) =>
      new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(quiet);
          clearTimeout(cap);
          off();
          resolve();
        };
        let quiet: NodeJS.Timeout | undefined;
        const cap = setTimeout(done, 5000);
        const off = terminals.on({
          output(chunks) {
            if (!chunks.some((chunk) => chunk.terminal_ref === terminalRef))
              return;
            clearTimeout(quiet);
            quiet = setTimeout(done, 300);
          },
        });
      }),
    resumeLine: (resume) => {
      if (!(resume.harness in HARNESS_ADAPTERS)) return null;
      const adapter =
        HARNESS_ADAPTERS[resume.harness as keyof typeof HARNESS_ADAPTERS];
      if (adapter.session.resume === null) return null;
      return [
        adapter.commands[0],
        ...adapter.session.resume.map((arg) =>
          arg.replace("{id}", resume.external_session),
        ),
      ].join(" ");
    },
  });
  registerTerminalIpc(ipc, terminalIpc);
  let tabPort: TabGuiPort | undefined;
  const gui = createTabGui({
    handlers: () => tabPort?.handlers() ?? Promise.resolve(undefined),
    showExtensionSettings: () => tabPort?.showExtensionSettings(),
    windows: () =>
      [...ctx.windows]
        .filter((window) => !window.isDestroyed())
        .map((window) => ({
          send: (channel, payload) => window.webContents.send(channel, payload),
        })),
    ids: { request: () => randomUUID() },
    after(ms, run) {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    },
    terminals: {
      runtime(ref) {
        const found = terminals
          .runtimes()
          .find((item) => item.terminal_ref === ref);
        return found === undefined ||
          found.state === "exited" ||
          found.state === "unknown"
          ? undefined
          : { cwd: found.cwd_at_start, generation: found.generation };
      },
      hookEnv: (ref) => agent.hooks.envOf(ref) ?? {},
      tui: (ref) => agent.tracker.tuiOf(ref),
      async type(ref, text) {
        const runtime = terminals
          .runtimes()
          .find((item) => item.terminal_ref === ref);
        if (runtime === undefined) return;
        await terminalIpc.typeInto(ref, runtime.generation, text);
      },
      async signal(ref, signal) {
        const runtime = terminals
          .runtimes()
          .find((item) => item.terminal_ref === ref);
        if (runtime === undefined) return;
        await terminalIpc.signalForeground(ref, runtime.generation, signal);
      },
      onForegroundExit: (ref, listener) =>
        agent.tracker.onForegroundExit(ref, listener),
    },
    // 탭의 임시 폴더. 이미지는 CLI가 file 경로로 읽는다. 터미널을 닫아도 OS가 임시 폴더를 비운다.
    async writeImage(ref, image) {
      const dir = join(tmpdir(), "lophn-gui", ref);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      // 이름은 renderer가 준 글이라 경로로 쓸 수 있는 글자만 남긴다.
      const name = image.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-100);
      const path = join(dir, `${randomUUID()}-${name}`);
      await writeFile(path, image.data, { mode: 0o600 });
      return path;
    },
    log: ctx.log,
  });
  tabGui = gui;
  const offGui = terminals.on({
    runtime: (runtime) => gui.terminalChanged(runtime),
    hostLost() {
      gui.stop();
    },
  });
  // Settings › Coding agents의 감지. desktop 창 본문만 부른다.
  registerCodingIpc(
    ipc,
    createCodingIpc({
      registry: overlays.overlayRegistry(),
      harnesses: harnessSettings,
      hooks: installer,
      asker,
    }),
  );
  ctx.windowHooks.created.push((window) => {
    attachTerminalSurface(overlays.overlayRegistry(), window);
    const contents = window.webContents;
    contents.on("did-start-navigation", (event) => {
      if (event.isMainFrame && !event.isSameDocument)
        outputs.forget(contents.id);
    });
    contents.on("render-process-gone", () => outputs.forget(contents.id));
  });
  ctx.windowHooks.closed.push((window) => {
    terminalFocus.forget(window.contentsId);
    outputs.forget(window.contentsId);
  });

  const tui = createHarnessTui({
    onForegroundExit: (ref, listener) =>
      agent.tracker.onForegroundExit(ref, listener),
  });

  return {
    terminals,
    gui,
    tui,
    bindTabGui(port) {
      tabPort = port;
    },
    stop() {
      offGui();
      gui.stop();
      offOutputs();
      removeTerminalIpc({ handle: () => {}, removeHandler: ipc.removeHandler });
      removeCodingIpc(ipc);
      terminals.stop();
      agent.stop();
      notice.stop();
      bridgeWiring.stop();
    },
  };
}
