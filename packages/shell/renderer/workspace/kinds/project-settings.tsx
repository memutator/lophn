// project settings 탭 kind. project 창에 하나이고 값은 project 등록과 rail_apps에 있어 탭은 열려 있다는 사실만 저장한다.
import { t } from "@lophn/i18n";

import { commonIcons } from "../../icons/mod.ts";
import { ProjectIconField } from "../../parts/project-icon/project-icon.tsx";
import { PaddedTab } from "../padded-tab.tsx";
import { ProjectSettingsPage } from "../project-settings/project-settings-page.tsx";
import type { TabHost } from "./host.ts";
import type { TabKindDef } from "./kind.ts";

// 고정 key라 다시 열면 열려 있는 탭을 고른다(openTab은 같은 key면 고르기만 한다).
const PROJECT_SETTINGS_KEY = "project-settings";

/** Project settings 탭을 연다. 이미 열려 있으면 고르기만 한다. */
export function openProjectSettings(host: TabHost): void {
  host.openTab({
    key: PROJECT_SETTINGS_KEY,
    kind: "project_settings",
    title: t("project-workspace.label.kind-project-settings"),
  });
}

export const projectSettingsKind: TabKindDef = {
  kind: "project_settings",
  labelKey: "project-workspace.label.kind-project-settings",
  icon: commonIcons.settings,
  // 탭 하나가 project 창의 설정 전체라 다른 창으로 떼어 내지 않는다.
  noDetach: true,
  fromStored: (_stored, { key }) => ({
    key,
    kind: "project_settings",
    title: t("project-workspace.label.kind-project-settings"),
  }),
  toStored: (tab) =>
    tab.key === PROJECT_SETTINGS_KEY
      ? { kind: "project_settings", key: tab.key }
      : null,
  render(_tab, _active, host) {
    const slice = host.projectSettings;
    if (slice === null) return null;
    return (
      <PaddedTab bare>
        <ProjectSettingsPage
          projectId={host.projectId}
          projects={slice.projects}
          onProjectChanged={slice.projectChanged}
          iconField={
            <ProjectIconField
              project={host.projectId}
              name={host.projectTitle ?? host.projectId}
            />
          }
        />
      </PaddedTab>
    );
  },
};
