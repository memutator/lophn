// harness 감지, 터미널 supervisor, 터미널·coding IPC.
import { app } from "electron";
import { join } from "node:path";

import {
  attachTerminalSurface,
  registerTerminalIpc,
  removeTerminalIpc,
  TerminalFocusTable,
} from "../../terminal/controller.ts";
import { createChildRegistrar } from "../../terminal/coding/coding-children.ts";
import { createObservationStore } from "../../terminal/coding/coding-start.ts";
import { createTerminalIpc } from "../../terminal/ipc.ts";
import { createSupervisor, spawnNodeHost } from "../../terminal/supervisor.ts";
import {
  childCliRunner,
  createHarnessSettings,
  type HarnessCatalog,
} from "../coding-connection.ts";
import {
  createCodingIpc,
  hostEventSinks,
  registerCodingIpc,
  removeCodingIpc,
} from "../coding-ipc.ts";
import {
  canDeliverMessages,
  canLaunch,
  HARNESS_ADAPTERS,
  harnessDetectionSchema,
} from "../../../../protocol/coding-agent/mod.ts";
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

/** 뒤 영역(종료 흐름)이 쓰는 터미널 supervisor. */
export type Coding = Registered & {
  terminals: ReturnType<typeof createSupervisor>;
};

// lophn이 띄운 coding TUI 아래 MCP·CLI process를 host가 관측해 알리면 main이 자기 사람 credential로 core에
// 등록·해제한다. 같은 줄이 TUI 관측(ObservationStore)도 채운다. 관측 표는 이 process의
// 메모리라 Electron이 다시 뜨면 비고 모든 TUI는 unknown이다(자동 spawn·resume 없음).
export function register(ctx: ShellContext): Coding {
  const { here, dataRoot, overlays, core, ipc } = ctx;
  const codingChildren = createChildRegistrar({ core: () => core.session() });
  const observations = createObservationStore({
    now: () => new Date().toISOString(),
  });
  const hostSinks = hostEventSinks(codingChildren, observations);
  const terminals = createSupervisor({
    // build가 host를 main과 같은 dist에 묶는다. 생성만 하고 첫 요청 때 띄운다.
    entry: join(here, "terminal-host.cjs"),
    spawnHost: spawnNodeHost,
    onEvent: (event) => hostSinks.onEvent(event),
    onHostLost: () => hostSinks.onHostLost(),
  });

  // coding agent 연결과 ticket [Start]. `lophn` 실행 파일과 helper는 설치 묶음에 있다(Linux .deb의
  // `/usr/bin/lophn`, `<설치 root>/lophn-credential`). 개발 실행은 LOPHN_CLI(절대 경로)를 준 때만 child를 부르고,
  // 없으면 연결·시작은 unavailable이다. child에는 이 main의 데이터 root만 환경으로 준다.
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

  // terminal IPC. sender·frame 검사는 registry로, focus·generation은 ipc.ts가 본다.
  // folder_ref는 documents의 등록 폴더 read를 다시 해석하고, 출력은 잡아 당기는
  // snapshot으로만 renderer에 다시 보인다.
  const terminalFocus = new TerminalFocusTable();
  const terminalIpc = createTerminalIpc({
    registry: overlays.overlayRegistry(),
    focus: terminalFocus,
    folders: {
      folders: (project) => projectFolders(core.session(), project),
    },
    host: terminals,
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

  return {
    terminals,
    stop() {
      removeTerminalIpc({ handle: () => {}, removeHandler: ipc.removeHandler });
      removeCodingIpc(ipc);
      terminals.stop();
    },
  };
}
