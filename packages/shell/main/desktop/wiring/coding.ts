// harness 감지, 터미널 supervisor, 터미널 IPC.

import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
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
import { createTerminalIpc } from "../../terminal/ipc.ts";
import { createSupervisor, spawnNodeHost } from "../../terminal/supervisor.ts";
import { TerminalOutputs } from "../../terminal/output.ts";
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
import { createAgentWiring } from "./agent.ts";
import { createBridgeWiring } from "./bridge.ts";
import type { CallResult, Registered, ShellContext } from "./context.ts";
import { createNoticeWiring } from "./notice.ts";

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

/** 뒤 영역(종료 흐름)이 쓰는 터미널 supervisor. */
export type Coding = Registered & {
  terminals: ReturnType<typeof createSupervisor>;
};

export function register(ctx: ShellContext): Coding {
  const { here, dataRoot, overlays, core, ipc } = ctx;
  const terminals = createSupervisor({
    // build가 host를 main과 같은 dist에 묶는다. 생성만 하고 첫 요청 때 띄운다.
    entry: join(here, "terminal-host.cjs"),
    spawnHost: spawnNodeHost,
  });

  // harness 감지와 전역 skill·hook 등록. `lophn` 실행 파일은 설치 묶음에 있다(Linux .deb의 `/usr/bin/lophn`).
  // 개발 실행은 LOPHN_CLI(절대 경로)를 준 때만 child를 부르고, 없으면 감지는 unavailable이다.
  // child에는 이 main의 데이터 root만 환경으로 준다.
  function lophnCommand(): string | null {
    if (app.isPackaged) {
      return process.platform === "linux" ? "/usr/bin/lophn" : null;
    }
    const given = process.env.LOPHN_CLI;
    return given !== undefined && given.startsWith("/") ? given : null;
  }
  const lophnCli = lophnCommand();
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
    hookCommand: app.isPackaged ? undefined : (lophnCli ?? undefined),
    hasHook: (harness) =>
      harness in HARNESS_ADAPTERS &&
      HARNESS_ADAPTERS[harness as keyof typeof HARNESS_ADAPTERS].hook !== null,
    register,
  });
  const bridgeWiring = createBridgeWiring(ctx);
  // 터미널 안 coding agent의 hook socket·상태·알림. 사람 터미널은 foreground process가 harness를 알려 준다.
  const notice = createNoticeWiring(
    ctx,
    terminalFocus,
    (ref) =>
      terminals.runtimes().find((item) => item.terminal_ref === ref)?.project,
    // 탭을 본 것과 같다: 못 본 표시만 끄고 상태는 그대로다.
    (ref) => agent.tracker.tabFocused(ref),
  );
  const agent = createAgentWiring({
    ctx,
    notice,
    runDir: bridgeWiring.runDir,
    terminals,
    identified: (harness, terminalRef) =>
      installer.ensureOnce(harness, terminalRef),
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
    agent: agent.tracker,
    agentSessions: agent.listSessions,
    renameAgentSession: agent.renameSession,
    // headless 확인은 사람 장치의 clipboard를 건드리지 않는다.
    ...(ctx.headless.headless ? {} : { clipboard }),
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

  return {
    terminals,
    stop() {
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
