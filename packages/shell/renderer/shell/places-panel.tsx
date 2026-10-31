// Home의 오른쪽 sidebar Places panel. 옛 launcher가 하던 일을 맡는다: project와 앱 목록, 보관한 것 되살리기, project 등록, 새 앱.
// project·앱 목록은 이 panel이 `ProjectsSource`·`AppsSource`에서 읽고 쓰며, 누른 줄은 callback으로 알린다.
import type { LucideIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { t } from "@lophn/i18n";
import { IconButton } from "@lophn/ui/primitives";
import { ErrorState, Skeleton } from "@lophn/ui/feedback";
import { Menu, MenuIcon, Tooltip } from "@lophn/ui/overlay";

import { AppPlaceMark } from "../app-frame/app-icon.tsx";
import { sortApps } from "../apps/model.ts";
import type { AppRow, AppsSource } from "../apps/source.ts";
import { CreateAppDialog } from "../desktop/places/create-app-dialog.tsx";
import { missingFolder, type Loaded } from "../desktop/places/model.ts";
import { ProjectDetailDialog } from "../desktop/places/projects/project-detail.tsx";
import type {
  ProjectItem,
  ProjectsSource,
} from "../desktop/places/projects/source.ts";
import { RegisterDialog } from "../desktop/places/register-dialog.tsx";
import { commonIcons, launcherIcons } from "../icons/mod.ts";
import { PlaceMark } from "../parts/place-mark/place-mark.tsx";
import { ProjectPlaceMark } from "../parts/project-icon/project-icon.tsx";
import {
  PanelEmpty,
  PanelRow,
  PanelRows,
  PanelSection,
} from "./panel-rows.tsx";
import { RightSidebar } from "./right-sidebar.tsx";

export interface PlacesPanelProps {
  /** project 목록·등록·보관·폴더 다시 잡기·detail 통로. 없으면 Projects 구역을 두지 않는다. */
  projects?: ProjectsSource;
  /** 앱 목록·새 앱·보관 통로. 없으면 Apps 구역을 두지 않는다. */
  apps?: AppsSource;
  /** project 줄을 눌렀다. */
  onProject: (project: string) => void;
  /** 앱 줄을 눌렀다. */
  onApp: (app: string) => void;
  /** New app으로 만든 앱. 그 앱 place의 lophn 새 session으로 시작한다. */
  onNewApp: (app: string) => void;
  /** 새 project id. 테스트가 고정한다. */
  newProjectId?: () => string;
  /** core가 다시 준비될 때마다 올라가는 수. 바뀌면 목록을 다시 읽는다. */
  reads?: number;
}

type RowMenu = readonly { id: string; label: string; icon: LucideIcon }[];

function RowMenuButton({
  name,
  items,
  onSelect,
}: {
  name: string;
  items: RowMenu;
  onSelect: (id: string) => void;
}) {
  return (
    <Menu
      trigger={
        <IconButton
          icon={launcherIcons.more}
          label={t("launcher.button.more", { name })}
          size="sm"
          data-card-menu=""
        />
      }
      items={items.map((item) => ({
        id: item.id,
        label: item.label,
        data: { "data-menu-item": item.id },
        leading: <MenuIcon icon={item.icon} />,
      }))}
      onSelect={onSelect}
    />
  );
}

// 읽는 중에는 뼈대, 실패하면 다시 읽기, 활성 항목이 없으면 안내를 보이고 그 밖에는 줄을 보인다.
function Body({
  state,
  items,
  target,
  empty,
  onRetry,
  children,
}: {
  state: Loaded<unknown>;
  items: readonly unknown[];
  target: string;
  empty: string;
  onRetry: () => void;
  children: ReactNode;
}) {
  if (state.state === "loading") return <Skeleton lines={2} />;
  if (state.state === "failed") {
    return <ErrorState target={target} onRetry={onRetry} />;
  }
  return items.length === 0 ? <PanelEmpty>{empty}</PanelEmpty> : children;
}

const ARCHIVE = () => ({
  id: "archive",
  label: t("launcher.button.archive"),
  icon: commonIcons.archive,
});

export function PlacesPanel({
  projects,
  apps,
  onProject,
  onApp,
  onNewApp,
  newProjectId,
  reads = 0,
}: PlacesPanelProps) {
  // 보관한 것까지 모두 읽고 화면에서 가른다.
  const [cards, setCards] = useState<Loaded<ProjectItem>>(
    projects ? { state: "loading" } : { state: "ready", items: [] },
  );
  const [rows, setRows] = useState<Loaded<AppRow>>(
    apps ? { state: "loading" } : { state: "ready", items: [] },
  );
  const [registering, setRegistering] = useState(false);
  const [creatingApp, setCreatingApp] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [archivedFolded, setArchivedFolded] = useState(true);

  const loadProjects = useCallback(async () => {
    if (!projects) return;
    const read = await projects.list();
    setCards(
      read.ok ? { state: "ready", items: read.value } : { state: "failed" },
    );
  }, [projects]);

  const loadApps = useCallback(async () => {
    if (!apps) return;
    const read = await apps.list();
    setRows(
      read.ok
        ? { state: "ready", items: sortApps(read.value) }
        : { state: "failed" },
    );
  }, [apps]);

  useEffect(() => {
    void loadProjects();
    void loadApps();
  }, [loadProjects, loadApps, reads]);

  const replaceProject = (project: ProjectItem) =>
    setCards((current) =>
      current.state === "ready"
        ? {
            state: "ready",
            items: current.items.map((item) =>
              item.id === project.id ? project : item,
            ),
          }
        : current,
    );

  // 쓰기가 실패하면(대개 다른 창이 먼저 고쳤다) 최신을 다시 읽는다.
  const setProjectArchived = async (
    project: ProjectItem,
    archived: boolean,
  ) => {
    if (!projects) return;
    const result = await projects.setArchived(project, archived);
    if (result.ok) replaceProject(result.value);
    else void loadProjects();
  };

  const setAppArchived = async (app: AppRow, archived: boolean) => {
    if (!apps) return;
    await apps.setArchived(app, archived);
    await loadApps();
  };

  const relocate = async (
    project: ProjectItem,
    folder: string,
  ): Promise<boolean> => {
    if (!projects) return false;
    const result = await projects.relocate(project, folder);
    if (!result.ok) return false;
    if (result.value !== null) replaceProject(result.value);
    return true;
  };

  const projectItems = cards.state === "ready" ? cards.items : [];
  const appItems = rows.state === "ready" ? rows.items : [];
  const activeProjects = projectItems.filter((item) => !item.archived);
  const activeApps = appItems.filter((item) => !item.archived);
  const archivedProjects = projectItems.filter((item) => item.archived);
  const archivedApps = appItems.filter((item) => item.archived);
  const archivedCount = archivedProjects.length + archivedApps.length;
  const detailed = projectItems.find((item) => item.id === detail);

  const register = t("launcher.button.register-project");
  const newApp = t("launcher.button.new-app");

  const projectRow = (card: ProjectItem) => {
    const missing = missingFolder(card);
    const first = card.folders[0];
    const menu: RowMenu = [
      {
        id: "details",
        label: t("launcher.button.details"),
        icon: launcherIcons.details,
      },
      ...(missing === undefined
        ? []
        : [
            {
              id: "relocate",
              label: t("launcher.button.choose-location"),
              icon: launcherIcons.chooseFolder,
            },
          ]),
      ARCHIVE(),
    ];
    return (
      <PanelRow
        key={card.id}
        data-project={card.id}
        leading={<ProjectPlaceMark id={card.id} name={card.title} />}
        title={card.title}
        meta={
          missing !== undefined
            ? t("launcher.label.folder-missing")
            : (first?.path ?? t("launcher.label.folder-count", { count: 0 }))
        }
        metaTone={missing === undefined ? undefined : "warning"}
        hoverTrailing
        trailing={
          <RowMenuButton
            name={card.title}
            items={menu}
            onSelect={(id) => {
              if (id === "details") setDetail(card.id);
              else if (id === "relocate" && missing !== undefined)
                void relocate(card, missing.path);
              else void setProjectArchived(card, true);
            }}
          />
        }
        onClick={() => onProject(card.id)}
      />
    );
  };

  const appRowOf = (row: AppRow) => (
    <PanelRow
      key={row.id}
      data-app={row.id}
      leading={<AppPlaceMark id={row.id} name={row.name} />}
      title={row.name}
      meta={
        row.release === null
          ? t("shell.label.app-no-release")
          : t("shell.label.app-release", { release: row.release })
      }
      hoverTrailing
      trailing={
        <RowMenuButton
          name={row.name}
          items={[ARCHIVE()]}
          onSelect={() => void setAppArchived(row, true)}
        />
      }
      onClick={() => onApp(row.id)}
    />
  );

  const unarchive = t("launcher.button.unarchive");
  const archivedRow = (
    kind: "project" | "app",
    id: string,
    name: string,
    restore: () => void,
  ) => (
    <PanelRow
      key={`${kind}:${id}`}
      data-archived={kind}
      data-archived-id={id}
      leading={<PlaceMark kind={kind} id={id} name={name} />}
      title={name}
      trailing={
        <Tooltip content={unarchive}>
          <IconButton
            icon={commonIcons.unarchive}
            label={unarchive}
            size="sm"
            data-action="unarchive"
            onClick={restore}
          />
        </Tooltip>
      }
    />
  );

  return (
    <RightSidebar title={t("shell.heading.places")} panel="places">
      {projects ? (
        <PanelSection
          data-section="projects"
          title={t("launcher.heading.projects")}
          count={activeProjects.length}
          actions={
            <Tooltip content={register}>
              <IconButton
                icon={launcherIcons.register}
                label={register}
                size="sm"
                data-register-project=""
                onClick={() => setRegistering(true)}
              />
            </Tooltip>
          }
        >
          <Body
            state={cards}
            items={activeProjects}
            target={t("launcher.label.projects")}
            empty={t("launcher.empty.no-projects")}
            onRetry={() => {
              setCards({ state: "loading" });
              void loadProjects();
            }}
          >
            <PanelRows label={t("launcher.heading.projects")}>
              {activeProjects.map(projectRow)}
            </PanelRows>
          </Body>
        </PanelSection>
      ) : null}
      {apps ? (
        <PanelSection
          data-section="apps"
          title={t("launcher.heading.apps")}
          count={activeApps.length}
          actions={
            <Tooltip content={newApp}>
              <IconButton
                icon={launcherIcons.register}
                label={newApp}
                size="sm"
                data-new-app=""
                onClick={() => setCreatingApp(true)}
              />
            </Tooltip>
          }
        >
          <Body
            state={rows}
            items={activeApps}
            target={t("launcher.label.apps")}
            empty={t("launcher.empty.no-apps")}
            onRetry={() => {
              setRows({ state: "loading" });
              void loadApps();
            }}
          >
            <PanelRows label={t("launcher.heading.apps")}>
              {activeApps.map(appRowOf)}
            </PanelRows>
          </Body>
        </PanelSection>
      ) : null}
      {archivedCount === 0 ? null : (
        <PanelSection
          data-section="archived"
          title={t("launcher.heading.archived")}
          count={archivedCount}
          folded={archivedFolded}
          onToggle={() => setArchivedFolded(!archivedFolded)}
        >
          <PanelRows label={t("launcher.heading.archived")}>
            {archivedProjects.map((item) =>
              archivedRow(
                "project",
                item.id,
                item.title,
                () => void setProjectArchived(item, false),
              ),
            )}
            {archivedApps.map((item) =>
              archivedRow(
                "app",
                item.id,
                item.name,
                () => void setAppArchived(item, false),
              ),
            )}
          </PanelRows>
        </PanelSection>
      )}
      {projects ? (
        <RegisterDialog
          open={registering}
          source={projects}
          newProjectId={newProjectId}
          onClose={() => setRegistering(false)}
          onRegistered={() => {
            setRegistering(false);
            void loadProjects();
          }}
        />
      ) : null}
      {projects && detailed ? (
        <ProjectDetailDialog
          source={projects}
          project={detailed}
          onChanged={replaceProject}
          onLatest={() => void loadProjects()}
          onRelocate={relocate}
          onClose={() => setDetail(null)}
        />
      ) : null}
      {apps ? (
        <CreateAppDialog
          open={creatingApp}
          source={apps}
          onClose={() => setCreatingApp(false)}
          onCreated={(created) => {
            setCreatingApp(false);
            onNewApp(created.id);
          }}
        />
      ) : null}
    </RightSidebar>
  );
}
