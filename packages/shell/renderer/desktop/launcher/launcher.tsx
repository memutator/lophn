import { type ReactNode, useCallback, useEffect, useState } from "react";
import { t } from "@lophn/wording";
import { Button, IconButton } from "@lophn/ui/primitives";
import { EmptyState, ErrorState, Skeleton } from "@lophn/ui/feedback";
import { Tooltip } from "@lophn/ui/overlay";
import { conversationIcons, launcherIcons } from "../../icons/mod.ts";

import type { CoreSource } from "../connection/connection.ts";
import {
  ConnectionGate,
  ConnectionNotice,
  retryConnection,
  useConnection,
} from "../connection/connection.tsx";
import { useSessions } from "../connection/events/hooks.tsx";
import { LOPHN_AGENT_ID } from "../../../../protocol/lophn-agent/places.ts";
import { WaitingLayer } from "../connection/waiting/waiting-layer.tsx";
import type { AgentTabSourceFactory } from "../../conversation/agent-tab-source.ts";
import { sortApps } from "../../apps/model.ts";
import type { AppRow, AppsSource } from "../../apps/source.ts";
import { SettingsEntry, TopBar, Wordmark } from "../top-bar/top-bar.tsx";
import type { WindowPlatform } from "../top-bar/platform.ts";
import type { SettingsPane } from "../settings/model.ts";
import { failureOf } from "./start-failure/model.ts";
import { StartFailureScreen } from "./start-failure/start-failure.tsx";
import { AppsSection } from "./apps-section.tsx";
import { ArchivedSection } from "./archived-section.tsx";
import { LophnPanel } from "./lophn-panel/lophn-panel.tsx";
import type { Loaded } from "./model.ts";
import { ProjectCard } from "./project-card.tsx";
import { ProjectDetailDialog } from "./projects/project-detail.tsx";
import type { ProjectItem, ProjectsSource } from "./projects/source.ts";
import { CreateAppDialog } from "./create-app-dialog.tsx";
import { RegisterDialog } from "./register-dialog.tsx";
import styles from "./launcher.module.css";

interface LauncherProps {
  source: CoreSource;
  /** 확인 시각의 표시. 테스트가 고정한다. */
  formatTime?: (confirmedAt: number) => string;
  /** Settings로 이동한다. 항목을 주면 그 항목부터 연다. */
  onSettings: (pane?: SettingsPane) => void;
  /** 상단 바가 비울 OS 창 조작 자리. 기본은 지금 renderer의 OS다. */
  platform?: WindowPlatform;
  /** 프로젝트 카드·등록·보관·폴더 다시 잡기·detail 통로. 없으면 프로젝트는 없는 것으로 본다. */
  projects?: ProjectsSource;
  /** 프로젝트 작업대로 이동한다. */
  onProject?: (project: string) => void;
  /** 앱 카드와 보관 통로. 없으면 앱 section을 두지 않는다. */
  apps?: AppsSource;
  /** 그 앱의 앱 공간으로 이동한다. */
  onApp?: (app: string) => void;
  /** New app으로 만든 앱의 앱 공간으로 이동한다. App Engineer와 새 session으로 시작한다. */
  onNewApp?: (app: string) => void;
  /** 새 프로젝트 id. 테스트가 고정한다. */
  newProjectId?: () => string;
  /** 대기 목록 질문 카드의 [Open session]. 호스트가 그 session으로 보낸다. */
  onOpenSession?: (session: string) => void;
  /** lophn 대화 통로. 없으면 lophn 단추를 두지 않는다. */
  agentViewSource?: AgentTabSourceFactory;
  /** 호스트가 lophn 패널을 그 session으로 열라고 한다. 요청마다 새 객체여야 같은 session도 다시 연다. */
  lophnRequest?: { readonly session: string };
}

const noop = () => {};

// 48px 바 아래 1040px 가운데 기둥에 프로젝트 section, 그 아래 앱 section, 맨 아래 접힌 Archived 묶음. 준비 전·실패는
// 기둥 대신 연결 화면을 보이고, 단절은 마지막 화면 위에 한 줄을 더한다. 카드는 실제 read 결과로만 채운다.
export function Launcher({
  source,
  formatTime,
  onSettings,
  platform,
  projects,
  onProject,
  apps,
  onApp,
  onNewApp,
  newProjectId,
  onOpenSession = noop,
  agentViewSource,
  lophnRequest,
}: LauncherProps) {
  const connection = useConnection(source);
  const retry = () => retryConnection(source);
  const failure = failureOf(connection);
  const gated =
    connection.state === "starting" ||
    connection.state === "failed" ||
    failure !== null;

  // lophn 패널. 오른쪽 아래 단추가 열고 열린 동안 단추는 숨는다. session은 undefined(아직 안 고름)일 때만 가장 최근 열린
  // session으로 고르고, 닫았다 열어도 그대로다.
  const { sessions } = useSessions();
  const [lophnOpen, setLophnOpen] = useState(false);
  const [lophnSession, setLophnSession] = useState<string | null | undefined>(
    undefined,
  );
  useEffect(() => {
    if (lophnRequest === undefined) return;
    setLophnSession(lophnRequest.session);
    setLophnOpen(true);
  }, [lophnRequest]);
  const openLophn = () => {
    if (lophnSession === undefined) {
      setLophnSession(
        sessions
          .filter(
            (item) =>
              item.ended === null &&
              item.agent === LOPHN_AGENT_ID &&
              item.place === null,
          )
          .at(-1)?.session ?? null,
      );
    }
    setLophnOpen(true);
  };

  return (
    <div
      className={styles.window}
      data-space="launcher"
      data-gated={gated ? "" : undefined}
    >
      <TopBar
        platform={platform}
        leading={<Wordmark>{t("launcher.label.wordmark")}</Wordmark>}
        trailing={
          gated ? undefined : (
            <span className={styles.topActions}>
              <WaitingLayer onOpenSession={onOpenSession} />
              <SettingsEntry onSettings={onSettings} />
            </span>
          )
        }
      />
      <main className={styles.scroll}>
        {failure !== null ? (
          <StartFailureScreen failure={failure} onRetry={retry} />
        ) : gated ? (
          <ConnectionGate connection={connection} onRetry={retry} />
        ) : (
          <div className={styles.page} data-column="launcher">
            <ConnectionNotice
              connection={connection}
              onRetry={retry}
              formatTime={formatTime}
            />
            <LauncherBody
              ready={connection.state === "ready"}
              projects={projects}
              apps={apps}
              onProject={onProject ?? noop}
              onApp={onApp ?? noop}
              onNewApp={onNewApp ?? noop}
              newProjectId={newProjectId}
            />
          </div>
        )}
      </main>
      {!gated && agentViewSource !== undefined && !lophnOpen ? (
        <div className={styles.lophnEntry}>
          <Button
            size="lg"
            icon={conversationIcons.dock}
            data-entry="lophn"
            onClick={openLophn}
          >
            {t("launcher.button.lophn")}
          </Button>
        </div>
      ) : null}
      {!gated && agentViewSource !== undefined && lophnOpen ? (
        <LophnPanel
          factory={agentViewSource}
          session={lophnSession ?? null}
          onSession={setLophnSession}
          onClose={() => setLophnOpen(false)}
          onSettings={onSettings}
        />
      ) : null}
    </div>
  );
}

interface BodyProps {
  ready: boolean;
  projects?: ProjectsSource;
  apps?: AppsSource;
  onProject: (project: string) => void;
  onApp: (app: string) => void;
  onNewApp: (app: string) => void;
  newProjectId?: () => string;
}

// 프로젝트 카드 묶음과 앱 카드 묶음, 그 아래 접힌 Archived 묶음. project와 앱을 다루는 유일한 화면이라
// 보관·복원·폴더 다시 잡기·detail이 여기 있다. 아무것도 없으면 비었음 상태 하나만 보인다.
function LauncherBody({
  ready,
  projects,
  apps,
  onProject,
  onApp,
  onNewApp,
  newProjectId,
}: BodyProps) {
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

  // 처음 열 때와 core가 다시 준비될 때 읽는다.
  useEffect(() => {
    void loadProjects();
    void loadApps();
  }, [loadProjects, loadApps, ready]);

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
  const detailed = projectItems.find((item) => item.id === detail);

  const registerDialog = projects ? (
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
  ) : null;

  const register = t("launcher.button.register-project");

  let projectBody: ReactNode;
  if (cards.state === "loading") {
    projectBody = (
      <ul className={styles.grid} data-cards="loading" aria-busy="true">
        {[0, 1, 2].map((index) => (
          <li key={index} className={styles.skeletonCard}>
            <Skeleton lines={3} />
          </li>
        ))}
      </ul>
    );
  } else if (cards.state === "failed") {
    projectBody = (
      <div className={styles.emptyCard} data-cards="failed">
        <ErrorState
          target={t("launcher.label.projects")}
          onRetry={() => {
            setCards({ state: "loading" });
            void loadProjects();
          }}
        />
      </div>
    );
  } else if (activeProjects.length === 0) {
    projectBody = (
      <div className={styles.emptyCard} data-cards="empty">
        <EmptyState
          icon={launcherIcons.addFolder}
          message={t("launcher.empty.no-projects")}
          action={{ label: register, onSelect: () => setRegistering(true) }}
        />
      </div>
    );
  } else {
    projectBody = (
      <ul className={styles.grid} data-cards="projects">
        {activeProjects.map((card) => (
          <li key={card.id}>
            <ProjectCard
              card={card}
              onOpen={onProject}
              onDetails={(item) => setDetail(item.id)}
              onArchive={(item) => void setProjectArchived(item, true)}
              onRelocate={(item, folder) => void relocate(item, folder)}
            />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <>
      {projects ? (
        <section className={styles.section} data-section="projects">
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>
              {t("launcher.heading.projects")}
              {activeProjects.length > 0 ? (
                <span className={styles.count}>{activeProjects.length}</span>
              ) : null}
            </h2>
            <Tooltip content={register}>
              <IconButton
                icon={launcherIcons.register}
                label={register}
                data-register-project=""
                onClick={() => setRegistering(true)}
              />
            </Tooltip>
          </div>
          {projectBody}
          {registerDialog}
          {detailed ? (
            <ProjectDetailDialog
              source={projects}
              project={detailed}
              onChanged={replaceProject}
              onLatest={() => void loadProjects()}
              onRelocate={relocate}
              onClose={() => setDetail(null)}
            />
          ) : null}
        </section>
      ) : null}
      {apps ? (
        <AppsSection
          apps={
            rows.state === "ready"
              ? { state: "ready", items: activeApps }
              : rows
          }
          onApp={onApp}
          onNew={() => setCreatingApp(true)}
          onArchive={(app) => void setAppArchived(app, true)}
          onRetry={() => {
            setRows({ state: "loading" });
            void loadApps();
          }}
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
      <ArchivedSection
        items={[
          ...projectItems
            .filter((item) => item.archived)
            .map((item) => ({
              kind: "project" as const,
              id: item.id,
              name: item.title,
            })),
          ...appItems
            .filter((item) => item.archived)
            .map((item) => ({
              kind: "app" as const,
              id: item.id,
              name: item.name,
            })),
        ]}
        onRestore={(item) => {
          if (item.kind === "project") {
            const project = projectItems.find((row) => row.id === item.id);
            if (project) void setProjectArchived(project, false);
          } else {
            const app = appItems.find((row) => row.id === item.id);
            if (app) void setAppArchived(app, false);
          }
        }}
      />
    </>
  );
}
