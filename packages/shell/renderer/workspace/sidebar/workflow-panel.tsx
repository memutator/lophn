// project sidebar의 Workflows 탭. workflow 줄 하나가 run 줄처럼 아이콘, 이름, 아래 줄이다. 누르면 그 workflow의 탭을 연다.
// 목록과 도는 수는 이 탭이 읽고, instance나 project workflow 목록이 바뀔 때마다 다시 읽는다.

import { t } from "@lophn/i18n";
import { ErrorState } from "@lophn/ui/feedback";
import { Field, Input } from "@lophn/ui/input";
import { Dialog, Menu, MenuIcon, Tooltip } from "@lophn/ui/overlay";
import { Button, IconButton } from "@lophn/ui/primitives";
import { useState } from "react";

import type { CleanUpMode } from "../../../../protocol/base/follow-ups.ts";
import { workflowNameSchema } from "../../../ipc/artifact.ts";
import { useFollowedRead } from "../../desktop/connection/core-read.ts";
import { useScopeMachine } from "../../desktop/machines/context.tsx";
import { useMachineHub } from "../../desktop/machines/scope.tsx";
import {
  actionIcons,
  commonIcons,
  editorIcons,
  homeIcons,
} from "../../icons/mod.ts";
import {
  CascadeDeleteActions,
  CascadeImpactDetails,
  useImpact,
  useOpenHandoffSession,
} from "../../shell/cascade-delete-confirm.tsx";
import {
  PanelEmpty,
  PanelRow,
  PanelRows,
  TileIcon,
} from "../../shell/panel-rows.tsx";
import type { WorkflowEntryView, WorkspaceSource } from "../source.ts";
import {
  ExportWorkflowDialog,
  useExportTargetMachines,
} from "./export-workflow-dialog.tsx";
import styles from "./workflow-panel.module.css";

// 사람 차례인 run이 있으면 그것을 먼저 말한다.
function metaOf(
  entry: WorkflowEntryView,
  running: number,
  needsYou: number,
): string {
  if (entry.problem !== null) return t("workflow.label.invalid");
  const count = t("workflow.label.running-count", { count: running });
  return needsYou === 0
    ? count
    : `${t("workflow.label.needs-you-count", { count: needsYou })} · ${count}`;
}

export function WorkflowPanel({
  project,
  source,
  active,
  onOpen,
  onNew,
}: {
  project: string;
  source: WorkspaceSource;
  /** 보이는 desk가 이 workflow의 것이면 그 이름. 그 줄을 고른 상태로 그린다. */
  active?: string;
  onOpen: (workflow: string) => void;
  /** workflow는 project의 agent가 쓴다. 그 대화를 여는 길이고, 없으면 단추를 그리지 않는다. */
  onNew?: () => void;
}) {
  const remote = useScopeMachine() !== null;
  const hub = useMachineHub();
  const exportTargets = useExportTargetMachines();
  const openHandoff = useOpenHandoffSession();
  const [renaming, setRenaming] = useState<WorkflowEntryView | null>(null);
  const [nextName, setNextName] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<WorkflowEntryView | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const [exporting, setExporting] = useState<WorkflowEntryView | null>(null);

  const impact = useImpact(
    deleting === null
      ? null
      : { kind: "workflow", project, name: deleting.name },
  );

  // 목록을 못 읽으면 실패이고, 도는 수를 못 읽으면 0으로 보인다.
  const { loaded, reload } = useFollowedRead(
    async () => {
      const [list, instances] = await Promise.all([
        source.workflows(project),
        source.workflowInstances({ project, state: "running" }),
      ]);
      if (!list.ok) return list;
      /** workflow 이름별로 도는 run 수와 그 가운데 사람 차례인 수. */
      const running: Record<string, number> = {};
      const needsYou: Record<string, number> = {};
      for (const item of instances.ok ? instances.value : []) {
        running[item.workflow] = (running[item.workflow] ?? 0) + 1;
        if (item.current?.human_turn === true) {
          needsYou[item.workflow] = (needsYou[item.workflow] ?? 0) + 1;
        }
      }
      return {
        ok: true as const,
        value: { entries: list.value, running, needsYou },
      };
    },
    ["workflow_instances", "projects"],
    project,
  );

  const canRename = !remote && source.renameWorkflow !== undefined;
  const canDelete = !remote && source.deleteWorkflow !== undefined;
  const canExport =
    source.exportWorkflow !== undefined &&
    hub !== null &&
    exportTargets.length > 0;

  const startRename = (entry: WorkflowEntryView) => {
    setRenaming(entry);
    setNextName(entry.name);
    setRenameError(null);
  };

  const cancelRename = () => {
    if (renameBusy) return;
    setRenaming(null);
    setRenameError(null);
  };

  const confirmRename = async () => {
    if (renaming === null || source.renameWorkflow === undefined) return;
    const trimmed = nextName.trim();
    if (trimmed === renaming.name) {
      setRenaming(null);
      return;
    }
    if (!workflowNameSchema.safeParse(trimmed).success) {
      setRenameError(t("workflow.error.rename-invalid"));
      return;
    }
    setRenameBusy(true);
    setRenameError(null);
    const result = await source.renameWorkflow({
      project,
      from: renaming.name,
      to: trimmed,
    });
    setRenameBusy(false);
    if (!result.ok) {
      setRenameError(
        result.message === "conflict"
          ? t("workflow.error.rename-conflict", { name: trimmed })
          : result.message === "invalid_input"
            ? t("workflow.error.rename-invalid")
            : t("workflow.error.rename-failed", { name: renaming.name }),
      );
      return;
    }
    setRenaming(null);
    reload();
  };

  const cancelDelete = () => {
    if (deleteBusy) return;
    setDeleting(null);
    setDeleteFailed(false);
  };

  const confirmDelete = async (cleanUp: CleanUpMode) => {
    if (deleting === null || source.deleteWorkflow === undefined) return;
    setDeleteBusy(true);
    setDeleteFailed(false);
    const result = await source.deleteWorkflow({
      project,
      name: deleting.name,
      cleanUp,
    });
    setDeleteBusy(false);
    if (!result.ok) {
      if (result.message === "not_found") {
        setDeleting(null);
        reload();
      } else {
        setDeleteFailed(true);
      }
      return;
    }
    setDeleting(null);
    reload();
    openHandoff(result.value.handoff_session);
  };

  if (loaded.state === "failed") {
    return (
      <ErrorState target={t("workflow.label.list-target")} onRetry={reload} />
    );
  }
  if (loaded.state === "loading") return null;
  const { entries, running, needsYou } = loaded.value;
  const ask =
    onNew === undefined ? null : (
      <div className={styles.ask}>
        <Button size="sm" icon={actionIcons.add} onClick={onNew} data-new="">
          {t("workflow.button.ask-lophn")}
        </Button>
      </div>
    );
  if (entries.length === 0) {
    return (
      <>
        <PanelEmpty>{t("workflow.empty.sidebar")}</PanelEmpty>
        {ask}
      </>
    );
  }
  return (
    <>
      <PanelRows label={t("workflow.heading.list")}>
        {entries.map((entry) => {
          const count = running[entry.name] ?? 0;
          const waiting = needsYou[entry.name] ?? 0;
          const menuItems = [
            ...(canExport
              ? [
                  {
                    id: "export",
                    label: t("workflow.button.export-machine"),
                    data: { "data-menu-item": "export" },
                    leading: <MenuIcon icon={actionIcons.send} />,
                  },
                ]
              : []),
            ...(canRename
              ? [
                  {
                    id: "rename",
                    label: t("workflow.button.rename"),
                    data: { "data-menu-item": "rename" },
                    leading: <MenuIcon icon={actionIcons.edit} />,
                  },
                ]
              : []),
            ...(canDelete
              ? [
                  {
                    id: "delete",
                    label: t("workflow.button.delete"),
                    data: { "data-menu-item": "delete" },
                    leading: <MenuIcon icon={actionIcons.delete} />,
                  },
                ]
              : []),
          ];
          const trailing =
            count > 0 || menuItems.length > 0 ? (
              <span className={styles.trailing}>
                {count > 0 ? (
                  <span
                    className={styles.dot}
                    data-tone={waiting > 0 ? "warning" : "good"}
                    aria-hidden="true"
                  />
                ) : null}
                {menuItems.length > 0 ? (
                  <Menu
                    trigger={
                      <IconButton
                        icon={homeIcons.more}
                        label={t("workflow.button.more", { name: entry.name })}
                        size="sm"
                        data-workflow-menu=""
                      />
                    }
                    items={menuItems}
                    onSelect={(id) => {
                      if (id === "export") setExporting(entry);
                      else if (id === "rename") startRename(entry);
                      else if (id === "delete") {
                        setDeleteFailed(false);
                        setDeleting(entry);
                      }
                    }}
                  />
                ) : null}
              </span>
            ) : undefined;
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
              meta={metaOf(entry, count, waiting)}
              metaTone={entry.invalid ? "critical" : undefined}
              active={entry.name === active}
              trailing={trailing}
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
      {ask}
      {renaming === null ? null : (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) cancelRename();
          }}
          title={t("workflow.dialog.rename-title", { name: renaming.name })}
          actions={
            <>
              <Button disabled={renameBusy} onClick={cancelRename}>
                {t("common.button.cancel")}
              </Button>
              <Button
                variant="primary"
                disabled={renameBusy || nextName.trim() === ""}
                data-action="confirm-rename-workflow"
                onClick={() => void confirmRename()}
              >
                {t("workflow.button.rename")}
              </Button>
            </>
          }
        >
          <div className={styles.dialogBody}>
            <Field label={t("workflow.dialog.rename-label")}>
              <Input
                value={nextName}
                autoFocus
                disabled={renameBusy}
                onChange={(event) => {
                  setNextName(event.currentTarget.value);
                  setRenameError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !renameBusy) {
                    void confirmRename();
                  }
                }}
              />
            </Field>
            {renameError === null ? null : (
              <p className={styles.dialogError} role="alert">
                {renameError}
              </p>
            )}
          </div>
        </Dialog>
      )}
      {deleting === null ? null : (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) cancelDelete();
          }}
          title={t("workflow.dialog.delete-title", { name: deleting.name })}
          actions={
            <CascadeDeleteActions
              report={impact.report}
              loading={impact.loading}
              busy={deleteBusy}
              confirmLabel={t("workflow.button.delete")}
              confirmAction="confirm-delete-workflow"
              onCancel={cancelDelete}
              onConfirm={(cleanUp) => void confirmDelete(cleanUp)}
            />
          }
        >
          <div className={styles.dialogBody}>
            <p className={styles.dialogText}>
              {t("workflow.dialog.delete-text")}
            </p>
            <CascadeImpactDetails
              report={impact.report}
              loading={impact.loading}
            />
            {deleteFailed ? (
              <p className={styles.dialogError} role="alert">
                {t("workflow.error.delete-failed", { name: deleting.name })}
              </p>
            ) : null}
          </div>
        </Dialog>
      )}
      {exporting === null ? null : (
        <ExportWorkflowDialog
          project={project}
          workflow={exporting.name}
          source={source}
          targets={exportTargets}
          onClose={() => setExporting(null)}
        />
      )}
    </>
  );
}
