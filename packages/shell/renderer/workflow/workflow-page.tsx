// workflow 탭 한 개의 본문. 머리(이름, kind, 도는 수, [Open artifact], [Start]), instance 목록, 고른 instance의 기본 view.
// `host`를 모른다. 탭 kind가 props를 채우고, gallery는 Workspace 없이 이 component를 세운다.
import { type ReactElement, useState } from "react";
import { Button, Icon, IconButton } from "@lophn/ui/primitives";
import { EmptyState, ErrorState, Skeleton } from "@lophn/ui/feedback";
import { Toast, Tooltip } from "@lophn/ui/overlay";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/wording";

import {
  browserIcons,
  commonIcons,
  editorIcons,
  launcherIcons,
  workspaceIcons,
} from "../icons/mod.ts";
import type {
  WorkflowEntryView,
  WorkspaceSource,
} from "../workspace/source.ts";
import { InstanceList } from "./instance-list.tsx";
import { InstanceView } from "./instance-view.tsx";
import { runningCount } from "./model.ts";
import { StartDialog } from "./start-dialog.tsx";
import { useWorkflow } from "./use-workflow.ts";
import styles from "./workflow-page.module.css";

export interface WorkflowPageProps {
  /** prj id. */
  project: string;
  /** workflow 이름(slug). */
  workflow: string;
  /** 탭이 고른 instance. 없으면 목록만 보인다. */
  instance: string | null;
  source: WorkspaceSource;
  onInstance: (instance: string | null) => void;
  onOpenArtifact: (view: "static" | "instance", instance?: string) => void;
  /** 사람 차례의 [Open conversation]. null이면 단추를 그리지 않는다. */
  onOpenConversation: ((session: string) => void) | null;
}

export function WorkflowPage(props: WorkflowPageProps): ReactElement {
  const { instance, onInstance } = props;
  const state = useWorkflow(props);
  const [starting, setStarting] = useState(false);
  const { definitions, instances, detail, notice } = state;

  if (definitions.state === "loading") {
    return (
      <div className={styles.page} data-workflow-page="loading">
        <Skeleton shape="line" lines={6} />
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
  return (
    <>
      {notice === null ? null : (
        <div className={styles.toastSlot}>
          <Toast
            tone="error"
            title={notice.title}
            body={notice.body}
            onClose={state.closeNotice}
          />
        </div>
      )}
      <div className={styles.page} data-workflow-page="ready">
        <Head
          entry={entry}
          running={instances === null ? 0 : runningCount(instances)}
          onStart={() => setStarting(true)}
          onOpenArtifact={() => props.onOpenArtifact("static")}
        />
        {entry.problem === null ? null : (
          <p className={styles.problem}>
            <span
              className={styles.problemMark}
              data-tone={entry.invalid ? "critical" : "neutral"}
            >
              <Icon
                icon={entry.invalid
                  ? editorIcons.problem
                  : launcherIcons.details}
                pixels={iconPixels("base")}
              />
            </span>
            <span>{entry.problem.message}</span>
            {entry.invalid
              ? (
                // 목록 절이 없는 탭도 정의를 다시 읽을 수 있어야 한다(선언을 고친 뒤).
                <span className={styles.refresh}>
                  <IconButton
                    icon={workspaceIcons.refresh}
                    label={t("workflow.button.refresh")}
                    size="sm"
                    onClick={state.refresh}
                  />
                </span>
              )
              : null}
          </p>
        )}
        {entry.invalid ? null : (
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>
                {t("workflow.heading.instances")}
              </h2>
              <span className={styles.count}>{instances?.length ?? 0}</span>
              <span className={styles.refresh}>
                <IconButton
                  icon={workspaceIcons.refresh}
                  label={t("workflow.button.refresh")}
                  size="sm"
                  onClick={state.refresh}
                />
              </span>
            </div>
            {instances === null ? <Skeleton shape="line" lines={3} /> : null}
            {instances?.length === 0
              ? (
                <EmptyState
                  icon={commonIcons.workflow}
                  message={t("workflow.empty.instances")}
                  action={entry.startable
                    ? {
                      label: t("workflow.button.start"),
                      onSelect: () => setStarting(true),
                    }
                    : {
                      label: t("workflow.button.refresh"),
                      onSelect: state.refresh,
                    }}
                />
              )
              : null}
            {instances !== null && instances.length > 0
              ? (
                <InstanceList
                  instances={instances}
                  selected={instance}
                  onSelect={onInstance}
                />
              )
              : null}
          </section>
        )}
        {detail === null ? null : (
          <InstanceView
            detail={detail}
            hasArtifact={entry.artifacts.instance}
            onStop={state.stop}
            onOpenArtifact={() =>
              props.onOpenArtifact("instance", detail.instance.id)}
            onOpenConversation={props.onOpenConversation}
          />
        )}
        {starting
          ? (
            <StartDialog
              entry={entry}
              onCancel={() => setStarting(false)}
              onStart={async (text, step) => {
                const started = await state.start(text, step);
                if (started) setStarting(false);
                return started;
              }}
            />
          )
          : null}
      </div>
    </>
  );
}

function Head(
  { entry, running, onStart, onOpenArtifact }: {
    entry: WorkflowEntryView;
    running: number;
    onStart: () => void;
    onOpenArtifact: () => void;
  },
) {
  const sub = entry.kind === "agent"
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
        {entry.artifacts.static
          ? (
            <Button
              icon={browserIcons.openExternal}
              onClick={onOpenArtifact}
            >
              {t("workflow.button.open-artifact")}
            </Button>
          )
          : null}
        {entry.invalid
          ? null
          : entry.startable
          ? (
            <Button variant="primary" onClick={onStart} data-start="">
              {t("workflow.button.start")}
            </Button>
          )
          : (
            <Tooltip content={entry.problem?.message ?? ""}>
              <span
                className={styles.tipTarget}
                tabIndex={0}
                data-start-tip=""
              >
                <Button variant="primary" disabled>
                  {t("workflow.button.start")}
                </Button>
              </span>
            </Tooltip>
          )}
      </span>
    </header>
  );
}
