// workflow 탭 한 개의 본문. 머리(이름, kind, 도는 수, [Open artifact], [Start]), instance 목록, 고른 instance의 기본 view.
// data는 props로 받고 읽지 않는다. 같은 component에 hook이 읽은 값을 넘기면 renderer로 그대로 옮겨진다.
import { useState } from "react";
import {
  ExternalLink,
  Info,
  RefreshCw,
  TriangleAlert,
  Workflow,
} from "lucide-react";
import { Button, Icon, IconButton } from "@lophn/ui/primitives";
import { EmptyState } from "@lophn/ui/feedback";
import { Toast, Tooltip } from "@lophn/ui/overlay";
import { iconPixels } from "@lophn/ui/shared";

import type {
  WorkflowEntry,
  WorkflowInstanceSummary,
} from "../../../../packages/protocol/workflows/mod.ts";
import type { WorkflowDetail } from "../../mock/workflow-data.ts";
import { InstanceList } from "./instance-list.tsx";
import { InstanceView } from "./instance-view.tsx";
import { StartDialog } from "./start-dialog.tsx";
import styles from "./workflow.module.css";

export interface WorkflowNotice {
  readonly title: string;
  readonly body: string;
}

export function WorkflowBody(
  {
    entry,
    instances,
    selected,
    detail,
    notice = null,
    onSelect,
    onStart,
    onStop,
    onOpenArtifact,
    onOpenConversation,
    onRefresh,
    onCloseNotice,
  }: {
    entry: WorkflowEntry;
    instances: readonly WorkflowInstanceSummary[];
    selected: string | null;
    /** 고른 instance의 읽기 결과. */
    detail: WorkflowDetail | null;
    /** 시작이나 멈춤이 실패했다는 알림. 탭 위쪽 toast로 뜬다. */
    notice?: WorkflowNotice | null;
    onSelect: (id: string) => void;
    onStart: (text: string, step: string) => void;
    onStop: () => void;
    onOpenArtifact: (view: "static" | "instance") => void;
    onOpenConversation: (session: string) => void;
    onRefresh: () => void;
    onCloseNotice?: () => void;
  },
) {
  const [starting, setStarting] = useState(false);
  const running = instances.filter((item) => item.state === "running").length;
  const invalid = entry.state === "invalid";
  const flow = entry.kind === "flow";
  const kindText = entry.kind ?? "unreadable";
  return (
    <div className={styles.page}>
      {notice === null ? null : (
        <div className={styles.toastSlot}>
          <Toast
            tone="error"
            title={notice.title}
            body={notice.body}
            onClose={onCloseNotice ?? (() => {})}
          />
        </div>
      )}
      <header className={styles.head}>
        <span className={styles.headIcon}>
          <Icon icon={Workflow} pixels={iconPixels("large")} />
        </span>
        <div className={styles.headText}>
          <h1 className={styles.title}>{entry.name}</h1>
          <p className={styles.sub}>
            {kindText}
            {invalid || flow ? null : ` · ${running} running`}
          </p>
        </div>
        <span className={styles.actions}>
          {entry.artifacts.static
            ? (
              <Button
                icon={ExternalLink}
                onClick={() => onOpenArtifact("static")}
              >
                Open artifact
              </Button>
            )
            : null}
          {invalid ? null : entry.startable
            ? (
              <Button
                variant="primary"
                onClick={() => setStarting(true)}
                data-start=""
              >
                Start
              </Button>
            )
            : (
              <Tooltip content={entry.problem?.message ?? ""}>
                <span
                  className={styles.tipTarget}
                  tabIndex={0}
                  data-start-tip=""
                >
                  <Button variant="primary" disabled>Start</Button>
                </span>
              </Tooltip>
            )}
        </span>
      </header>
      {entry.problem === null ? null : (
        <p className={styles.problem}>
          <span
            className={styles.problemMark}
            data-tone={invalid ? "critical" : "neutral"}
          >
            <Icon
              icon={invalid ? TriangleAlert : Info}
              pixels={iconPixels("base")}
            />
          </span>
          <span>{entry.problem.message}</span>
        </p>
      )}
      {invalid || flow ? null : (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Instances</h2>
            <span className={styles.count}>{instances.length}</span>
            <span className={styles.actions}>
              <IconButton
                icon={RefreshCw}
                label="Refresh"
                size="sm"
                onClick={onRefresh}
              />
            </span>
          </div>
          {instances.length === 0
            ? (
              <EmptyState
                icon={Workflow}
                message="No instances yet. Start one to see its steps and reports here."
                action={{ label: "Start", onSelect: () => setStarting(true) }}
              />
            )
            : (
              <InstanceList
                instances={instances}
                selected={selected}
                onSelect={onSelect}
              />
            )}
        </section>
      )}
      {detail === null ? null : (
        <InstanceView
          detail={detail}
          hasArtifact={entry.artifacts.instance}
          onStop={onStop}
          onOpenArtifact={() => onOpenArtifact("instance")}
          onOpenConversation={onOpenConversation}
        />
      )}
      {starting
        ? (
          <StartDialog
            entry={entry}
            onCancel={() => setStarting(false)}
            onStart={(text, step) => {
              setStarting(false);
              onStart(text, step);
            }}
          />
        )
        : null}
    </div>
  );
}
