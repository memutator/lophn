// Lophn Workspace, 런처, 시작 실패의 새 설계 page. 모두 인자 없이 한 상태를 그린다.

import { WorkspaceWithoutProject } from "../workspace-page.tsx";
import { MISSING_FOLDER } from "../../../../../packages/shell/renderer/desktop/launcher/projects/testdata/fake-projects.ts";
import { click, type } from "../../../mock/drive.ts";

/** Projects: 목록(보관한 project 포함)과 상세. */
export const WorkspaceProjects = () => <WorkspaceWithoutProject />;

/** Projects: 등록한 폴더 하나가 사라진 상태. 알림은 탭 위쪽 toast다. */
export const WorkspaceFolderMissing = () => (
  <WorkspaceWithoutProject missingFolder={MISSING_FOLDER} />
);

/** Projects: 하위 폴더를 더하는 dialog. 고르기는 등록 폴더 안으로만 열린다. */
export const WorkspaceSubfolderAdd = () => (
  <WorkspaceWithoutProject
    steps={[
      () => click("[data-add-subfolder]"),
      () => click('[data-expand="src"]'),
      () => click('[data-pick="src/tools"]'),
      () =>
        type("[data-subfolder-new-description]", "Small command-line helpers"),
    ]}
  />
);

/** Projects: 하위 폴더의 설명을 고쳤고 하나를 뺀 상태. */
export const WorkspaceSubfolderEdit = () => (
  <WorkspaceWithoutProject
    steps={[
      () =>
        type(
          "[data-subfolder-description]",
          "Experiment runs, results and score tables",
        ),
      () => click("[data-remove-subfolder]", undefined, -1),
    ]}
  />
);

/** Apps. */
export const WorkspaceApps = () => <WorkspaceWithoutProject screen="apps" />;

/** Settings › General. */
export const SettingsGeneral = () => (
  <WorkspaceWithoutProject screen="settings" pane="general" />
);

/** Settings › General: 필수 설정이 비어 그 기능만 시작하지 않는 상태. 알림은 탭 위쪽 toast다. */
export const SettingsRequiredEmpty = () => (
  <WorkspaceWithoutProject screen="settings" pane="general" requiredEmpty />
);

/** Settings › Appearance. */
export const SettingsAppearance = () => (
  <WorkspaceWithoutProject screen="settings" pane="appearance" />
);

/** Settings › Coding agents. */
export const SettingsCoding = () => (
  <WorkspaceWithoutProject screen="settings" pane="coding" />
);

/** Settings › Reactions. */
export const SettingsReactions = () => (
  <WorkspaceWithoutProject screen="settings" pane="reactions" />
);

/** Settings › Diagnostics. */
export const SettingsDiagnostics = () => (
  <WorkspaceWithoutProject screen="settings" pane="diagnostics" />
);

export {
  LauncherEmpty,
  LauncherProjects,
  LauncherRegister,
} from "./launcher-pages.tsx";
export { StartFailures } from "./start-failure-page.tsx";
