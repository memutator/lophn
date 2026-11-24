// project settings 탭 본문. General(이름·목적·다른 컴퓨터·폴더, Workspaces panel 상세 dialog와 같은 form, 그 아래 보관), Quick launch(왼쪽 sidebar 아래 단추의 순서),
// App panels(단추로 고정할 앱 panel) 세 구역이다. 빠른 실행은 전역 값(Settings › Quick launch)을 따르거나 이 project만의 값을 둔다.

import { t } from "@lophn/i18n";
import { ErrorState, Skeleton, useDelayedLoading } from "@lophn/ui/feedback";
import { Switch } from "@lophn/ui/input";
import { Button } from "@lophn/ui/primitives";
import { type ReactNode, useState } from "react";

import { projectApi } from "../../../../protocol/projects/project-api.ts";
import { useCoreRead } from "../../desktop/connection/core-read.ts";
import { useQuickPrefs } from "../../desktop/settings/quick-launch/store.tsx";
import { projectItemOf } from "../../desktop/workspaces/projects/core-source.ts";
import { IdentityRow } from "../../desktop/workspaces/projects/identity-row.tsx";
import { ProjectForm } from "../../desktop/workspaces/projects/project-form.tsx";
import type { ProjectsSource } from "../../desktop/workspaces/projects/source.ts";
import { commonIcons } from "../../icons/mod.ts";
import type { WorkspaceQuick } from "../../shell/desk-model.ts";
import { ProjectCommandsSettings } from "../project-commands/commands-settings.tsx";
import type { SidebarAgent } from "../sidebar/sidebar-agent.ts";
import styles from "./project-settings-page.module.css";
import {
  AppPanelList,
  QuickOrderList,
  useAppPanelApps,
} from "./quick-launch-editor.tsx";

export interface ProjectSettingsPageProps {
  readonly projectId: string;
  /** 이 project만의 빠른 실행. 없으면 전역 값을 따른다. */
  readonly quick: WorkspaceQuick | undefined;
  /** undefined면 이 project의 값을 지우고 전역 값으로 돌아간다. */
  readonly onQuick: (next: WorkspaceQuick | undefined) => void;
  /** 이 project의 agent 목록(Commands 설정의 agent 선택에 쓴다). */
  readonly agents?: readonly SidebarAgent[];
  /** 없으면 General은 안내 글만 둔다. */
  readonly projects: ProjectsSource | undefined;
  /** 이름·폴더를 저장했다. */
  readonly onProjectChanged: () => void;
  /** project를 보관했다. 들어와 있는 project workspace를 떠난다. */
  readonly onArchived: () => void;
  /** General 맨 위의 project 아이콘 필드 자리. */
  readonly iconField?: ReactNode;
}

function GeneralSection({
  projectId,
  projects,
  onProjectChanged,
  onArchived,
  iconField,
}: {
  projectId: string;
  projects: ProjectsSource;
  onProjectChanged: () => void;
  onArchived: () => void;
  iconField?: ReactNode;
}) {
  // 저장한 값은 core의 변경 알림으로 다시 읽는다. 다른 창이나 CLI가 고친 것도 같은 길로 온다.
  const { loaded, reload } = useCoreRead(projectApi.get, {
    project: projectId,
  });
  const [saved, setSaved] = useState(false);
  const [archiveFailed, setArchiveFailed] = useState(false);
  const showLoading = useDelayedLoading(loaded.state === "loading");

  if (loaded.state === "loading") {
    return showLoading ? <Skeleton lines={4} /> : null;
  }
  if (loaded.state === "failed") {
    return (
      <ErrorState
        target={t("project-settings.label.project-target")}
        onRetry={reload}
      />
    );
  }
  const project = projectItemOf(loaded.value.project);
  // 보관은 Home의 Workspaces panel에서 되살리므로 확인 없이 한다.
  const archive = async () => {
    const reply = await projects.setArchived(project, true);
    setArchiveFailed(!reply.ok);
    if (reply.ok) onArchived();
  };
  return (
    <>
      <ProjectForm
        // 저장하거나 다른 창이 고치면 revision이 바뀌어 초안이 새 값에서 다시 시작한다.
        key={`${project.id}:${project.revision}`}
        source={projects}
        project={project}
        saved={saved}
        iconField={iconField}
        identityRow={<IdentityRow source={projects} project={project} />}
        onChanged={() => {
          setSaved(true);
          onProjectChanged();
        }}
        onLatest={reload}
        onRelocate={async (target, folder) =>
          (await projects.relocate(target, folder)).ok
        }
      />
      <div className={styles.row} data-project-archive="">
        <span className={styles.rowText}>
          <span>{t("project-settings.heading.archive")}</span>
          <span className={styles.note}>
            {t(
              archiveFailed
                ? "project-settings.error.archive-failed"
                : "project-settings.notice.archive",
            )}
          </span>
        </span>
        <Button
          size="sm"
          icon={commonIcons.archive}
          onClick={() => void archive()}
        >
          {t("project-settings.button.archive")}
        </Button>
      </div>
    </>
  );
}

export function ProjectSettingsPage(props: ProjectSettingsPageProps) {
  const { projects, quick, onQuick } = props;
  const { apps, loading, failed } = useAppPanelApps();
  const global = useQuickPrefs().prefs.quick;
  // 전역 값을 따르는 동안은 고칠 수 없고 보이기만 한다. 끄면 지금 전역 값에서 시작한다.
  const own = quick !== undefined;
  const shown = quick ?? global;
  const change = own ? onQuick : undefined;

  return (
    <div className={styles.page} data-project-settings="">
      <section className={styles.section} data-section="general">
        <h2 className={styles.sectionTitle}>
          {t("project-settings.heading.general")}
        </h2>
        {projects === undefined ? (
          <p className={styles.note}>
            {t("project-settings.notice.general-unavailable")}
          </p>
        ) : (
          <GeneralSection
            projectId={props.projectId}
            projects={projects}
            onProjectChanged={props.onProjectChanged}
            onArchived={props.onArchived}
            iconField={props.iconField}
          />
        )}
      </section>
      <section className={styles.section} data-section="quick-launch">
        <h2 className={styles.sectionTitle}>
          {t("project-settings.heading.quick-launch")}
        </h2>
        <Switch
          label={t("project-settings.label.use-global-quick")}
          checked={!own}
          onCheckedChange={(checked) =>
            onQuick(checked ? undefined : { ...global })
          }
        />
        <p className={styles.note}>
          {t(
            own
              ? "project-settings.notice.quick-own"
              : "project-settings.notice.quick-global",
          )}
        </p>
        {change === undefined ? null : (
          <QuickOrderList quick={shown} onQuick={change} apps={apps} />
        )}
      </section>
      <section className={styles.section} data-section="commands">
        <h2 className={styles.sectionTitle}>
          {t("project-settings.heading.commands")}
        </h2>
        <p className={styles.note}>
          {t("project-settings.notice.commands-lead")}
        </p>
        <ProjectCommandsSettings
          projectId={props.projectId}
          agents={props.agents}
        />
      </section>
      {change === undefined ? null : (
        <section className={styles.section} data-section="app-panels">
          <h2 className={styles.sectionTitle}>
            {t("project-settings.heading.app-panels")}
          </h2>
          <p className={styles.note}>
            {t("project-settings.notice.app-panels-lead")}
          </p>
          <AppPanelList
            apps={apps}
            loading={loading}
            failed={failed}
            quick={shown}
            onQuick={change}
          />
        </section>
      )}
    </div>
  );
}
