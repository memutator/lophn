// 기계 하나의 화면 통로 묶음과 그 묶음을 기계마다 드는 hub. 화면은 범위(`scope.tsx`)로 묶음을 고르고, 묶음의 통로는 모두
// 그 기계의 core로 간다. 이 컴퓨터의 묶음은 창에 붙은 통로(OS 폴더 고르기, 문서 편집, 글꼴)가 있어 entry가 짓고, 다른 기계의
// 묶음은 여기서 짓는다. 묶음마다의 갈래는 기계가 아니라 칸이 있고 없음(`here`, `appViews`, `terminal`)으로 보인다.
import {
  createElement,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { settingsList } from "../../../../protocol/config/file.ts";
import type { LophnShellViewsApi } from "../../../ipc/app-frame.ts";
import type { CoreApi } from "../../../ipc/core-api.ts";
import type { FolderPickerApi } from "../../../ipc/folder-picker.ts";
import { readOnlyAppDetailSource } from "../../app-frame/app-detail/remote-source.ts";
import type { AppDetailSource } from "../../app-frame/app-detail/source.ts";
import type { AppViewsDeps } from "../../app-frame/app-views.tsx";
import { machineAppViews } from "../../app-frame/machine-deps.ts";
import { coreAppsSource } from "../../apps/core-source.ts";
import type { AppsSource } from "../../apps/source.ts";
import { coreAgentTabSourceFactory } from "../../conversation/agent-tab-core-source.ts";
import { signInInputRequest } from "../../conversation/agent-tab-core-source-sign-in.ts";
import type { AgentTabSourceFactory } from "../../conversation/agent-tab-source.ts";
import type { EditorDeps } from "../../editor/document-view.tsx";
import { remoteEditorDeps } from "../../editor/window-deps.ts";
import {
  coreProjectIcons,
  type ProjectIconsDeps,
} from "../../parts/project-icon/project-icon.tsx";
import type { TerminalDeps } from "../../terminal/deps.ts";
import { machineTerminalDeps } from "../../terminal/machine-deps.ts";
import { coreAgentsSource } from "../../workspace/agents/core-source.ts";
import { coreWorkspaceSource } from "../../workspace/core-source.ts";
import type { WorkspaceSource } from "../../workspace/source.ts";
import {
  type CoreSource,
  thisComputerCoreSource,
} from "../connection/connection.ts";
import {
  createEventClient,
  type EventClient,
} from "../connection/events/client.ts";
import {
  createEventStores,
  type EventStores,
} from "../connection/events/hooks.tsx";
import { coreJobsSource } from "../jobs/core-source.ts";
import type { JobsSource } from "../jobs/source.ts";
import type { CatalogSource } from "../palette/catalog.ts";
import { catalogSource } from "../palette/core-catalog.ts";
import { coreAgentsSettingsSource } from "../settings/agents/core-source.ts";
import { windowSecretInputOpener } from "../settings/core-call.ts";
import { coreSettingsSource } from "../settings/core-source.ts";
import { coreCodingConnectionsSource } from "../settings/connections/core-source.ts";
import { coreDiagnosticsSource } from "../settings/diagnostics/core-source.ts";
import { coreProviderSettingsSource } from "../settings/providers/core-source.ts";
import { coreRemoteSource } from "../settings/remote/core-source.ts";
import type { QuickPrefsSource } from "../settings/quick-launch/source.ts";
import type { SettingsPanels } from "../settings/settings-screen.tsx";
import { coreShellRulesSource } from "../settings/shell-rules/core-source.ts";
import type { SettingsSource } from "../settings/source.ts";
import {
  coreBrowseFolders,
  createFolderBrowser,
} from "../workspaces/folder-browser.tsx";
import { coreProjectsSource } from "../workspaces/projects/core-source.ts";
import type { ProjectsSource } from "../workspaces/projects/source.ts";
import { machineCoreSource } from "./core-source.ts";
import { createRemoteFiles } from "./remote-files.ts";
import type { MachineRef } from "./scope.tsx";
import type { MachinesSource } from "./source.ts";

/** 목록 줄 하나와 그 줄의 기계. */
export type OnMachine<T> = T & { readonly machine: MachineRef };

export type FolderBrowser = ReturnType<typeof createFolderBrowser>;

export interface MachineData {
  readonly machine: MachineRef;
  /** 이 컴퓨터의 묶음. 이 컴퓨터의 shell host나 기기가 부를 수 없는 관리 route가 필요한 것(설정 탭, Agents)은 이것만 있다. */
  readonly here: boolean;
  readonly core: CoreSource;
  /** 이 기계의 event 연결. 범위의 store가 이 위에 선다. */
  readonly events: EventClient;
  readonly stores: EventStores;
  /** 다른 기계 workspace의 layout은 이 컴퓨터의 layout store에 기계와 함께 key해 저장한다(`workspaceKey`). 팔레트 파일 묶음(문서 목록)은 그 기계에서만 연다. */
  readonly workspace: WorkspaceSource;
  readonly projects: ProjectsSource;
  readonly apps: AppsSource;
  readonly catalog: CatalogSource;
  /** 다른 기계의 job은 켜고 끄기만 한다(기기의 `jobs/update`는 `enabled`만 받는다). */
  readonly jobs: JobsSource;
  readonly settings: SettingsSource;
  /** 다른 기계는 그 기계의 core에 걸린 항목만 있다(settings/model.ts의 MACHINE_PANES). */
  readonly settingsPanels: SettingsPanels;
  /** 빠른 실행·작업 표시줄·오른쪽 sidebar·tray 설정은 이 컴퓨터의 값이다. 다른 기계 묶음도 이 컴퓨터의 것을 쓴다. */
  readonly quickPrefs: QuickPrefsSource | undefined;
  readonly agentViewSource: AgentTabSourceFactory;
  /** 문서 탭. 다른 기계는 그 기계의 등록 폴더 file을 `project_files/*`로 읽고 쓴다. */
  readonly editor?: EditorDeps;
  /** App details. 다른 기계는 읽기만 하는 source다(`readOnlyAppDetailSource`). */
  readonly appDetail?: AppDetailSource;
  /** OS 선택기는 이 컴퓨터의 폴더를 보여 다른 기계는 그 기계의 폴더 목록 dialog로 고른다. 그 dialog 자리는 범위가 그린다. */
  readonly folders: FolderBrowser | null;
  readonly picker: FolderPickerApi | undefined;
  readonly terminal: TerminalDeps | undefined;
  readonly appViews: AppViewsDeps | null;
  readonly projectIcons: ProjectIconsDeps;
  /** 그 기계가 이 컴퓨터에 사람의 route(설정, provider, project 더하기)를 열었는지. 이 컴퓨터는 늘 true다. */
  grant(): Promise<boolean>;
}

export interface MachineHub {
  /** 그 기계의 묶음. 같은 기계면 같은 묶음이다. */
  get(machine: MachineRef): MachineData;
  stop(): void;
}

export interface MachineHubDeps {
  /** 이 컴퓨터의 묶음. 처음 쓸 때 한 번 부른다. */
  here(): MachineData;
  /** preload의 core 통로. 없는 창(개발 mock)에는 다른 기계가 없다. */
  readonly bridge: CoreApi | undefined;
  readonly machines: MachinesSource | null;
  /** shell preload의 앱 view 통로. */
  readonly views: LophnShellViewsApi | undefined;
}

/**
 * 다른 기계의 묶음은 처음 쓸 때 짓고, 그 기계가 명단에서 빠지면 그 구독을 거두고 버린다(다시 들어오면 새로 짓는다).
 * 이 컴퓨터의 id로 물으면 이 컴퓨터의 묶음이다.
 */
export function createMachineHub(deps: MachineHubDeps): MachineHub {
  let here: MachineData | undefined;
  const others = new Map<string, MachineData>();
  let stopList: (() => void) | null = null;
  // 다른 기계의 연결 상태가 함께 보는 이 컴퓨터의 core 연결.
  let local: CoreSource | undefined;
  function prune() {
    const view = deps.machines?.get();
    if (view?.state !== "ready") return;
    for (const [machine, data] of others) {
      if (!view.machines.some((one) => one.id === machine)) {
        others.delete(machine);
        void data.core.watch?.([]).catch(() => {});
      }
    }
  }
  return {
    get(machine) {
      if (
        machine === null ||
        machine === deps.machines?.get().thisComputer?.id
      ) {
        return (here ??= deps.here());
      }
      const known = others.get(machine);
      if (known !== undefined) return known;
      if (deps.bridge === undefined || deps.machines === null) {
        throw new Error("this window has no other machines");
      }
      stopList ??= deps.machines.subscribe(prune);
      local ??= thisComputerCoreSource();
      const data = otherMachineData(
        machine,
        machineCoreSource(machine, deps.bridge, deps.machines, local),
        deps.views,
        (here ??= deps.here()).quickPrefs,
      );
      others.set(machine, data);
      return data;
    },
    stop() {
      stopList?.();
      stopList = null;
      others.clear();
    },
  };
}

function otherMachineData(
  machine: string,
  core: CoreSource,
  views: LophnShellViewsApi | undefined,
  quickPrefs: QuickPrefsSource | undefined,
): MachineData {
  const events = createEventClient(core);
  const folders = oneHost(createFolderBrowser(coreBrowseFolders(core)));
  const picker = folders.picker;
  const projects = coreProjectsSource(core, picker);
  const apps = coreAppsSource(core);
  // 보호 secret 창의 값은 그 기계의 link로만 간다.
  const openSecret = windowSecretInputOpener(machine);
  const { list, runs, setEnabled } = coreJobsSource(core);
  // 대기 목록의 Finished 줄이 그 기계 터미널의 runtime(`TerminalRuntimeChanged`)을 듣는다.
  const terminal = machineTerminalDeps(machine, core, events);
  // 다른 기계의 project 등록 폴더 파일은 `project_files/*` + cache 통로로 읽고 쓴다.
  const remoteFiles = createRemoteFiles(machine, core);
  const baseWorkspace = coreWorkspaceSource(core);
  // 이 컴퓨터의 창 통로(디스크 file, OS 폴더 고르기, 지침·memory file)는 이 묶음에 하나도 없다. 그 통로는 이 컴퓨터의 것을 열고
  // 고치므로 다른 기계에서는 unavailable이다.
  const local = { instructions: undefined, files: undefined } as const;
  return {
    machine,
    here: false,
    core,
    events,
    stores: createEventStores(events, terminal.store),
    workspace: {
      ...baseWorkspace,
      ...NO_LOCAL_FILES,
      ...remoteFiles.workspaceFiles,
      async project(id) {
        const read = await baseWorkspace.project(id);
        if (read.ok)
          remoteFiles.registerProject(read.value.id, read.value.folders);
        return read;
      },
      agentsSource: coreAgentsSource(core, {
        ...local,
        memory: undefined,
        openSecret,
      }),
    },
    projects,
    apps,
    catalog: catalogSource(projects, apps),
    jobs: { list, runs, setEnabled },
    settings: coreSettingsSource(core),
    settingsPanels: {
      providers: coreProviderSettingsSource(core, {
        machine: true,
        openSecret,
      }),
      agents: coreAgentsSettingsSource(core, { ...local, picker, openSecret }),
      coding: coreCodingConnectionsSource(core),
      diagnostics: coreDiagnosticsSource(core),
      shellRules: coreShellRulesSource(core),
      // 다른 기계의 Remote 항목은 그 기계의 Keep running만 그린다(RemotePanel).
      remote: coreRemoteSource(core),
    },
    quickPrefs,
    appDetail: readOnlyAppDetailSource,
    editor: remoteEditorDeps(core, remoteFiles.editorFiles),
    // sign_in card의 로그인도 돌린다(provider 로그인은 그 기계의 core가 기다린다). card가 device code만 단추로 둔다.
    agentViewSource: coreAgentTabSourceFactory(core, {
      device: true,
      signIn: signInInputRequest,
    }),
    folders,
    picker,
    terminal,
    appViews: machineAppViews(machine, core, views, undefined),
    projectIcons: coreProjectIcons(core),
    grant: () => machineGrant(core),
  };
}

const UNAVAILABLE = { ok: false, code: "unavailable" } as const;
const unavailable = () => Promise.resolve(UNAVAILABLE);

// 이 컴퓨터의 디스크와 OS 폴더 고르기로 가는 작업대 칸. 다른 기계의 workspace는 팔레트 파일 묶음(문서 목록)도 읽지 않는다.
const NO_LOCAL_FILES = {
  files: () => Promise.resolve({ ok: true as const, value: [] }),
  list: () => Promise.resolve({ ok: false as const, message: "unavailable" }),
  addFolder: () =>
    Promise.resolve({ ok: false as const, message: "unavailable" }),
  create: unavailable,
  rename: unavailable,
  copy: unavailable,
  writeBytes: unavailable,
  trash: unavailable,
  reveal: unavailable,
} satisfies Partial<WorkspaceSource>;

// 같은 기계의 범위가 여럿 서도(그 기계의 탭 여럿) 폴더 dialog는 먼저 선 자리 하나에만 그린다.
function oneHost(browser: FolderBrowser): FolderBrowser {
  const mounted: symbol[] = [];
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((listener) => listener());
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  function Host() {
    const [me] = useState(() => Symbol());
    useEffect(() => {
      mounted.push(me);
      changed();
      return () => {
        mounted.splice(mounted.indexOf(me), 1);
        changed();
      };
    }, [me]);
    const first = useSyncExternalStore(subscribe, () => mounted[0] === me);
    return first ? createElement(browser.Host) : null;
  }
  return { picker: browser.picker, Host };
}

// 판정은 `settings/list`의 forbidden이다(터미널 입력 허락이 없는 기기).
async function machineGrant(core: CoreSource): Promise<boolean> {
  const reply = await core.call({
    kind: settingsList.kind,
    resource: settingsList.resource,
    method: settingsList.method,
    body: {},
  });
  return reply.ok || reply.error?.code !== "forbidden";
}
