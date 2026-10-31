// project settings 탭 본문. General(이름·목적·폴더, 런처 상세 dialog와 같은 form)과 App panels(activity bar에 고정한 앱 패널) 두 구역이다.
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { t } from "@lophn/i18n";
import { ErrorState, Skeleton } from "@lophn/ui/feedback";

import { ProjectForm } from "../../desktop/places/projects/project-form.tsx";
import type {
  ProjectItem,
  ProjectsSource,
} from "../../desktop/places/projects/source.ts";
import styles from "./project-settings-page.module.css";

export interface ProjectSettingsPageProps {
  readonly projectId: string;
  /** 없으면 General은 안내 글만 둔다. */
  readonly projects: ProjectsSource | undefined;
  /** 이름·폴더를 저장했다. */
  readonly onProjectChanged: () => void;
  /** General 맨 위의 project 아이콘 필드 자리. 아이콘 필드는 다른 작업이 채운다. */
  readonly iconField?: ReactNode;
}

type Loaded =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly project: ProjectItem };

function GeneralSection({
  projectId,
  projects,
  onProjectChanged,
  iconField,
}: {
  projectId: string;
  projects: ProjectsSource;
  onProjectChanged: () => void;
  iconField?: ReactNode;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const read = await projects.list();
    const found = read.ok
      ? read.value.find((item) => item.id === projectId)
      : undefined;
    setLoaded(
      found === undefined
        ? { kind: "failed" }
        : { kind: "ready", project: found },
    );
  }, [projects, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const replace = (project: ProjectItem) => {
    setLoaded({ kind: "ready", project });
    onProjectChanged();
  };

  let body: ReactNode;
  if (loaded.kind === "loading") body = <Skeleton lines={4} />;
  else if (loaded.kind === "failed") {
    body = (
      <ErrorState
        target={t("project-settings.label.project-target")}
        onRetry={() => {
          setLoaded({ kind: "loading" });
          void load();
        }}
      />
    );
  } else {
    body = (
      <ProjectForm
        // 저장하거나 다른 창이 고치면 revision이 바뀌어 초안이 새 값에서 다시 시작한다.
        key={`${loaded.project.id}:${loaded.project.revision}`}
        source={projects}
        project={loaded.project}
        saved={saved}
        iconField={iconField}
        onChanged={(next) => {
          setSaved(true);
          replace(next);
        }}
        onLatest={() => void load()}
        onRelocate={async (project, folder) => {
          const result = await projects.relocate(project, folder);
          if (!result.ok) return false;
          if (result.value !== null) replace(result.value);
          return true;
        }}
      />
    );
  }
  return body;
}

export function ProjectSettingsPage(props: ProjectSettingsPageProps) {
  const { projects } = props;
  return (
    <div className={styles.page} data-project-settings="">
      <section className={styles.section} data-section="general">
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>
            {t("project-settings.heading.general")}
          </h2>
        </div>
        {projects === undefined ? (
          <p className={styles.note}>
            {t("project-settings.notice.general-unavailable")}
          </p>
        ) : (
          <GeneralSection
            projectId={props.projectId}
            projects={projects}
            onProjectChanged={props.onProjectChanged}
            iconField={props.iconField}
          />
        )}
      </section>
    </div>
  );
}
