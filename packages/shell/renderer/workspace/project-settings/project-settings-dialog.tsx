// project settings dialog. General(이름·목적·폴더, 런처 상세 dialog와 같은 form), Quick launch(왼쪽 sidebar 아래 단추의 순서),
// App panels(단추로 고정할 앱 panel) 세 구역이다. 열려 있는 동안만 그린다.
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { t } from "@lophn/i18n";
import { ErrorState, Skeleton } from "@lophn/ui/feedback";
import { Dialog } from "@lophn/ui/overlay";
import { Button, Icon, IconButton } from "@lophn/ui/primitives";

import { AppTabIcon } from "../../app-frame/app-icon.tsx";
import type { AppScreens } from "../../app-frame/app-views.tsx";
import {
  actionIcons,
  browserIcons,
  shellIcons,
  workspaceIcons,
} from "../../icons/mod.ts";
import type { PlaceQuick } from "../../shell/desk-model.ts";
import { panelChoices, useScreensRead } from "../app-panel-tab.tsx";
import {
  isPinned,
  moveQuick,
  pinId,
  quickOrder,
  setPinned,
} from "./quick-launch.ts";

import { ProjectForm } from "../../desktop/places/projects/project-form.tsx";
import type {
  ProjectItem,
  ProjectsSource,
} from "../../desktop/places/projects/source.ts";
import styles from "./project-settings-dialog.module.css";

export interface ProjectSettingsDialogProps {
  readonly projectId: string;
  readonly title: string;
  readonly onClose: () => void;
  readonly quick: PlaceQuick | undefined;
  readonly onQuick: (next: PlaceQuick) => void;
  /** 없으면 General은 안내 글만 둔다. */
  readonly projects: ProjectsSource | undefined;
  /** 이름·폴더를 저장했다. */
  readonly onProjectChanged: () => void;
  /** General 맨 위의 project 아이콘 필드 자리. */
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

const BUILTIN_LABEL = {
  terminal: "left-sidebar.button.quick-terminal",
  browser: "left-sidebar.button.quick-browser",
  app: "left-sidebar.button.quick-app",
  search: "left-sidebar.button.quick-search",
} as const;

const BUILTIN_ICON = {
  terminal: workspaceIcons.terminal,
  browser: browserIcons.globe,
  app: workspaceIcons.appPanel,
  search: shellIcons.search,
} as const;

function QuickLaunchSection({
  quick,
  onQuick,
  labelOf,
}: {
  quick: PlaceQuick | undefined;
  onQuick: (next: PlaceQuick) => void;
  labelOf: (app: string, surface: string) => string;
}) {
  const order = quickOrder(quick);
  return (
    <ul className={styles.rows} data-quick-rows="">
      {order.map((id, index) => {
        const builtin =
          id in BUILTIN_LABEL ? (id as keyof typeof BUILTIN_LABEL) : null;
        const pin = quick?.apps.find((item) => pinId(item) === id);
        const label =
          builtin !== null
            ? t(BUILTIN_LABEL[builtin])
            : labelOf(pin?.app ?? "", pin?.surface ?? "");
        return (
          <li key={id} className={styles.row} data-quick-row={id}>
            <span className={styles.rowName}>
              {builtin === null ? (
                <AppTabIcon app={pin?.app} />
              ) : (
                <Icon icon={BUILTIN_ICON[builtin]} pixels={16} />
              )}
              <span className={styles.rowLabel}>{label}</span>
            </span>
            <IconButton
              icon={actionIcons.moveUp}
              label={t("project-settings.button.move-up")}
              size="sm"
              disabled={index === 0}
              onClick={() => onQuick(moveQuick(quick, id, -1))}
            />
            <IconButton
              icon={actionIcons.moveDown}
              label={t("project-settings.button.move-down")}
              size="sm"
              disabled={index === order.length - 1}
              onClick={() => onQuick(moveQuick(quick, id, 1))}
            />
            {pin === undefined ? null : (
              // 없어진 앱의 고정도 여기서 풀 수 있다.
              <IconButton
                icon={actionIcons.remove}
                label={t("project-settings.button.unpin")}
                size="sm"
                onClick={() => onQuick(setPinned(quick, pin, false))}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function AppPanelsSection({
  apps,
  failed,
  loading,
  quick,
  onQuick,
}: {
  apps: readonly AppScreens[];
  failed: boolean;
  loading: boolean;
  quick: PlaceQuick | undefined;
  onQuick: (next: PlaceQuick) => void;
}) {
  const choices = panelChoices(apps);
  if (loading) return <Skeleton lines={3} />;
  if (failed) {
    return (
      <p className={styles.note}>{t("project-settings.notice.apps-failed")}</p>
    );
  }
  if (choices.length === 0) {
    return (
      <p className={styles.note}>
        {t("project-settings.notice.no-app-panels")}
      </p>
    );
  }
  return (
    <ul className={styles.rows} data-app-panel-rows="">
      {choices.map((choice) => {
        const pin = { app: choice.app, surface: choice.screen };
        const on = isPinned(quick, pin);
        return (
          <li
            key={`${choice.app}:${choice.screen}`}
            className={styles.row}
            data-app-panel-row={choice.app}
          >
            <span className={styles.rowName}>
              <AppTabIcon app={choice.app} />
              <span className={styles.rowLabel}>{choice.label}</span>
            </span>
            <Button
              size="sm"
              onClick={() => onQuick(setPinned(quick, pin, !on))}
            >
              {on
                ? t("project-settings.button.unpin")
                : t("project-settings.button.pin")}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

export function ProjectSettingsDialog(props: ProjectSettingsDialogProps) {
  const { projects, quick, onQuick } = props;
  const { read } = useScreensRead();
  // 다시 읽는 동안에도 목록이 비지 않게 마지막으로 읽은 값을 쓴다.
  const known = useRef<readonly AppScreens[]>([]);
  if (read?.ok) known.current = read.value;
  const apps = known.current;
  const labelOf = (app: string, surface: string) =>
    panelChoices(apps).find(
      (choice) => choice.app === app && choice.screen === surface,
    )?.label ?? t("project-workspace.label.kind-app-panel");

  return (
    <Dialog
      open
      width="wide"
      title={props.title}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
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
              iconField={props.iconField}
            />
          )}
        </section>
        <section className={styles.section} data-section="quick-launch">
          <h2 className={styles.sectionTitle}>
            {t("project-settings.heading.quick-launch")}
          </h2>
          <QuickLaunchSection
            quick={quick}
            onQuick={onQuick}
            labelOf={labelOf}
          />
        </section>
        <section className={styles.section} data-section="app-panels">
          <h2 className={styles.sectionTitle}>
            {t("project-settings.heading.app-panels")}
          </h2>
          <p className={styles.note}>
            {t("project-settings.notice.app-panels-lead")}
          </p>
          <AppPanelsSection
            apps={apps}
            loading={read === null && apps.length === 0}
            failed={read !== null && !read.ok && apps.length === 0}
            quick={quick}
            onQuick={onQuick}
          />
        </section>
      </div>
    </Dialog>
  );
}
