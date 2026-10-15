// 개발 확인 전용. 주소에 `mock`이 있을 때만 Desktop의 모든 통로를 메모리 가짜로 채워 core 없이
// 모든 화면을 보게 한다(`deno task dev:mock`). 제품 경로는 주소 flag 없이 이 값을 만들지 않고,
// 가짜 통로는 core·파일·keychain·coding agent에 닿지 않는다.
import type { LophnAppWindowsApi } from "../../../ipc/app-window.ts";
import type { LophnShellFeedbackBegin } from "../../../ipc/feedback.ts";
import type { LophnShellViewsApi } from "../../../ipc/app-frame.ts";
import type { InstructionsApi } from "../../../ipc/instructions.ts";
import type { AppViewsDeps } from "../../app-frame/app-views.tsx";
import type { AppDetailSource } from "../../app-frame/app-detail/source.ts";
import type { IssuesSource } from "../../app-frame/app-detail/issues/source.ts";
import type { AgentViewSourceFactory } from "../../conversation/agent-source.ts";
import type { WorkspaceSource } from "../../workspace/source.ts";
import type { EditorDeps } from "../../editor/document-view.tsx";
import type { CoreSource } from "../connection/connection.ts";
import type { LauncherSource } from "../launcher/source.ts";
import type { AppsSource } from "../lophn-space/apps/source.ts";
import type { SettingsPanels } from "../lophn-space/settings/settings-screen.tsx";
import type { CodingConnectionsSource } from "../lophn-space/settings/connections/source.ts";
import type { SettingsSource } from "../lophn-space/settings/source.ts";
import type { LophnSource } from "../lophn-space/source.ts";
import { contextExampleFiles, seedWorkbench } from "../dev-seed.ts";
import { createFakeAgentsSource } from "../../workspace/agents/fake-source.ts";
import { createFakeContextsSource } from "../../workspace/contexts/fake-source.ts";
import {
  mockApps,
  mockCoding,
  mockSettings,
  mockSettingsPanels,
} from "./admin.ts";
import {
  mockAppDetail,
  mockAppViews,
  mockAppWindows,
  mockFeedback,
  mockIssues,
  mockViews,
} from "./app-space.ts";
import { mockAgentViewSource } from "./agent.ts";
import { mockCore, mockEvents } from "./requests.ts";
import { mockLophn } from "./lophn.ts";
import { mockInstructions, mockLauncher } from "./launcher.ts";

export interface DevMock {
  readonly core: CoreSource;
  readonly launcher: LauncherSource;
  readonly workspace: WorkspaceSource;
  /** 문서 탭 통로. 메뉴는 창의 overlay를 그대로 쓴다. */
  readonly editor: Omit<EditorDeps, "menu">;
  readonly lophn: LophnSource;
  readonly apps: AppsSource;
  readonly settings: SettingsSource;
  readonly settingsPanels: SettingsPanels;
  readonly coding: CodingConnectionsSource;
  readonly issues: IssuesSource;
  readonly appDetail: AppDetailSource;
  readonly views: LophnShellViewsApi;
  readonly appViews: AppViewsDeps;
  readonly appWindows: LophnAppWindowsApi;
  readonly feedback: LophnShellFeedbackBegin;
  /** Agent 탭·앱 공간의 Agent 칸이 agent마다 얻는 source. */
  readonly agentViewSource: AgentViewSourceFactory;
  /** 대기 목록이 읽는 event 연결(fake Gateway). */
  readonly events: CoreSource;
  readonly instructions: InstructionsApi;
}

/** 주소에 mock이 있는지. */
export function isDevMock(
  search: string = globalThis.location?.search ?? "",
): boolean {
  return new URLSearchParams(search).has("mock");
}

/** 주소에 mock이 있으면 가짜 통로 모음을, 없으면 null을 돌려준다. */
export function devMock(
  search: string = globalThis.location?.search ?? "",
): DevMock | null {
  if (!isDevMock(search)) return null;
  const bench = seedWorkbench();
  const launcher = mockLauncher();
  const views = mockViews();
  return {
    core: mockCore(),
    launcher,
    // 어느 카드를 열어도 같은 시드 작업대다. 제목만 카드의 것을 쓴다.
    workspace: {
      ...bench.source,
      // Contexts·Context·Search 탭은 화면 시험이 쓰는 fake를 그대로 읽는다. 만드는 중인 context도 있다.
      contextsSource: createFakeContextsSource({ drafting: true }),
      // Agents 탭과 sidebar의 Agents 묶음도 메모리 통로를 읽는다.
      agentsSource: createFakeAgentsSource(),
      // 검색 결과·Overview 예시가 가리키는 문서도 파일로 잡혀 탭으로 열린다.
      files: async (project) => {
        const read = await bench.source.files(project);
        return read.ok
          ? { ok: true, value: [...read.value, ...contextExampleFiles()] }
          : read;
      },
      project: async (id) => {
        const read = await bench.source.project(id);
        const cards = await launcher.projects();
        const card = cards.ok
          ? cards.value.find((item) => item.id === id)
          : undefined;
        return read.ok && card !== undefined
          ? { ok: true, value: { ...read.value, id, title: card.title } }
          : read;
      },
    },
    editor: bench.editor,
    lophn: mockLophn(),
    apps: mockApps(),
    settings: mockSettings(),
    settingsPanels: mockSettingsPanels(),
    coding: mockCoding(),
    issues: mockIssues(),
    appDetail: mockAppDetail(),
    views,
    appViews: mockAppViews(views),
    appWindows: mockAppWindows(),
    feedback: mockFeedback(),
    agentViewSource: mockAgentViewSource(),
    events: mockEvents(),
    instructions: mockInstructions(),
  };
}
