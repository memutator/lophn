// workflow 탭 한 개의 본문. 화면은 둘이다: workflow 화면(이름, step 줄, 새 run 칸, run 목록)과 run 하나의 화면.
// 탭이 고른 run이 있으면 run 화면이고 [All runs]로 돌아온다. `host`를 모른다. 탭 kind가 props를 채우고, gallery는 Workspace 없이 세운다.
import type { ReactElement } from "react";
import { Button, Icon, IconButton } from "@lophn/ui/primitives";
import {
  EmptyState,
  ErrorState,
  Skeleton,
  useDelayedLoading,
} from "@lophn/ui/feedback";
import { Toast } from "@lophn/ui/overlay";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/i18n";

import {
  actionIcons,
  commonIcons,
  editorIcons,
  homeIcons,
  workspaceIcons,
} from "../icons/mod.ts";
import type { SessionDot } from "../parts/agent-session/activity.ts";
import type {
  WorkflowEntryView,
  WorkspaceSource,
} from "../workspace/source.ts";
import {
  type FaceOf,
  relayOfEntry,
  runningCount,
  workflowProblemText,
} from "./model.ts";
import { Relay } from "./relay.tsx";
import { RunList } from "./run-list.tsx";
import { RunView } from "./run-view.tsx";
import { StartBox } from "./start-box.tsx";
import { useWorkflow } from "./use-workflow.ts";
import styles from "./workflow-page.module.css";

export interface WorkflowPageProps {
  /** prj id. */
  project: string;
  /** workflow 이름(slug). */
  workflow: string;
  /** 탭이 고른 run. 없으면 workflow 화면이다. */
  instance: string | null;
  source: WorkspaceSource;
  onInstance: (instance: string | null) => void;
  onOpenArtifact: (view: "static" | "instance", instance?: string) => void;
  /** step을 받은 session의 대화를 연다. null이면 단추를 그리지 않는다. */
  onOpenSession: ((session: string) => void) | null;
  /** 산출물 파일 경로를 편집기로 연다. 없으면 클릭할 수 없는 경로 글로만 보인다. */
  onOpenFile?: ((path: string) => void) | null;
  /** 이 창이 열 수 있는 session인가. 없으면 모두 연다. */
  canOpenSession?: (session: string) => boolean;
  /** 참가자 agent의 얼굴. 없으면 선언에 적힌 이름만 보인다. */
  faceOf?: FaceOf;
  /** session의 지금 상태. 없으면 run 화면이 session의 기다림을 모른다. */
  dotOf?: (session: string) => SessionDot | null;
}

export function WorkflowPage(props: WorkflowPageProps): ReactElement {
  const { instance, onInstance, faceOf } = props;
  const state = useWorkflow(props);
  const { definitions, instances, detail, notice } = state;
  const showPageLoading = useDelayedLoading(definitions.state === "loading");
  const showRunsLoading = useDelayedLoading(
    definitions.state === "ready" && instances === null,
  );
  const showRunLoading = useDelayedLoading(
    instance !== null && detail === null,
  );

  if (definitions.state === "loading") {
    return (
      <div className={styles.page} data-workflow-page="loading">
        {showPageLoading ? <Skeleton shape="line" lines={6} /> : null}
      </div>
    );
  }
  if (definitions.state === "failed") {
    return (
      <div className={styles.page} data-workflow-page="failed">
        <ErrorState
          target={t("workflow.label.target")}
          onRetry={state.refresh}
        />
      </div>
    );
  }
  const entry = definitions.entry;
  if (entry === null) {
    return (
      <div className={styles.page} data-workflow-page="not-found">
        <EmptyState
          icon={commonIcons.workflow}
          message={t("workflow.empty.not-found")}
          action={{
            label: t("workflow.button.refresh"),
            onSelect: state.refresh,
          }}
        />
      </div>
    );
  }
  const toast =
    notice === null ? null : (
      <div className={styles.toastSlot}>
        <Toast
          tone="error"
          title={notice.title}
          body={notice.body}
          onClose={state.closeNotice}
        />
      </div>
    );
  if (instance !== null) {
    return (
      <>
        {toast}
        <div className={styles.page} data-workflow-page="run">
          {detail === null ? (
            <>
              <div>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={commonIcons.back}
                  onClick={() => onInstance(null)}
                >
                  {t("workflow.button.all-runs")}
                </Button>
              </div>
              {showRunLoading ? <Skeleton shape="line" lines={6} /> : null}
            </>
          ) : (
            <RunView
              detail={detail}
              hasArtifact={entry.artifacts.instance}
              faceOf={faceOf}
              dotOf={props.dotOf}
              onBack={() => onInstance(null)}
              onStop={state.stop}
              onRetry={state.retry}
              onResume={state.resume}
              onSelectInstance={(next) => onInstance(next)}
              onOpenArtifact={() =>
                props.onOpenArtifact("instance", detail.instance.id)
              }
              onOpenSession={props.onOpenSession}
              onOpenFile={props.onOpenFile ?? null}
              canOpenSession={props.canOpenSession}
            />
          )}
        </div>
      </>
    );
  }
  const steps = relayOfEntry(entry);
  return (
    <>
      {toast}
      <div className={styles.page} data-workflow-page="ready">
        <Head
          entry={entry}
          running={instances === null ? 0 : runningCount(instances)}
          onOpenArtifact={() => props.onOpenArtifact("static")}
          onRefresh={state.refresh}
        />
        {entry.problem === null ? null : (
          <p className={styles.problem} data-problem={entry.problem.reason}>
            <span
              className={styles.problemMark}
              data-tone={
                entry.invalid ||
                entry.problem.reason === "invalid_inputs" ||
                entry.problem.reason === "broken_flow"
                  ? "critical"
                  : "neutral"
              }
            >
              <Icon
                icon={
                  entry.invalid ||
                  entry.problem.reason === "invalid_inputs" ||
                  entry.problem.reason === "broken_flow"
                    ? editorIcons.problem
                    : homeIcons.details
                }
                pixels={iconPixels("base")}
              />
            </span>
            <span>{workflowProblemText(entry.problem)}</span>
          </p>
        )}
        {steps.length === 0 ? null : <Relay steps={steps} faceOf={faceOf} />}
        {entry.invalid ? null : (
          <>
            <StartBox
              key={entry.key}
              entry={entry}
              callableAgents={definitions.callableAgents}
              onStart={state.start}
            />
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>
                {t("workflow.heading.instances")}
              </h2>
              {instances === null && showRunsLoading ? (
                <Skeleton shape="line" lines={3} />
              ) : null}
              {instances?.length === 0 ? (
                <p className={styles.empty}>{t("workflow.empty.instances")}</p>
              ) : null}
              {instances !== null && instances.length > 0 ? (
                <RunList instances={instances} onSelect={onInstance} />
              ) : null}
            </section>
          </>
        )}
      </div>
    </>
  );
}

function Head({
  entry,
  running,
  onOpenArtifact,
  onRefresh,
}: {
  entry: WorkflowEntryView;
  running: number;
  onOpenArtifact: () => void;
  onRefresh: () => void;
}) {
  const sub =
    entry.kind === "agent"
      ? t("workflow.label.sub-agent", { count: running })
      : entry.kind === "flow"
        ? t("workflow.label.sub-flow", { count: running })
        : t("workflow.label.sub-unreadable");
  return (
    <header className={styles.head}>
      <span className={styles.headIcon}>
        <Icon icon={commonIcons.workflow} pixels={iconPixels("large")} />
      </span>
      <div className={styles.headText}>
        <h1 className={styles.title}>{entry.name}</h1>
        <p className={styles.sub}>{sub}</p>
      </div>
      <span className={styles.actions}>
        <IconButton
          icon={workspaceIcons.refresh}
          label={t("workflow.button.refresh")}
          size="sm"
          onClick={onRefresh}
        />
        {entry.artifacts.static ? (
          <Button trailingIcon={actionIcons.open} onClick={onOpenArtifact}>
            {t("workflow.button.open-artifact")}
          </Button>
        ) : null}
      </span>
    </header>
  );
}
