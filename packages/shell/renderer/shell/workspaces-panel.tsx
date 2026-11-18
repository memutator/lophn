// Home의 오른쪽 sidebar Workspaces panel. 옛 launcher가 하던 일을 맡는다: project와 앱 목록, 보관한 것 되살리기, project 등록, 새 앱.
// project·앱 목록은 core 읽기로 따라가고(다른 창·CLI가 바꿔도 다시 읽는다), 쓰기는 `ProjectsSource`·`AppsSource`로 한다. 누른 줄은 callback으로 알린다.
// 다른 기계의 범위에서는 project 등록·고치기·보관이 그 기계에서 되고(폴더는 그 기계의 목록에서 고른다) 앱은 목록뿐이다: 새 앱, 앱 보관·지우기는
// 기기가 부를 수 없다.
// 이 컴퓨터의 창은 다른 기계의 것도 보인다: 다른 기계에도 있는 project는 그 기계 이름을 아래 줄에 달고, 이 컴퓨터에 없는 project·앱은
// 기계 꼬리표를 단 줄로 구역 끝에 선다(누르면 그 기계의 workspace를 연다. 꺼진 기계의 줄은 흐리고 열리지 않는다).
import type { LucideIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { t } from "@lophn/i18n";
import { IconButton } from "@lophn/ui/primitives";
import { ErrorState, Skeleton } from "@lophn/ui/feedback";
import { Menu, MenuIcon, Tooltip } from "@lophn/ui/overlay";

import { AppWorkspaceMark } from "../app-frame/app-icon.tsx";
import { useAppList } from "../apps/app-list.ts";
import type { AppRow, AppsSource, PublishedPackage } from "../apps/source.ts";
import { CreateAppDialog } from "../desktop/workspaces/create-app-dialog.tsx";
import { missingFolder } from "../desktop/workspaces/model.ts";
import { ProjectDetailDialog } from "../desktop/workspaces/projects/project-detail.tsx";
import type {
  ProjectItem,
  ProjectsSource,
} from "../desktop/workspaces/projects/source.ts";
import type { MergedWorkspace } from "../desktop/workspaces/projects/merged.ts";
import { RegisterDialog } from "../desktop/workspaces/register-dialog.tsx";
import { useScopeMachineItem } from "../desktop/machines/context.tsx";
import { actionIcons, commonIcons, homeIcons } from "../icons/mod.ts";
import type { WorkspaceRef } from "./desk-model.ts";
import { WorkspaceMark } from "../parts/workspace-mark/workspace-mark.tsx";
import { ProjectWorkspaceMark } from "../parts/project-icon/project-icon.tsx";
import {
  PanelEmpty,
  PanelRow,
  PanelRows,
  PanelSection,
} from "./panel-rows.tsx";
import { DeleteAppDialog } from "./delete-app-dialog.tsx";
import { MachineTag } from "./left-sidebar.tsx";
import { RightSidebar } from "./right-sidebar.tsx";
import { useProjectList } from "./use-left-sidebar.ts";

export interface WorkspacesPanelProps {
  /** project 목록·등록·보관·폴더 다시 잡기·detail 통로. 없으면 Projects 구역을 두지 않는다. */
  projects?: ProjectsSource;
  /** 앱 목록·새 앱·보관 통로. 없으면 Apps 구역을 두지 않는다. */
  apps?: AppsSource;
  /** project 줄을 눌렀다. */
  onProject: (project: string) => void;
  /** 앱 줄을 눌렀다. */
  onApp: (app: string) => void;
  /** New app으로 만든 앱. 그 앱 workspace의 lophn 새 session으로 시작한다. */
  onNewApp: (app: string) => void;
  /** 다른 기계의 줄. 없으면(기계 하나) 이 컴퓨터의 것만 보인다. */
  elsewhere?: PanelElsewhere;
}

export interface PanelElsewhere {
  /** 기계를 건너 합친 줄(`mergeWorkspaces`). */
  readonly rows: readonly MergedWorkspace[];
  /** 기계 id → 명단의 이름. */
  readonly names: ReadonlyMap<string, string>;
  /** 이 컴퓨터에 없는 줄을 눌렀다. 그 기계의 workspace를 연다. */
  readonly onOpen: (workspace: WorkspaceRef) => void;
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
          icon={homeIcons.more}
          label={t("home.button.more", { name })}
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
  state: { readonly state: "loading" | "failed" | "ready" };
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
  label: t("home.button.archive"),
  icon: commonIcons.archive,
});

export function WorkspacesPanel({
  projects,
  apps,
  onProject,
  onApp,
  onNewApp,
  elsewhere,
}: WorkspacesPanelProps) {
  // 다른 기계에도 있는 이 컴퓨터의 project(id → 그 기계 이름들)와 이 컴퓨터에 없는 project·앱 줄.
  const nameOf = (machine: string | null) =>
    machine === null ? "" : (elsewhere?.names.get(machine) ?? "");
  const alsoOn = new Map(
    (elsewhere?.rows ?? []).flatMap((row) =>
      row.ref.kind === "project" && row.ref.machine === undefined
        ? [
            [
              row.ref.id,
              row.copies
                .filter((copy) => copy.machine !== null)
                .map((copy) => nameOf(copy.machine)),
            ] as const,
          ]
        : [],
    ),
  );
  const away = (kind: "project" | "app") =>
    (elsewhere?.rows ?? []).filter(
      (row) => row.ref.kind === kind && row.ref.machine !== undefined,
    );
  const awayRow = (row: MergedWorkspace) => {
    const { ref } = row;
    if (ref.kind === "home" || ref.machine === undefined) return null;
    return (
      <PanelRow
        key={`${ref.kind}:${ref.id}`}
        data-away={ref.kind}
        data-away-id={ref.id}
        data-offline={row.offline ? "" : undefined}
        leading={<WorkspaceMark kind={ref.kind} id={ref.id} name={row.name} />}
        title={row.name}
        trailing={<MachineTag name={nameOf(ref.machine)} />}
        meta={t(
          row.offline
            ? "machines.panel.off"
            : ref.kind === "project"
              ? "machines.group.not-here"
              : "machines.panel.app-there",
          { name: nameOf(ref.machine) },
        )}
        onClick={row.offline ? undefined : () => elsewhere?.onOpen(ref)}
      />
    );
  };
  // 보관한 것까지 모두 읽고 화면에서 가른다.
  const cards = useProjectList();
  const rows = useAppList();
  const appWrites = useScopeMachineItem() === null;
  const [registering, setRegistering] = useState(false);
  const [creatingApp, setCreatingApp] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [archivedFolded, setArchivedFolded] = useState(true);
  // 지우기 확인 dialog가 가리키는 보관한 앱과 지우는 중, 지우지 못한 이유.
  const [deleting, setDeleting] = useState<{
    row: AppRow;
    busy: boolean;
    failure?: string;
  } | null>(null);
  // 지우려는 앱이 주인인 공개 package. 지워도 남는 것을 dialog가 미리 보인다. 못 읽으면 비운다.
  const [published, setPublished] = useState<{
    app: string;
    packages: readonly PublishedPackage[];
  } | null>(null);
  const askDelete = (row: AppRow) => {
    setDeleting({ row, busy: false });
    setPublished(null);
    void apps?.publishedPackages(row).then((read) => {
      if (read.ok) setPublished({ app: row.id, packages: read.value });
    });
  };

  // 쓴 결과는 core의 변경 알림으로 목록에 돌아온다. 실패는 대개 다른 창이 먼저 고친 것이라 그 알림이 이미 최신을 읽었다.
  const setProjectArchived = (project: ProjectItem, archived: boolean) =>
    void projects?.setArchived(project, archived);

  const setAppArchived = (app: AppRow, archived: boolean) =>
    void apps?.setArchived(app, archived);

  const deleteApp = async () => {
    if (!apps || deleting === null) return;
    const { row } = deleting;
    setDeleting({ row, busy: true });
    const result = await apps.deleteApp(row);
    if (result.ok) {
      setDeleting(null);
      return;
    }
    // 앱 process가 아직 멈추는 중이면 잠시 뒤 다시 하면 된다.
    setDeleting({
      row,
      busy: false,
      failure: t(
        result.code === "unavailable"
          ? "home.error.app-delete-stopping"
          : "home.error.app-delete-failed",
        { name: row.name },
      ),
    });
  };

  const relocate = async (
    project: ProjectItem,
    folder: string,
  ): Promise<boolean> => {
    if (!projects) return false;
    const result = await projects.relocate(project, folder);
    return result.ok;
  };

  const projectItems = cards.loaded.state === "ready" ? cards.loaded.value : [];
  const appItems = rows.loaded.state === "ready" ? rows.loaded.value : [];
  const activeProjects = projectItems.filter((item) => !item.archived);
  const activeApps = appItems.filter((item) => !item.archived);
  const archivedProjects = projectItems.filter((item) => item.archived);
  const archivedApps = appItems.filter((item) => item.archived);
  const archivedCount = archivedProjects.length + archivedApps.length;
  const detailed = projectItems.find((item) => item.id === detail);

  const register = t("home.button.register-project");
  const newApp = t("home.button.new-app");

  const projectRow = (card: ProjectItem) => {
    const missing = missingFolder(card);
    const first = card.folders[0];
    const menu: RowMenu = [
      {
        id: "details",
        label: t("home.button.details"),
        icon: homeIcons.details,
      },
      ...(missing === undefined
        ? []
        : [
            {
              id: "relocate",
              label: t("home.button.choose-location"),
              icon: homeIcons.chooseFolder,
            },
          ]),
      ARCHIVE(),
    ];
    return (
      <PanelRow
        key={card.id}
        data-project={card.id}
        leading={<ProjectWorkspaceMark id={card.id} name={card.title} />}
        title={card.title}
        meta={
          missing !== undefined
            ? t("home.label.folder-missing")
            : (alsoOn.get(card.id)?.length ?? 0) > 0
              ? t("machines.panel.also-on", {
                  path: first?.path ?? "",
                  names: alsoOn.get(card.id)!.join(", "),
                })
              : (first?.path ?? t("home.label.folder-count", { count: 0 }))
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
              else setProjectArchived(card, true);
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
      leading={<AppWorkspaceMark id={row.id} name={row.name} />}
      title={row.name}
      meta={
        row.release === null
          ? t("shell.label.app-no-release")
          : row.releaseNumber === null
            ? t("shell.label.app-released")
            : t("shell.label.app-release", { number: row.releaseNumber })
      }
      hoverTrailing
      trailing={
        appWrites ? (
          <RowMenuButton
            name={row.name}
            items={[ARCHIVE()]}
            onSelect={() => setAppArchived(row, true)}
          />
        ) : undefined
      }
      onClick={() => onApp(row.id)}
    />
  );

  const unarchive = t("home.button.unarchive");
  const deleteLabel = t("home.button.delete");
  const archivedRow = (
    kind: "project" | "app",
    id: string,
    name: string,
    restore?: () => void,
    remove?: () => void,
  ) => (
    <PanelRow
      key={`${kind}:${id}`}
      data-archived={kind}
      data-archived-id={id}
      leading={<WorkspaceMark kind={kind} id={id} name={name} />}
      title={name}
      trailing={
        <>
          {remove === undefined ? null : (
            <Tooltip content={deleteLabel}>
              <IconButton
                icon={actionIcons.delete}
                label={deleteLabel}
                size="sm"
                data-action="delete"
                onClick={remove}
              />
            </Tooltip>
          )}
          {restore === undefined ? null : (
            <Tooltip content={unarchive}>
              <IconButton
                icon={commonIcons.unarchive}
                label={unarchive}
                size="sm"
                data-action="unarchive"
                onClick={restore}
              />
            </Tooltip>
          )}
        </>
      }
    />
  );

  return (
    <RightSidebar title={t("shell.heading.workspaces")} panel="workspaces">
      {projects ? (
        <PanelSection
          data-section="projects"
          title={t("home.heading.projects")}
          count={activeProjects.length + away("project").length}
          actions={
            <Tooltip content={register}>
              <IconButton
                icon={homeIcons.register}
                label={register}
                size="sm"
                data-register-project=""
                onClick={() => setRegistering(true)}
              />
            </Tooltip>
          }
        >
          <Body
            state={cards.loaded}
            items={[...activeProjects, ...away("project")]}
            target={t("home.label.projects")}
            empty={t("home.empty.no-projects")}
            onRetry={cards.reload}
          >
            <PanelRows label={t("home.heading.projects")}>
              {activeProjects.map(projectRow)}
              {away("project").map(awayRow)}
            </PanelRows>
          </Body>
        </PanelSection>
      ) : null}
      {apps ? (
        <PanelSection
          data-section="apps"
          title={t("home.heading.apps")}
          count={activeApps.length + away("app").length}
          actions={
            appWrites ? (
              <Tooltip content={newApp}>
                <IconButton
                  icon={homeIcons.register}
                  label={newApp}
                  size="sm"
                  data-new-app=""
                  onClick={() => setCreatingApp(true)}
                />
              </Tooltip>
            ) : undefined
          }
        >
          <Body
            state={rows.loaded}
            items={[...activeApps, ...away("app")]}
            target={t("home.label.apps")}
            empty={t("home.empty.no-apps")}
            onRetry={rows.reload}
          >
            <PanelRows label={t("home.heading.apps")}>
              {activeApps.map(appRowOf)}
              {away("app").map(awayRow)}
            </PanelRows>
          </Body>
        </PanelSection>
      ) : null}
      {archivedCount === 0 ? null : (
        <PanelSection
          data-section="archived"
          title={t("home.heading.archived")}
          count={archivedCount}
          folded={archivedFolded}
          onToggle={() => setArchivedFolded(!archivedFolded)}
        >
          <PanelRows label={t("home.heading.archived")}>
            {archivedProjects.map((item) =>
              archivedRow("project", item.id, item.title, () =>
                setProjectArchived(item, false),
              ),
            )}
            {archivedApps.map((item) =>
              appWrites
                ? archivedRow(
                    "app",
                    item.id,
                    item.name,
                    () => setAppArchived(item, false),
                    () => askDelete(item),
                  )
                : archivedRow("app", item.id, item.name),
            )}
          </PanelRows>
        </PanelSection>
      )}
      {projects ? (
        <RegisterDialog
          open={registering}
          source={projects}
          onClose={() => setRegistering(false)}
          onRegistered={() => setRegistering(false)}
        />
      ) : null}
      {projects && detailed ? (
        <ProjectDetailDialog
          source={projects}
          project={detailed}
          onChanged={() => {}}
          onLatest={cards.reload}
          onRelocate={relocate}
          onClose={() => setDetail(null)}
        />
      ) : null}
      {apps && deleting !== null ? (
        <DeleteAppDialog
          name={deleting.row.name}
          packages={
            published?.app === deleting.row.id ? published.packages : []
          }
          busy={deleting.busy}
          failure={deleting.failure}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void deleteApp()}
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
