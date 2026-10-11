// ScreenId마다 frame 안에 그릴 화면. Part 1(지금 화면)은 진짜 Desktop을 mock 데이터로 그리고,
// Part 2(새 설계)는 compositions/의 정적 구성을 그린다.
import type { ReactNode } from "react";

import type { ScreenId } from "../pages.ts";
import type { CoreSource } from "../../../apps/shell/renderer/desktop/connection/connection.ts";
import {
  APP_BUDGET,
} from "../../../apps/shell/renderer/desktop/dev-mock/ids.ts";
import {
  openApp,
  openLophn,
  openProject,
} from "../../../apps/shell/renderer/desktop/router.ts";
import {
  ComponentsButtons,
  ComponentsCards,
  ComponentsDialogs,
  ComponentsForms,
  ComponentsFrames,
  ComponentsMenus,
  ComponentsNavigation,
  ComponentsStates,
  ComponentsTable,
  ComponentsToast,
} from "./design/components-pages.tsx";
import {
  SdkActions,
  SdkCharts,
  SdkControls,
  SdkFilters,
  SdkLayout,
  SdkOverlays,
  SdkReading,
  SdkStates,
  SdkStats,
  SdkTable,
  SdkTokens,
} from "./design/sdk-pages.tsx";
import {
  TokensColors,
  TokensIcons,
  TokensSpace,
  TokensType,
} from "./design/tokens-pages.tsx";
import {
  ContextContract,
  ContextOverview,
  ContextsTab,
  ContextViolations,
  DeclaredSearchBoard,
  DeclaredSearchTable,
  DocumentOrganize,
  DocumentTabInfo,
  DocumentTabPage,
  NewContextDrafting,
  NewContextFormPage,
  NewTabMenu,
  SidebarCollapsed,
  TabKinds,
  ViolationToast,
} from "./compositions/project-pages.tsx";
import { ContextWays } from "./compositions/ways-page.tsx";
import { WorkspaceWithoutProject } from "./compositions/workspace-page.tsx";
import {
  MockDesktop,
  type PaneSpec,
  PROJECT_GROCERY,
  type SettingsTab,
} from "./mock-desktop.tsx";

type FailureState = "failed-start" | "failed-sandbox" | "failed-schema";

// core 연결이 이 상태로 고정된 창. 런처가 시작 실패 화면을 보인다.
function failedCore(state: FailureState): CoreSource {
  const current = { state, confirmedAt: null } as const;
  return {
    subscribe(listener) {
      listener(current);
      return () => {};
    },
    current: () => current,
    call: () =>
      Promise.resolve({
        ok: false,
        error: { code: "unavailable", message: "wireframes gallery" },
      }),
  };
}

const NOTES = {
  key: "doc_notes",
  kind: "document_editor",
  title: "notes",
} as const;
const PLAN = {
  key: "doc_plan",
  kind: "document_editor",
  title: "plan",
} as const;

const DOCUMENT_PANES: readonly PaneSpec[] = [
  { tabs: [NOTES, PLAN], selected: NOTES.key },
];
const TERMINAL_PANES: readonly PaneSpec[] = [
  { tabs: [NOTES, PLAN], selected: NOTES.key },
  {
    tabs: [{ key: "term_1", kind: "terminal", title: "grocery" }],
    selected: "term_1",
  },
];
const APP_PANEL_PANES: readonly PaneSpec[] = [
  { tabs: [NOTES, PLAN], selected: NOTES.key },
  {
    tabs: [{
      key: "panel_1",
      kind: "app_panel",
      title: "Grocery budget",
      app: APP_BUDGET,
      screen: "home",
    }],
    selected: "panel_1",
  },
];

function settings(tab: SettingsTab): ReactNode {
  return <MockDesktop route={openLophn("settings")} settingsTab={tab} />;
}

export const SCREENS: Record<ScreenId, () => ReactNode> = {
  "tokens-colors": () => <TokensColors />,
  "tokens-type": () => <TokensType />,
  "tokens-space": () => <TokensSpace />,
  "tokens-icons": () => <TokensIcons />,
  "components-buttons": () => <ComponentsButtons />,
  "components-forms": () => <ComponentsForms />,
  "components-navigation": () => <ComponentsNavigation />,
  "components-table": () => <ComponentsTable />,
  "components-menus": () => <ComponentsMenus />,
  "components-dialogs": () => <ComponentsDialogs />,
  "components-toast": () => <ComponentsToast />,
  "components-states": () => <ComponentsStates />,
  "components-cards": () => <ComponentsCards />,
  "components-frames": () => <ComponentsFrames />,
  "sdk-tokens": () => <SdkTokens />,
  "sdk-layout": () => <SdkLayout />,
  "sdk-table": () => <SdkTable />,
  "sdk-actions": () => <SdkActions />,
  "sdk-controls": () => <SdkControls />,
  "sdk-filters": () => <SdkFilters />,
  "sdk-states": () => <SdkStates />,
  "sdk-reading": () => <SdkReading />,
  "sdk-overlays": () => <SdkOverlays />,
  "sdk-stats": () => <SdkStats />,
  "sdk-charts": () => <SdkCharts />,
  "launcher-empty": () => <MockDesktop emptyLauncher />,
  "launcher-projects": () => <MockDesktop />,
  "launcher-start-failed": () => (
    <MockDesktop core={failedCore("failed-start")} />
  ),
  "launcher-sandbox-failed": () => (
    <MockDesktop core={failedCore("failed-sandbox")} />
  ),
  "launcher-schema-failed": () => (
    <MockDesktop core={failedCore("failed-schema")} />
  ),
  "lophn-projects": () => <MockDesktop route={openLophn("projects")} />,
  "lophn-apps": () => <MockDesktop route={openLophn("apps")} />,
  "lophn-things-to-confirm": () => (
    <MockDesktop route={openLophn("things-to-confirm")} />
  ),
  "lophn-roles": () => <MockDesktop route={openLophn("roles")} />,
  "settings-connections": () => settings("connections"),
  "settings-coding": () => settings("coding"),
  "settings-extensions": () => settings("extensions"),
  "settings-general": () => settings("general"),
  "settings-update": () => settings("update"),
  "settings-diagnostics": () => settings("diagnostics"),
  "settings-notifications": () => settings("notifications"),
  "project-document": () => (
    <MockDesktop
      route={openProject(PROJECT_GROCERY)}
      panes={DOCUMENT_PANES}
    />
  ),
  "project-terminal": () => (
    <MockDesktop
      route={openProject(PROJECT_GROCERY)}
      panes={TERMINAL_PANES}
      openTerminal="term_1"
    />
  ),
  "project-app-panel": () => (
    <MockDesktop
      route={openProject(PROJECT_GROCERY)}
      panes={APP_PANEL_PANES}
    />
  ),
  "app-space": () => <MockDesktop route={openApp(APP_BUDGET)} />,
  "conversation-dock": () => (
    <MockDesktop route={openLophn("projects")} dockOpen />
  ),
  "new-tab-kinds": () => <TabKinds />,
  "new-tab-menu": () => <NewTabMenu />,
  "new-context-overview": () => <ContextOverview />,
  "new-context-contract": () => <ContextContract />,
  "new-context-violations": () => <ContextViolations />,
  "new-violation-toast": () => <ViolationToast />,
  "new-search-table": () => <DeclaredSearchTable />,
  "new-search-board": () => <DeclaredSearchBoard />,
  "new-workspace": () => <WorkspaceWithoutProject />,
  "new-organize": () => <DocumentOrganize />,
  "new-sidebar-collapsed": () => <SidebarCollapsed />,
  "new-contexts": () => <ContextsTab />,
  "new-context-form": () => <NewContextFormPage />,
  "new-context-drafting": () => <NewContextDrafting />,
  "new-ways-to-open": () => <ContextWays />,
  "new-document-tab": () => <DocumentTabPage />,
  "new-document-tab-info": () => <DocumentTabInfo />,
};
