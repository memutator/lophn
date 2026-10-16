// ScreenId마다 frame 안에 그릴 화면. Part 1(지금 화면)은 진짜 Desktop을 mock 데이터로 그리고,
// Part 2(새 설계)는 compositions/의 정적 구성을 그린다.
import type { ReactNode } from "react";

import type { ScreenId } from "../pages.ts";
import type { CoreSource } from "../../../packages/shell/renderer/desktop/connection/connection.ts";
import {
  APP_BUDGET,
} from "../../../packages/shell/renderer/desktop/dev-mock/ids.ts";
import {
  openApp,
  openLophn,
  openProject,
} from "../../../packages/shell/renderer/desktop/router.ts";
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
  SecretInputApp,
  SecretInputMcp,
  SecretInputProvider,
  WaitingActivation,
  WaitingDenyReason,
  WaitingFirstActivation,
  WaitingList,
  WaitingPermission,
  WaitingReaction,
  WaitingSettled,
  WaitingToasts,
} from "./compositions/waiting/waiting-pages.tsx";
import {
  AgentApproval,
  AgentApprovalDeny,
  AgentApprovalSettings,
  AgentApprovalStates,
  AgentCallOpen,
  AgentCallReplies,
  AgentCommands,
  AgentCommandsFiltered,
  AgentConversation,
  AgentModelPicker,
  AgentPermissions,
  AgentQuestion,
  AgentQuestionAnswered,
  AgentQuestionEnded,
  AgentQueuedMessage,
  AgentRecap,
  AgentRequestError,
  AgentRewind,
  AgentSenderChips,
  AgentSessionArchived,
  AgentSessions,
  AgentSessionsEdit,
} from "./compositions/agent-pages.tsx";
import {
  AgentsGroup,
  ContextSidebar,
  DocumentInfoContexts,
  ExplorerRootMenu,
  FileConflict,
  FileConflictCompare,
  FileDeleteConfirm,
  FileReloaded,
  FileSearchFolder,
  FileSearchOpened,
  FileSearchResults,
  InstructionsFile,
  MarkdownEditing,
  MediaFiles,
  OpenPathPalette,
  OutsideFile,
  TextFiles,
} from "./compositions/project-files/pages.tsx";
import {
  DocumentOrganize,
  DocumentTabInfo,
  DocumentTabPage,
  NewTabMenu,
  SidebarCollapsed,
  TabKinds,
} from "./compositions/project-pages.tsx";
import {
  ContextContractPage,
  ContextGlossaryAddPage,
  ContextGlossaryDeletePage,
  ContextGlossaryEditPage,
  ContextGlossaryPage,
  ContextOverviewPage,
  ContextRestoredPage,
  ContextsArchivedPage,
  ContextSearchesPage,
  ContextsTabPage,
  ContextVersionsPage,
  ContextViolationsPage,
  DeclaredSearchBoardPage,
  DeclaredSearchTablePage,
  ViolationSessionNewPage,
  ViolationSessionOpenPage,
  ViolationToastPage,
} from "./compositions/contexts/context-pages.tsx";
import { ContextWays } from "./compositions/ways-page.tsx";
import {
  AgentGrantsAppPage,
  AgentGrantsPage,
  AgentServerFormPage,
  AppEngineerEditorPage,
  OperatorCreatePage,
  OperatorEditorPage,
  ProjectAgentsPage,
  SettingsAgentsPage,
  SettingsConnectPage,
  SettingsLophnPage,
  SettingsProvidersPage,
  SettingsToolsPage,
} from "./compositions/agent-setup/agent-setup-pages.tsx";
import {
  AccessGrants,
  AccessRevoking,
  ActivityLog,
  AgentPaneOpen,
  AnnotateList,
  AnnotatePicking,
  AppSpaceFrame,
  CodingEnded,
  CodingOpenedToast,
  CodingPermission,
  CodingRunning,
  IssueRecurred,
  IssuesList,
  ProjectPickerInView,
  ReportExisting,
  ReportNew,
  RewindConfirm,
  RewindConflict,
  RewindDone,
  RewindRunning,
  VersionApplied,
  VersionApplying,
  VersionFailed,
} from "./compositions/app-space/pages.tsx";
import {
  LauncherEmpty,
  LauncherProjects,
  LauncherRegister,
  SettingsAppearance,
  SettingsCoding,
  SettingsDiagnostics,
  SettingsGeneral,
  SettingsReactions,
  SettingsRequiredEmpty,
  StartFailures,
  WorkspaceApps,
  WorkspaceFolderMissing,
  WorkspaceProjects,
  WorkspaceSubfolderAdd,
  WorkspaceSubfolderEdit,
} from "./compositions/workspace/pages.tsx";
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
  "settings-coding": () => settings("coding"),
  "settings-general": () => settings("general"),
  "settings-diagnostics": () => settings("diagnostics"),
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
  "app-space": () => <MockDesktop route={openApp(APP_BUDGET)} />,
  "new-waiting-list": () => <WaitingList />,
  "new-waiting-permission": () => <WaitingPermission />,
  "new-waiting-deny-reason": () => <WaitingDenyReason />,
  "new-waiting-activation": () => <WaitingActivation />,
  "new-waiting-first-activation": () => <WaitingFirstActivation />,
  "new-waiting-reaction": () => <WaitingReaction />,
  "new-waiting-settled": () => <WaitingSettled />,
  "new-waiting-toasts": () => <WaitingToasts />,
  "new-secret-input": () => <SecretInputProvider />,
  "new-secret-input-app": () => <SecretInputApp />,
  "new-secret-input-mcp": () => <SecretInputMcp />,
  "new-agent-conversation": () => <AgentConversation />,
  "new-agent-queued-message": () => <AgentQueuedMessage />,
  "new-agent-sender-chips": () => <AgentSenderChips />,
  "new-agent-call-open": () => <AgentCallOpen />,
  "new-agent-call-replies": () => <AgentCallReplies />,
  "new-agent-question": () => <AgentQuestion />,
  "new-agent-question-answered": () => <AgentQuestionAnswered />,
  "new-agent-question-ended": () => <AgentQuestionEnded />,
  "new-agent-approval": () => <AgentApproval />,
  "new-agent-approval-deny": () => <AgentApprovalDeny />,
  "new-agent-approval-settings": () => <AgentApprovalSettings />,
  "new-agent-approval-states": () => <AgentApprovalStates />,
  "new-agent-commands": () => <AgentCommands />,
  "new-agent-commands-filtered": () => <AgentCommandsFiltered />,
  "new-agent-recap": () => <AgentRecap />,
  "new-agent-permissions": () => <AgentPermissions />,
  "new-agent-model-picker": () => <AgentModelPicker />,
  "new-agent-request-error": () => <AgentRequestError />,
  "new-agent-rewind": () => <AgentRewind />,
  "new-agent-sessions": () => <AgentSessions />,
  "new-agent-sessions-edit": () => <AgentSessionsEdit />,
  "new-agent-session-archived": () => <AgentSessionArchived />,
  "new-explorer-root": () => <ExplorerRootMenu />,
  "new-sidebar-context": () => <ContextSidebar />,
  "new-agent-sidebar": () => <AgentsGroup />,
  "new-sidebar-collapsed": () => <SidebarCollapsed />,
  "new-tab-kinds": () => <TabKinds />,
  "new-tab-menu": () => <NewTabMenu />,
  "new-organize": () => <DocumentOrganize />,
  "new-file-delete": () => <FileDeleteConfirm />,
  "new-instructions-file": () => <InstructionsFile />,
  "new-file-open-path": () => <OpenPathPalette />,
  "new-file-outside": () => <OutsideFile />,
  "new-document-tab": () => <DocumentTabPage />,
  "new-document-editing": () => <MarkdownEditing />,
  "new-document-tab-info": () => <DocumentTabInfo />,
  "new-document-tab-contexts": () => <DocumentInfoContexts />,
  "new-viewer-text": () => <TextFiles />,
  "new-viewer-media": () => <MediaFiles />,
  "new-file-reloaded": () => <FileReloaded />,
  "new-file-conflict": () => <FileConflict />,
  "new-file-conflict-compare": () => <FileConflictCompare />,
  "new-file-search": () => <FileSearchResults />,
  "new-file-search-folder": () => <FileSearchFolder />,
  "new-file-search-opened": () => <FileSearchOpened />,
  "new-search-table": () => <DeclaredSearchTablePage />,
  "new-search-board": () => <DeclaredSearchBoardPage />,
  "new-contexts": () => <ContextsTabPage />,
  "new-contexts-archived": () => <ContextsArchivedPage />,
  "new-context-overview": () => <ContextOverviewPage />,
  "new-context-versions": () => <ContextVersionsPage />,
  "new-context-restored": () => <ContextRestoredPage />,
  "new-context-searches": () => <ContextSearchesPage />,
  "new-context-violations": () => <ContextViolationsPage />,
  "new-context-glossary": () => <ContextGlossaryPage />,
  "new-context-glossary-add": () => <ContextGlossaryAddPage />,
  "new-context-glossary-edit": () => <ContextGlossaryEditPage />,
  "new-context-glossary-delete": () => <ContextGlossaryDeletePage />,
  "new-context-contract": () => <ContextContractPage />,
  "new-ways-to-open": () => <ContextWays />,
  "new-violation-toast": () => <ViolationToastPage />,
  "new-agent-toast-opened": () => <ViolationSessionNewPage />,
  "new-violation-session-open": () => <ViolationSessionOpenPage />,
  "new-project-agents": () => <ProjectAgentsPage />,
  "new-operator-editor": () => <OperatorEditorPage />,
  "new-operator-create": () => <OperatorCreatePage />,
  "new-agent-editor-app-engineer": () => <AppEngineerEditorPage />,
  "new-agent-mcp-server-form": () => <AgentServerFormPage />,
  "new-agent-grants": () => <AgentGrantsPage />,
  "new-agent-grants-app": () => <AgentGrantsAppPage />,
  "new-app-space": () => <AppSpaceFrame />,
  "new-app-agent-pane": () => <AgentPaneOpen />,
  "new-app-version-applied": () => <VersionApplied />,
  "new-app-version-applying": () => <VersionApplying />,
  "new-app-version-failed": () => <VersionFailed />,
  "new-app-access": () => <AccessGrants />,
  "new-app-access-revoking": () => <AccessRevoking />,
  "new-app-activity": () => <ActivityLog />,
  "new-app-rewind-confirm": () => <RewindConfirm />,
  "new-app-rewind-running": () => <RewindRunning />,
  "new-app-rewind-done": () => <RewindDone />,
  "new-app-rewind-conflict": () => <RewindConflict />,
  "new-app-issues": () => <IssuesList />,
  "new-app-issue-detail": () => <IssueRecurred />,
  "new-app-report": () => <ReportNew />,
  "new-app-report-existing": () => <ReportExisting />,
  "new-app-annotate": () => <AnnotatePicking />,
  "new-app-annotate-list": () => <AnnotateList />,
  "new-app-project-picker": () => <ProjectPickerInView />,
  "new-app-coding-toast": () => <CodingOpenedToast />,
  "new-app-coding-terminal": () => <CodingRunning />,
  "new-app-coding-permission": () => <CodingPermission />,
  "new-app-coding-ended": () => <CodingEnded />,
  "new-workspace": () => <WorkspaceProjects />,
  "new-workspace-folder-missing": () => <WorkspaceFolderMissing />,
  "new-workspace-subfolder-add": () => <WorkspaceSubfolderAdd />,
  "new-workspace-subfolder-edit": () => <WorkspaceSubfolderEdit />,
  "new-workspace-apps": () => <WorkspaceApps />,
  "new-settings-general": () => <SettingsGeneral />,
  "new-settings-required-empty": () => <SettingsRequiredEmpty />,
  "new-settings-appearance": () => <SettingsAppearance />,
  "new-settings-providers": () => <SettingsProvidersPage />,
  "new-settings-connect": () => <SettingsConnectPage />,
  "new-settings-agents": () => <SettingsAgentsPage />,
  "new-settings-lophn": () => <SettingsLophnPage />,
  "new-settings-tools": () => <SettingsToolsPage />,
  "new-settings-coding": () => <SettingsCoding />,
  "new-settings-reactions": () => <SettingsReactions />,
  "new-settings-diagnostics": () => <SettingsDiagnostics />,
  "new-launcher-projects": () => <LauncherProjects />,
  "new-launcher-empty": () => <LauncherEmpty />,
  "new-launcher-register": () => <LauncherRegister />,
  "new-start-failure": () => <StartFailures />,
};
