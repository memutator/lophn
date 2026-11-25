// workflow 정의 폴더를 연결된 다른 컴퓨터의 project로 내보내는 dialog.
// 현재 project의 기계를 넘는 identity(pri_…)와 같은 project가 대상 컴퓨터에 있으면 기본으로 고른다.

import { t } from "@lophn/i18n";
import { Checkbox, Field, Input, Select } from "@lophn/ui/input";
import { Dialog } from "@lophn/ui/overlay";
import { Button } from "@lophn/ui/primitives";
import { useEffect, useMemo, useState } from "react";

import { workflowNameSchema } from "../../../ipc/artifact.ts";
import {
  useMachinesView,
  useScopeMachine,
} from "../../desktop/machines/context.tsx";
import type { MachineRef } from "../../desktop/machines/scope.tsx";
import { useMachineHub } from "../../desktop/machines/scope.tsx";
import type { ProjectItem } from "../../desktop/workspaces/projects/source.ts";
import type { WorkspaceSource } from "../source.ts";
import styles from "./workflow-panel.module.css";

const HERE_KEY = "__here__";

export interface ExportTargetMachine {
  readonly key: string;
  readonly ref: MachineRef;
  readonly label: string;
  readonly connected: boolean;
}

export function useExportTargetMachines(): readonly ExportTargetMachine[] {
  const scopeMachine = useScopeMachine();
  const view = useMachinesView();
  return useMemo(() => {
    if (view === null) return [];
    const list: ExportTargetMachine[] = [];
    if (scopeMachine !== null && view.thisComputer !== null) {
      list.push({
        key: HERE_KEY,
        ref: null,
        label: t("workflow.label.this-computer", {
          name: view.thisComputer.name,
        }),
        connected: true,
      });
    }
    for (const machine of view.machines) {
      if (machine.id === scopeMachine) continue;
      list.push({
        key: machine.id,
        ref: machine.id,
        label: machine.name,
        connected: machine.status === "connected",
      });
    }
    return list;
  }, [scopeMachine, view]);
}

export function ExportWorkflowDialog({
  project,
  workflow,
  source,
  targets,
  onClose,
}: {
  project: string;
  workflow: string;
  source: WorkspaceSource;
  targets: readonly ExportTargetMachine[];
  onClose: () => void;
}) {
  const scopeMachine = useScopeMachine();
  const hub = useMachineHub();
  const connectedTargets = useMemo(
    () => targets.filter((item) => item.connected),
    [targets],
  );
  const [targetKey, setTargetKey] = useState(
    () => connectedTargets[0]?.key ?? "",
  );
  const [sourceIdentity, setSourceIdentity] = useState<string | null>(null);
  const [grantState, setGrantState] = useState<
    "checking" | "granted" | "denied"
  >("checking");
  const [projectsState, setProjectsState] = useState<
    "loading" | "ready" | "failed"
  >("loading");
  const [targetProjects, setTargetProjects] = useState<readonly ProjectItem[]>(
    [],
  );
  const [targetProject, setTargetProject] = useState("");
  const [targetName, setTargetName] = useState(workflow);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    readonly machine: string;
    readonly name: string;
    readonly count: number;
  } | null>(null);

  const selectedMachine = useMemo(
    () =>
      connectedTargets.find((item) => item.key === targetKey) ??
      connectedTargets[0] ??
      null,
    [connectedTargets, targetKey],
  );

  // 현재 project의 기계를 넘는 identity를 읽어 대상 기계의 같은 project를 자동 선택한다.
  useEffect(() => {
    if (hub === null) return;
    let live = true;
    void hub
      .get(scopeMachine)
      .projects.list()
      .then((res) => {
        if (!live || !res.ok) return;
        const found = res.value.find((item) => item.id === project);
        setSourceIdentity(found?.identity ?? null);
      });
    return () => {
      live = false;
    };
  }, [hub, scopeMachine, project]);

  // 대상 기계를 고르면 쓰기 허락 여부와 활성 project 목록을 읽는다.
  useEffect(() => {
    if (hub === null || selectedMachine === null) {
      setGrantState("granted");
      setProjectsState("ready");
      setTargetProjects([]);
      setTargetProject("");
      return;
    }
    let live = true;
    setGrantState("checking");
    setProjectsState("loading");
    setTargetProjects([]);
    setTargetProject("");
    setError(null);
    const data = hub.get(selectedMachine.ref);
    void Promise.all([data.grant(), data.projects.list()]).then(
      ([granted, listed]) => {
        if (!live) return;
        setGrantState(granted ? "granted" : "denied");
        if (!listed.ok) {
          setProjectsState("failed");
          return;
        }
        const active = listed.value.filter((item) => !item.archived);
        setTargetProjects(active);
        setProjectsState("ready");
      },
    );
    return () => {
      live = false;
    };
  }, [hub, selectedMachine]);

  // 대상 project 목록이나 sourceIdentity가 준비되면 같은 identity의 project를 기본 선택한다.
  useEffect(() => {
    if (targetProjects.length === 0) {
      setTargetProject("");
      return;
    }
    setTargetProject((prev) => {
      if (prev !== "" && targetProjects.some((item) => item.id === prev)) {
        return prev;
      }
      const matched =
        sourceIdentity === null
          ? undefined
          : targetProjects.find((item) => item.identity === sourceIdentity);
      return matched?.id ?? targetProjects[0]!.id;
    });
  }, [targetProjects, sourceIdentity]);

  const confirmExport = async () => {
    if (
      hub === null ||
      selectedMachine === null ||
      targetProject === "" ||
      source.exportWorkflow === undefined
    ) {
      return;
    }
    const trimmed = targetName.trim();
    if (!workflowNameSchema.safeParse(trimmed).success) {
      setError(t("workflow.error.rename-invalid"));
      return;
    }
    const targetData = hub.get(selectedMachine.ref);
    if (targetData.workspace.importWorkflow === undefined) {
      setError(t("workflow.error.export-failed", { name: workflow }));
      return;
    }
    const formatFailure = (
      code: string,
      details?: Readonly<Record<string, unknown>>,
    ): string => {
      const reason = details?.["reason"];
      if (reason === "body_too_large" || reason === "too_large") {
        return t("workflow.error.export-too-large", { name: workflow });
      }
      if (reason === "too_many_files") {
        return t("workflow.error.export-too-many-files", { name: workflow });
      }
      if (code === "conflict") {
        return t("workflow.error.export-conflict", {
          name: trimmed,
          machine: selectedMachine.label,
        });
      }
      if (code === "forbidden") {
        return t("workflow.dialog.export-denied", {
          machine: selectedMachine.label,
        });
      }
      return t("workflow.error.export-failed", { name: workflow });
    };
    setBusy(true);
    setError(null);
    const exported = await source.exportWorkflow({ project, name: workflow });
    if (!exported.ok) {
      setBusy(false);
      setError(formatFailure(exported.message, exported.details));
      return;
    }
    const imported = await targetData.workspace.importWorkflow({
      project: targetProject,
      name: trimmed,
      files: exported.value.files,
      overwrite,
    });
    setBusy(false);
    if (!imported.ok) {
      setError(formatFailure(imported.message, imported.details));
      return;
    }
    setDone({
      machine: selectedMachine.label,
      name: trimmed,
      count: imported.value.files_written,
    });
  };

  const canSubmit =
    !busy &&
    done === null &&
    selectedMachine !== null &&
    grantState === "granted" &&
    projectsState === "ready" &&
    targetProject !== "" &&
    targetName.trim() !== "";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title={t("workflow.dialog.export-title", { name: workflow })}
      actions={
        done !== null ? (
          <Button variant="primary" onClick={onClose}>
            {t("common.button.close")}
          </Button>
        ) : (
          <>
            <Button disabled={busy} onClick={onClose}>
              {t("common.button.cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={!canSubmit}
              data-action="confirm-export-workflow"
              onClick={() => void confirmExport()}
            >
              {t("workflow.button.export")}
            </Button>
          </>
        )
      }
    >
      <div className={styles.dialogBody}>
        {done !== null ? (
          <p className={styles.dialogSuccess} role="status">
            {t("workflow.dialog.export-done", {
              name: done.name,
              machine: done.machine,
              count: done.count,
            })}
          </p>
        ) : connectedTargets.length === 0 ? (
          <p className={styles.dialogNote}>
            {t("workflow.dialog.export-empty-machines")}
          </p>
        ) : (
          <>
            <Field label={t("workflow.dialog.export-machine-label")}>
              <Select
                value={selectedMachine?.key ?? ""}
                disabled={busy}
                options={connectedTargets.map((item) => ({
                  value: item.key,
                  label: item.label,
                }))}
                onValueChange={(next) => {
                  setTargetKey(next);
                  setTargetProject("");
                  setError(null);
                }}
              />
            </Field>
            {grantState === "denied" && selectedMachine !== null ? (
              <p className={styles.dialogError} role="alert">
                {t("workflow.dialog.export-denied", {
                  machine: selectedMachine.label,
                })}
              </p>
            ) : (
              <>
                <Field label={t("workflow.dialog.export-project-label")}>
                  {projectsState === "loading" ? (
                    <p className={styles.dialogNote}>
                      {t("workflow.dialog.export-loading-projects")}
                    </p>
                  ) : projectsState === "failed" && selectedMachine !== null ? (
                    <p className={styles.dialogError} role="alert">
                      {t("workflow.error.export-projects-failed", {
                        machine: selectedMachine.label,
                      })}
                    </p>
                  ) : targetProjects.length === 0 ? (
                    <p className={styles.dialogNote}>
                      {t("workflow.dialog.export-empty-projects")}
                    </p>
                  ) : (
                    <Select
                      value={targetProject}
                      disabled={busy}
                      options={targetProjects.map((item) => ({
                        value: item.id,
                        label: item.title,
                      }))}
                      onValueChange={(next) => {
                        setTargetProject(next);
                        setError(null);
                      }}
                    />
                  )}
                </Field>
                <Field label={t("workflow.dialog.export-name-label")}>
                  <Input
                    value={targetName}
                    disabled={busy}
                    onChange={(event) => {
                      setTargetName(event.currentTarget.value);
                      setError(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && canSubmit) {
                        void confirmExport();
                      }
                    }}
                  />
                </Field>
                <Checkbox
                  label={t("workflow.dialog.export-overwrite-label")}
                  checked={overwrite}
                  disabled={busy}
                  onCheckedChange={(checked) => {
                    setOverwrite(checked);
                    setError(null);
                  }}
                />
              </>
            )}
            {error === null ? null : (
              <p className={styles.dialogError} role="alert">
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
