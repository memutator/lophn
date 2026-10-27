// 개발 확인 전용. 주소에 `mock`이 있을 때만 Desktop의 모든 통로를 메모리 가짜로 채워 core 없이
// 모든 화면을 보게 한다(`npm run dev:mock`). 제품 경로는 주소 flag 없이 이 값을 만들지 않고,
// 가짜 통로는 core·파일·secret·coding agent에 닿지 않는다.
import type { LophnBrowserApi } from "../../../ipc/browser.ts";
import type { LophnShellAnnotateApi } from "../../../ipc/annotation.ts";
import type { LophnShellViewsApi } from "../../../ipc/app-frame.ts";
import type { InstructionsApi } from "../../../ipc/instructions.ts";
import type { AppViewsDeps } from "../../app-frame/app-views.tsx";
import type { AppDetailSource } from "../../app-frame/app-detail/source.ts";
import type { AgentTabSourceFactory } from "../../conversation/agent-tab-source.ts";
import type { WorkspaceSource } from "../../workspace/source.ts";
import type { EditorDeps } from "../../editor/document-view.tsx";
import type { CoreSource } from "../connection/connection.ts";
import type { AppsSource } from "../../apps/source.ts";
import type { SettingsPanels } from "../settings/settings-screen.tsx";
import type { SettingsSource } from "../settings/source.ts";
import type { ProjectsSource } from "../launcher/projects/source.ts";
import type { CatalogSource } from "../palette/catalog.ts";
import { catalogSource } from "../palette/core-catalog.ts";
import { fakeBrowserApi } from "../../browser/testdata/fake-browser-api.ts";
import { fakeAnnotate } from "../../app-frame/testdata/fake-annotate.ts";
import { seedWorkbench } from "../dev-seed.ts";
import { createFakeAgentsSource } from "../../workspace/agents/fake-source.ts";
import { mockApps, mockSettings, mockSettingsPanels } from "./admin.ts";
import { mockAppDetail, mockAppViews, mockViews } from "./app-space.ts";
import { mockAgentTabSource } from "./agent.ts";
import { mockCore, mockEvents } from "./requests.ts";
import { mockInstructions, mockProjects } from "./launcher.ts";

export interface DevMock {
  readonly core: CoreSource;
  readonly workspace: WorkspaceSource;
  /** 문서 탭 통로. 메뉴는 창의 overlay를 그대로 쓴다. */
  readonly editor: Omit<EditorDeps, "menu">;
  /** 팔레트의 project·앱 행. */
  readonly catalog: CatalogSource;
  /** 런처 카드와 앱 공간의 project 고르기. */
  readonly projects: ProjectsSource;
  readonly apps: AppsSource;
  readonly settings: SettingsSource;
  readonly settingsPanels: SettingsPanels;
  readonly appDetail: AppDetailSource;
  readonly views: LophnShellViewsApi;
  readonly annotate: LophnShellAnnotateApi;
  readonly appViews: AppViewsDeps;
  readonly browser: LophnBrowserApi;
  /** Agent 탭·앱 공간의 Agent 칸이 agent마다 얻는 source. */
  readonly agentViewSource: AgentTabSourceFactory;
  /** 대기 목록이 읽는 event 연결(fake Gateway). */
  readonly events: CoreSource;
  readonly instructions: InstructionsApi;
}

/** 주소에 mock이 있는지. */
function isDevMock(
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
  const views = mockViews();
  const projects = mockProjects();
  const apps = mockApps();
  return {
    core: mockCore(),
    // 어느 카드를 열어도 같은 시드 작업대다. 제목만 카드의 것을 쓴다.
    workspace: {
      ...bench.source,
      // Agents 탭과 sidebar의 Agents 묶음도 메모리 통로를 읽는다.
      agentsSource: createFakeAgentsSource(),
      // 목록도 런처 카드의 것이다(보관된 카드는 뺀다).
      projects: async () => {
        const cards = await projects.list();
        return cards.ok
          ? {
              ok: true,
              value: cards.value
                .filter((item) => !item.archived)
                .map(({ id, title }) => ({ id, title })),
            }
          : { ok: false, message: cards.code };
      },
      project: async (id) => {
        const read = await bench.source.project(id);
        const cards = await projects.list();
        const card = cards.ok
          ? cards.value.find((item) => item.id === id)
          : undefined;
        return read.ok && card !== undefined
          ? { ok: true, value: { ...read.value, id, title: card.title } }
          : read;
      },
    },
    editor: bench.editor,
    catalog: catalogSource(projects, apps),
    projects,
    apps,
    settings: mockSettings(),
    settingsPanels: mockSettingsPanels(),
    appDetail: mockAppDetail(),
    views,
    annotate: fakeAnnotate(),
    appViews: mockAppViews(views),
    browser: fakeBrowserApi().api,
    agentViewSource: mockAgentTabSource(),
    events: mockEvents(),
    instructions: mockInstructions(),
  };
}
