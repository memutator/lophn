// project sidebar의 Workflows 탭. workflow 줄 하나가 run 줄처럼 아이콘, 이름, 아래 줄이다. 누르면 그 workflow의 탭을 연다.
// 목록과 도는 수는 이 탭이 읽고, instance가 바뀔 때마다 다시 읽는다.
import { useEffect, useState } from "react";
import { ErrorState } from "@lophn/ui/feedback";
import { Tooltip } from "@lophn/ui/overlay";
import { t } from "@lophn/i18n";

import { useWorkflowChanges } from "../../desktop/connection/events/hooks.tsx";
import { commonIcons, editorIcons } from "../../icons/mod.ts";
import {
  PanelEmpty,
  PanelRow,
  PanelRows,
  TileIcon,
} from "../../shell/panel-rows.tsx";
import type { WorkflowEntryView, WorkspaceSource } from "../source.ts";
import styles from "./workflow-panel.module.css";

type Loaded =
  | { state: "loading" }
  | { state: "failed" }
  | { state: "ready"; entries: readonly WorkflowEntryView[] };

function metaOf(entry: WorkflowEntryView, running: number): string {
  if (entry.problem !== null) return t("workflow.label.invalid");
  return t("workflow.label.running-count", { count: running });
}

export function WorkflowPanel({
  project,
  source,
  active,
  onOpen,
}: {
  project: string;
  source: WorkspaceSource;
  /** 보이는 desk가 이 workflow의 것이면 그 이름. 그 줄을 고른 상태로 그린다. */
  active?: string;
  onOpen: (workflow: string) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  /** workflow 이름별로 도는 instance 수. */
  const [running, setRunning] = useState<Readonly<Record<string, number>>>({});
  const [reads, setReads] = useState(0);
  useEffect(() => {
    let live = true;
    void Promise.all([
      source.workflows(project),
      source.workflowInstances({ project, state: "running" }),
    ]).then(([list, instances]) => {
      if (!live) return;
      if (list.ok) setLoaded({ state: "ready", entries: list.value });
      else {
        setLoaded((prev) =>
          prev.state === "ready" ? prev : { state: "failed" },
        );
      }
      if (instances.ok) {
        const counts: Record<string, number> = {};
        for (const item of instances.value) {
          counts[item.workflow] = (counts[item.workflow] ?? 0) + 1;
        }
        setRunning(counts);
      }
    });
    return () => {
      live = false;
    };
  }, [source, project, reads]);
  useWorkflowChanges((_instance, payload) => {
    if (payload.project === project) setReads((count) => count + 1);
  });

  if (loaded.state === "failed") {
    return (
      <ErrorState
        target={t("workflow.label.list-target")}
        onRetry={() => {
          setLoaded({ state: "loading" });
          setReads((count) => count + 1);
        }}
      />
    );
  }
  if (loaded.state === "loading") return null;
  if (loaded.entries.length === 0) {
    return <PanelEmpty>{t("workflow.empty.sidebar")}</PanelEmpty>;
  }
  return (
    <PanelRows label={t("workflow.heading.list")}>
      {loaded.entries.map((entry) => {
        const count = running[entry.name] ?? 0;
        const row = (
          <PanelRow
            key={entry.name}
            data-workflow={entry.name}
            leading={
              <TileIcon
                icon={
                  entry.invalid ? editorIcons.problem : commonIcons.workflow
                }
                tone={entry.invalid ? "critical" : undefined}
              />
            }
            title={entry.name}
            meta={metaOf(entry, count)}
            metaTone={entry.invalid ? "critical" : undefined}
            active={entry.name === active}
            trailing={
              count > 0 ? (
                <span className={styles.dot} aria-hidden="true" />
              ) : undefined
            }
            onClick={() => onOpen(entry.name)}
          />
        );
        return entry.problem === null ? (
          row
        ) : (
          <Tooltip key={entry.name} content={entry.problem.message}>
            <div>{row}</div>
          </Tooltip>
        );
      })}
    </PanelRows>
  );
}
