import { type ReactNode, useCallback, useEffect, useState } from "react";
import { t } from "@lophn/wording";
import {
  EmptyState,
  ErrorState,
  IconButton,
  launcherEmptyIcon,
  launcherIcons,
  Skeleton,
  Tooltip,
} from "@lophn/design/components";

import type { CoreSource } from "../connection/connection.ts";
import {
  ConnectionGate,
  ConnectionNotice,
  retryConnection,
  useConnection,
} from "../connection/connection.tsx";
import { LophnEntry, TopBar, Wordmark } from "../top-bar/top-bar.tsx";
import type { WindowPlatform } from "../top-bar/platform.ts";
import { useRequestOverview } from "../notification-chip/space-decisions.tsx";
import { placeWaiting } from "../lophn-space/things-to-confirm/model.ts";
import { ProjectCard } from "./project-card.tsx";
import { RegisterDialog } from "./register-dialog.tsx";
import type { LauncherSource, ProjectCard as Card } from "./source.ts";
import styles from "./launcher.module.css";

export interface LauncherProps {
  source: CoreSource;
  /** 확인 시각의 표시. 테스트가 고정한다. */
  formatTime?: (confirmedAt: number) => string;
  /** lophn 관리 공간으로 이동한다. */
  onLophn: () => void;
  /** 상단 바가 비울 OS 창 조작 자리. 기본은 지금 renderer의 OS다. */
  platform?: WindowPlatform;
  /** 프로젝트 카드와 등록 통로. 없으면 카드 자리는 비었음 상태다. */
  projects?: LauncherSource;
  /** 프로젝트 작업대로 이동한다. */
  onProject?: (project: string) => void;
  /** 새 프로젝트 id. 테스트가 고정한다. */
  newProjectId?: () => string;
}

type Cards =
  | { state: "loading" }
  | { state: "failed" }
  | { state: "ready"; cards: readonly Card[] };

// 이전 lophn 런처 모양: 48px 바 아래 1040px 가운데 기둥. 준비 전·실패는 기둥 대신 연결 화면을
// 보이고, 단절은 마지막 화면 위에 한 줄을 더한다. 카드는 실제 read 결과로만 채운다(desktop#R7, R25).
export function Launcher(
  {
    source,
    formatTime,
    onLophn,
    platform,
    projects,
    onProject,
    newProjectId,
  }: LauncherProps,
) {
  const connection = useConnection(source);
  const retry = () => retryConnection(source);
  const gated = connection.state === "starting" ||
    connection.state === "failed";
  return (
    <div
      className={styles.window}
      data-space="launcher"
      data-gated={gated ? "" : undefined}
    >
      <TopBar
        platform={platform}
        leading={<Wordmark>{t("launcher.label.wordmark")}</Wordmark>}
        trailing={gated ? undefined : <LophnEntry onLophn={onLophn} />}
      />
      <main className={styles.scroll}>
        {gated
          ? <ConnectionGate connection={connection} onRetry={retry} />
          : (
            <div className={styles.page} data-column="launcher">
              <ConnectionNotice
                connection={connection}
                onRetry={retry}
                formatTime={formatTime}
              />
              {projects
                ? (
                  <Projects
                    source={projects}
                    onProject={onProject ?? (() => {})}
                    newProjectId={newProjectId}
                  />
                )
                : (
                  <section className={styles.emptyCard} data-cards="empty">
                    <EmptyState
                      icon={launcherEmptyIcon}
                      message={t("launcher.empty.no-cards")}
                      action={{
                        label: t("launcher.button.lophn"),
                        onSelect: onLophn,
                      }}
                    />
                  </section>
                )}
            </div>
          )}
      </main>
    </div>
  );
}

interface ProjectsProps {
  source: LauncherSource;
  onProject: (project: string) => void;
  newProjectId?: () => string;
}

// 프로젝트 카드 묶음과 등록. 등록은 추적을 켜지 않고, 등록한 프로젝트의 작업대에서 추적을 정한다
// (flow first-project 1~2단계).
function Projects({ source, onProject, newProjectId }: ProjectsProps) {
  const [cards, setCards] = useState<Cards>({ state: "loading" });
  const [registering, setRegistering] = useState(false);
  const { requests } = useRequestOverview();

  const load = useCallback(async () => {
    const read = await source.projects();
    setCards(
      read.ok ? { state: "ready", cards: read.value } : { state: "failed" },
    );
  }, [source]);

  useEffect(() => {
    void load();
  }, [load]);

  const register = t("launcher.button.register-project");
  const openRegister = () => setRegistering(true);
  const count = cards.state === "ready" ? cards.cards.length : 0;
  let body: ReactNode;
  if (cards.state === "loading") {
    body = (
      <ul className={styles.grid} data-cards="loading" aria-busy="true">
        {[0, 1, 2].map((index) => (
          <li key={index} className={styles.skeletonCard}>
            <Skeleton lines={3} />
          </li>
        ))}
      </ul>
    );
  } else if (cards.state === "failed") {
    body = (
      <div className={styles.emptyCard} data-cards="failed">
        <ErrorState
          target={t("launcher.label.projects")}
          onRetry={() => {
            setCards({ state: "loading" });
            void load();
          }}
        />
      </div>
    );
  } else if (cards.cards.length === 0) {
    body = (
      <div className={styles.emptyCard} data-cards="empty">
        <EmptyState
          icon={launcherIcons.addFolder}
          message={t("launcher.empty.no-projects")}
          action={{ label: register, onSelect: openRegister }}
        />
      </div>
    );
  } else {
    body = (
      <ul className={styles.grid} data-cards="projects">
        {cards.cards.map((card) => (
          <li key={card.id}>
            <ProjectCard
              card={card}
              waiting={placeWaiting(
                requests,
                { kind: "project", id: card.id },
                "approvals",
              )}
              onOpen={onProject}
            />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <section className={styles.section} data-section="projects">
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>
          {t("launcher.heading.projects")}
          {count > 0 ? <span className={styles.count}>{count}</span> : null}
        </h2>
        {count > 0
          ? (
            <Tooltip content={register}>
              <IconButton
                icon={launcherIcons.register}
                label={register}
                data-register-project=""
                onClick={openRegister}
              />
            </Tooltip>
          )
          : null}
      </div>
      {body}
      <RegisterDialog
        open={registering}
        source={source}
        takenNames={cards.state === "ready"
          ? cards.cards.map((card) => card.name)
          : []}
        newProjectId={newProjectId}
        onClose={() => setRegistering(false)}
        onRegistered={(card) => {
          setRegistering(false);
          setCards((current) =>
            current.state === "ready"
              ? { state: "ready", cards: [...current.cards, card] }
              : current
          );
          // 등록 다음 단계(추적을 켤지)는 그 프로젝트의 작업대에서 정한다.
          onProject(card.id);
        }}
      />
    </section>
  );
}
