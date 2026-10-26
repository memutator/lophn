// harness 감지, 터미널 supervisor, 터미널·coding IPC.
import { app } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  attachTerminalSurface,
  registerTerminalIpc,
  removeTerminalIpc,
  TerminalFocusTable,
} from "../../terminal/controller.ts";
import {
  type CodingTerminalRequests,
  createCodingTerminalRequests,
} from "../../terminal/coding/requests.ts";
import { createHookAsker } from "../../terminal/agent/hook-ask.ts";
import { createHookInstaller } from "../../terminal/agent/hook-install.ts";
import { createTerminalIpc } from "../../terminal/ipc.ts";
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
import {
  canDeliverMessages,
  canLaunch,
  HARNESS_ADAPTERS,
  HARNESS_HOOKS,
  harnessDetectionSchema,
} from "../../../../protocol/coding-agent/mod.ts";
import { createAgentWiring } from "./agent.ts";
import { createBridgeWiring } from "./bridge.ts";
import { createNoticeWiring } from "./notice.ts";
import type { CallResult, Registered, ShellContext } from "./context.ts";

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
  /**
   * core가 Gateway frame(`coding_terminal`)으로 보낸 요청 하나를 받는다. frame을 이 함수에 잇는 일은
   * platform 단위가 한다. frame은 renderer로 중계하지 않는다.
   */
  codingTerminals: CodingTerminalRequests;
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
      can_launch: canLaunch(id),
      can_deliver_messages: canDeliverMessages(id),
    }),
  };
  const harnessSettings = createHarnessSettings({
    catalog,
    core: () => core.session(),
    cli: lophnCli === null
      ? null
      : childCliRunner({ command: lophnCli, env: cliEnv }),
  });
  // core에 붙은 직후 감지를 한 번 읽어 알린다. 안 하면 사람이 Settings를 열기 전까지 core가 맡기기를
  // `not_connected`로 거절한다.
  const detectOnConnect = setInterval(() => {
    if (core.session() !== null) {
      clearInterval(detectOnConnect);
      void harnessSettings.read();
    } else if (core.state.state.startsWith("failed")) {
      clearInterval(detectOnConnect);
    }
  }, 500);

  // terminal IPC. sender·frame 검사는 registry로, focus·generation은 ipc.ts가 본다.
  // folder_ref는 documents의 등록 폴더 read를 다시 해석하고, 출력은 잡아 당기는
  // snapshot으로만 renderer에 다시 보인다.
  const terminalFocus = new TerminalFocusTable();
  // 전역 hook·skill 등록은 lophn 창의 dialog로 묻는다. 그 터미널을 고른 창, 모르면 마지막으로 focus를 받은
  // 창이다(detached 창은 창 밖에서 온 일을 받지 않는다). headless는 묻지 않는다.
  const asker = createHookAsker({
    pick(terminalRef) {
      if (ctx.headless.headless) return null;
      const live = [...ctx.windows].filter((window) => !window.isDestroyed());
      const owner = terminalRef === undefined
        ? undefined
        : terminalFocus.contentsOf(terminalRef);
      const window = live.find((item) => item.webContents.id === owner) ??
        live.filter((item) => !ctx.detached.has(item)).at(-1);
      if (window === undefined) return null;
      const contents = window.webContents;
      return {
        contentsId: contents.id,
        send: (channel, payload) => contents.send(channel, payload),
        // 창이 닫히거나 reload되면 dialog가 사라져 답이 오지 않는다.
        onGone(run) {
          const navigated = (
            details: Electron.Event<
              Electron.WebContentsDidStartNavigationEventParams
            >,
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
    show: (
      input: {
        harness: string;
        ok: boolean;
        files: string[];
        message?: string;
        terminalRef?: string;
      },
    ) => asker.show({ ...input, label: harnessLabel(input.harness) }),
  };
  // 전역 hook 등록의 묻기·놓기. coding 탭을 열 때와 사람 터미널이 harness를 처음 알아봤을 때, Settings가 쓴다.
  const installer = createHookInstaller({
    runCli: lophnCli === null
      ? null
      : childCliRunner({ command: lophnCli, env: cliEnv, timeout_ms: 15_000 }),
    hookCommand: app.isPackaged ? undefined : lophnCli ?? undefined,
    hasHook: (harness) =>
      harness in HARNESS_HOOKS &&
      HARNESS_HOOKS[harness as keyof typeof HARNESS_HOOKS] !== null,
    register,
  });
  const bridgeWiring = createBridgeWiring(ctx);
  // 터미널 안 coding agent의 hook socket·상태·알림. 사람 터미널은 foreground process가 harness를 알려 준다.
  const notice = createNoticeWiring(ctx, terminalFocus);
  const agent = createAgentWiring({
    ctx,
    notice,
    runDir: bridgeWiring.runDir,
    terminals,
    identified: (harness, terminalRef) =>
      installer.ensureOnce(harness, terminalRef),
  });
  // core 요청으로 연 coding 탭. 결과와 끝은 사람 token으로 core에 알린다.
  const codingTerminals = createCodingTerminalRequests({
    supervisor: terminals,
    focus: terminalFocus,
    reportResult: (body) =>
      ctx.coreInternal("memory", "coding_agent_terminals", "result", body),
    reportExited: (body) =>
      ctx.coreInternal("memory", "coding_agent_terminals", "exited", body),
    installer,
    hooks: agent.hooks,
    opened: (terminalRef, harness) =>
      agent.tracker.registerCoding(terminalRef, harness),
    publish: (runtime) => agent.publish(agent.tracker.decorate(runtime)),
  });
  // Gateway가 main에만 보내는 coding 터미널 요청.
  ctx.relay.frames.push((frame) => {
    if (frame.type === "coding_terminal" && "request" in frame) {
      void codingTerminals.handle(frame.request);
    }
  });
  // `deno task dev:mock`의 project는 renderer 메모리에만 있어 core가 그 폴더를 모른다. 그때 터미널은
  // 실행마다 비우는 mock 데이터 root 안의 빈 폴더에서 연다.
  const mockFolder = process.env.LOPHN_DEV_MOCK === "1"
    ? join(dataRoot, "mock-terminal")
    : null;
  const terminalIpc = createTerminalIpc({
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
    coding: codingTerminals,
    bridge: bridgeWiring.bridge,
    hooks: agent.hooks,
    shellInit: agent.shellInit,
    agent: agent.tracker,
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
  ctx.windowHooks.created.push((window) =>
    attachTerminalSurface(overlays.overlayRegistry(), window)
  );
  ctx.windowHooks.closed.push((window) =>
    terminalFocus.forget(window.contentsId)
  );

  return {
    terminals,
    codingTerminals,
    stop() {
      clearInterval(detectOnConnect);
      removeTerminalIpc({ handle: () => {}, removeHandler: ipc.removeHandler });
      removeCodingIpc(ipc);
      terminals.stop();
      agent.stop();
      notice.stop();
      bridgeWiring.stop();
    },
  };
}
