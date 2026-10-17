import { type ReactNode, useCallback, useEffect, useState } from "react";
import { t } from "@lophn/wording";
import { Button, IconButton } from "@lophn/ui/primitives";
import { EmptyState, ErrorState, Skeleton } from "@lophn/ui/feedback";
import { Tooltip } from "@lophn/ui/overlay";
import {
  launcherEmptyIcon,
  launcherIcons,
  lophnEntryIcon,
} from "../../icons/mod.ts";

import type { CoreSource } from "../connection/connection.ts";
import {
  ConnectionGate,
  ConnectionNotice,
  retryConnection,
  useConnection,
} from "../connection/connection.tsx";
import { WaitingLayer } from "../connection/waiting/waiting-layer.tsx";
import { sortApps } from "../lophn-space/apps/model.ts";
import type { AppRow, AppsSource } from "../lophn-space/apps/source.ts";
import { TopBar, Wordmark } from "../top-bar/top-bar.tsx";
import type { WindowPlatform } from "../top-bar/platform.ts";
import { failureOf } from "./start-failure/model.ts";
import { StartFailureScreen } from "./start-failure/start-failure.tsx";
import { AppsSection } from "./apps-section.tsx";
import type { Loaded } from "./model.ts";
import { ProjectCard } from "./project-card.tsx";
import { RegisterDialog } from "./register-dialog.tsx";
import type { LauncherSource, ProjectCard as Card } from "./source.ts";
import styles from "./launcher.module.css";

interface LauncherProps {
  source: CoreSource;
  /** 확인 시각의 표시. 테스트가 고정한다. */
  formatTime?: (confirmedAt: number) => string;
  /** Lophn Workspace로 이동한다. */
  onLophn: () => void;
  /** 상단 바가 비울 OS 창 조작 자리. 기본은 지금 renderer의 OS다. */
  platform?: WindowPlatform;
  /** 프로젝트 카드와 등록 통로. 없으면 프로젝트는 없는 것으로 본다. */
  projects?: LauncherSource;
  /** 프로젝트 작업대로 이동한다. */
  onProject?: (project: string) => void;
  /** 앱 카드. 없으면 앱 section을 두지 않는다. */
  apps?: AppsSource;
  /** 그 앱의 앱 공간으로 이동한다. */
  onApp?: (app: string) => void;
  /** 새 프로젝트 id. 테스트가 고정한다. */
  newProjectId?: () => string;
  /** 대기 목록 질문 카드의 [Open session]. 호스트가 그 session으로 보낸다. */
  onOpenSession?: (session: string) => void;
  /** 대기 목록 coding agent 카드의 [Answer in terminal]. */
  onAnswerInTerminal?: (session: string) => void;
}

const noop = () => {};

// 48px 바 아래 1040px 가운데 기둥에 프로젝트 section, 그 아래 앱 section. 준비 전·실패는 기둥 대신 연결
// 화면을 보이고, 단절은 마지막 화면 위에 한 줄을 더한다. 카드는 실제 read 결과로만 채운다.
export function Launcher(
  {
    source,
    formatTime,
    onLophn,
    platform,
    projects,
    onProject,
    apps,
    onApp,
    newProjectId,
    onOpenSession = noop,
    onAnswerInTerminal = noop,
  }: LauncherProps,
) {
  const connection = useConnection(source);
  const retry = () => retryConnection(source);
  const failure = failureOf(connection);
  const gated = connection.state === "starting" ||
    connection.state === "failed" || failure !== null;

  return (
    <div
      className={styles.window}
      data-space="launcher"
      data-gated={gated ? "" : undefined}
    >
      <TopBar
        platform={platform}
        leading={<Wordmark>{t("launcher.label.wordmark")}</Wordmark>}
        trailing={gated ? undefined : (
          <span className={styles.topActions}>
            <WaitingLayer
              onOpenSession={onOpenSession}
              onAnswerInTerminal={onAnswerInTerminal}
            />
            <Button
              icon={lophnEntryIcon}
              data-entry="lophn"
              onClick={onLophn}
            >
              {t("launcher.button.lophn")}
            </Button>
          </span>
        )}
      />
      <main className={styles.scroll}>
        {failure !== null
          ? <StartFailureScreen failure={failure} onRetry={retry} />
          : gated
          ? <ConnectionGate connection={connection} onRetry={retry} />
          : (
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
                onLophn={onLophn}
                newProjectId={newProjectId}
              />
            </div>
          )}
      </main>
    </div>
  );
}

interface BodyProps {
  ready: boolean;
  projects?: LauncherSource;
  apps?: AppsSource;
  onProject: (project: string) => void;
  onApp: (app: string) => void;
  onLophn: () => void;
  newProjectId?: () => string;
}

// 프로젝트 카드 묶음과 앱 카드 묶음. 둘 다 비었으면 하나의 비었음 상태 하나만 보인다.
function LauncherBody(
  { ready, projects, apps, onProject, onApp, onLophn, newProjectId }: BodyProps,
) {
  const [cards, setCards] = useState<Loaded<Card>>(
    projects ? { state: "loading" } : { state: "ready", items: [] },
  );
  const [rows, setRows] = useState<Loaded<AppRow>>(
    apps ? { state: "loading" } : { state: "ready", items: [] },
  );
  const [registering, setRegistering] = useState(false);

  const loadProjects = useCallback(async () => {
    if (!projects) return;
    const read = await projects.projects();
    setCards(
      read.ok ? { state: "ready", items: read.value } : { state: "failed" },
    );
  }, [projects]);

  const loadApps = useCallback(async () => {
    if (!apps) return;
    const read = await apps.list();
    setRows(
      read.ok
        ? {
          state: "ready",
          items: sortApps(read.value).filter((row) => !row.archived),
        }
        : { state: "failed" },
    );
  }, [apps]);

  // 처음 열 때와 core가 다시 준비될 때 읽는다.
  useEffect(() => {
    void loadProjects();
    void loadApps();
  }, [loadProjects, loadApps, ready]);

  if (
    cards.state === "ready" && cards.items.length === 0 &&
    rows.state === "ready" && rows.items.length === 0
  ) {
    return (
      <section className={styles.emptyCard} data-cards="empty">
        <EmptyState
          icon={launcherEmptyIcon}
          message={t("launcher.empty.no-cards")}
          action={{ label: t("launcher.button.lophn"), onSelect: onLophn }}
        />
      </section>
    );
  }

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
  } else if (cards.items.length === 0) {
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
        {cards.items.map((card) => (
          <li key={card.id}>
            <ProjectCard card={card} onOpen={onProject} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <>
      {projects
        ? (
          <section className={styles.section} data-section="projects">
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>
                {t("launcher.heading.projects")}
                {cards.state === "ready" && cards.items.length > 0
                  ? <span className={styles.count}>{cards.items.length}</span>
                  : null}
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
          </section>
        )
        : null}
      {apps
        ? (
          <AppsSection
            apps={rows}
            onApp={onApp}
            onLophn={onLophn}
            onRetry={() => {
              setRows({ state: "loading" });
              void loadApps();
            }}
          />
        )
        : null}
    </>
  );
}
