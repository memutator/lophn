// project sidebar의 Workflows 탭. workflow 줄 하나가 run 줄처럼 아이콘, 이름, 아래 줄이다. 누르면 그 workflow의 탭을 연다.
// 목록과 도는 수는 이 탭이 읽고, instance가 바뀔 때마다 다시 읽는다.
import { ErrorState } from "@lophn/ui/feedback";
import { Tooltip } from "@lophn/ui/overlay";
import { t } from "@lophn/i18n";

import { useFollowedRead } from "../../desktop/connection/core-read.ts";
import { commonIcons, editorIcons } from "../../icons/mod.ts";
import {
  PanelEmpty,
  PanelRow,
  PanelRows,
  TileIcon,
} from "../../shell/panel-rows.tsx";
import type { WorkflowEntryView, WorkspaceSource } from "../source.ts";
import styles from "./workflow-panel.module.css";

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
  // 목록을 못 읽으면 실패이고, 도는 수를 못 읽으면 0으로 보인다.
  const { loaded, reload } = useFollowedRead(
    async () => {
      const [list, instances] = await Promise.all([
        source.workflows(project),
        source.workflowInstances({ project, state: "running" }),
      ]);
      if (!list.ok) return list;
      /** workflow 이름별로 도는 instance 수. */
      const running: Record<string, number> = {};
      for (const item of instances.ok ? instances.value : []) {
        running[item.workflow] = (running[item.workflow] ?? 0) + 1;
      }
      return { ok: true as const, value: { entries: list.value, running } };
    },
    ["workflow_instances"],
    project,
  );

  if (loaded.state === "failed") {
    return (
      <ErrorState target={t("workflow.label.list-target")} onRetry={reload} />
    );
  }
  if (loaded.state === "loading") return null;
  const { entries, running } = loaded.value;
  if (entries.length === 0) {
    return <PanelEmpty>{t("workflow.empty.sidebar")}</PanelEmpty>;
  }
  return (
    <PanelRows label={t("workflow.heading.list")}>
      {entries.map((entry) => {
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
