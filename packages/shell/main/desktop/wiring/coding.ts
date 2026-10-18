// harness 감지, 터미널 supervisor, 터미널·coding IPC.
import { app, BrowserWindow, dialog } from "electron";
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
import { TERMINAL_STATE_CHANNEL } from "../../../ipc/terminal.ts";
import {
  canDeliverMessages,
  canLaunch,
  HARNESS_ADAPTERS,
  harnessDetectionSchema,
} from "../../../../protocol/coding-agent/mod.ts";
import { word } from "../wording.ts";
import { createBridgeWiring } from "./bridge.ts";
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
  // 전역 hook·skill 등록을 OS 확인 창으로 묻고 결과를 보인다(quit 확인과 같은 종류). headless는 창을 안 띄운다.
  async function box(options: Electron.MessageBoxOptions) {
    const parent = BrowserWindow.getFocusedWindow();
    return parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options);
  }
  const register = {
    async ask(input: { harness: string; files: string[] }): Promise<boolean> {
      if (ctx.headless.headless) return false;
      const reply = await box({
        type: "question",
        buttons: [word("common.button.register"), word("common.button.cancel")],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        message: word("common.title.register-coding-agent"),
        detail: `${word("common.notice.register-coding-agent")}\n\n${
          harnessLabel(input.harness)
        }\n${input.files.join("\n")}`,
      });
      return reply.response === 0;
    },
    async show(
      input: {
        harness: string;
        ok: boolean;
        files: string[];
        message?: string;
      },
    ): Promise<void> {
      if (ctx.headless.headless) return;
      await box({
        type: input.ok ? "info" : "error",
        buttons: [word("common.button.close")],
        noLink: true,
        message: word(
          input.ok
            ? "common.title.coding-agent-registered"
            : "common.title.coding-agent-register-failed",
        ),
        detail: input.ok
          ? `${word("common.notice.coding-agent-registered")}\n\n${
            input.files.join("\n")
          }`
          : `${word("common.notice.coding-agent-register-failed")}\n\n${
            input.message ?? ""
          }`,
      });
    },
  };
  // core 요청으로 연 coding 탭. 결과와 끝은 사람 token으로 core에 알린다. 전역 hook·skill 등록은 CLI가 한다.
  const codingTerminals = createCodingTerminalRequests({
    supervisor: terminals,
    focus: terminalFocus,
    reportResult: (body) =>
      ctx.coreInternal("memory", "coding_agent_terminals", "result", body),
    reportExited: (body) =>
      ctx.coreInternal("memory", "coding_agent_terminals", "exited", body),
    runCli: lophnCli === null
      ? null
      : childCliRunner({ command: lophnCli, env: cliEnv, timeout_ms: 15_000 }),
    register,
    hookCommand: app.isPackaged ? undefined : lophnCli ?? undefined,
    publish: (runtime) => {
      for (const window of ctx.windows) {
        if (!window.isDestroyed()) {
          window.webContents.send(TERMINAL_STATE_CHANNEL, runtime);
        }
      }
    },
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
  const bridgeWiring = createBridgeWiring(ctx);
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
  });
  registerTerminalIpc(ipc, terminalIpc);
  // Settings › Coding agents의 감지. desktop 창 본문만 부른다.
  registerCodingIpc(
    ipc,
    createCodingIpc({
      registry: overlays.overlayRegistry(),
      harnesses: harnessSettings,
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
      bridgeWiring.stop();
    },
  };
}
