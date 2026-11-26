// workflow와 추가 설정 항목(agent, skill, project_command, permission_rules)을 다른 컴퓨터로 보내는 dialog.
// `settings_export/send`를 써서 대상 컴퓨터가 온라인이든 오프라인(hub 보관 `held_at_hub`)이든 보낼 수 있다.
// 받는 쪽은 Settings › My computers에서 검토 후 적용한다.

import { type MessageKey, t } from "@lophn/i18n";
import { Checkbox, Field, Input, Select } from "@lophn/ui/input";
import { Dialog } from "@lophn/ui/overlay";
import { Button } from "@lophn/ui/primitives";
import { useMemo, useState } from "react";

import type { SettingsExportKind } from "../../../../protocol/folder/settings-export.ts";
import {
  useMachinesView,
  useScopeMachine,
} from "../../desktop/machines/context.tsx";
import type { MachineRef } from "../../desktop/machines/scope.tsx";
import type { WorkspaceSource } from "../source.ts";
import styles from "./workflow-panel.module.css";

const HERE_KEY = "__here__";

type ExtraKind = "agent" | "skill" | "project_command";

const EXTRA_KIND_LABEL: Record<ExtraKind, MessageKey> = {
  agent: "settings-sync.label.staged-kind-agent",
  skill: "settings-sync.label.staged-kind-skill",
  project_command: "settings-sync.label.staged-kind-project_command",
};

export interface ExportTargetMachine {
  readonly key: string;
  readonly ref: MachineRef;
  readonly machineId: string;
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
        machineId: view.thisComputer.id,
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
        machineId: machine.id,
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
  const [targetKey, setTargetKey] = useState(() => targets[0]?.key ?? "");
  const [includePermissions, setIncludePermissions] = useState(false);
  const [extraKind, setExtraKind] = useState<ExtraKind>("agent");
  const [extraId, setExtraId] = useState("");
  const [extraItems, setExtraItems] = useState<
    readonly { readonly kind: ExtraKind; readonly id: string }[]
  >([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    readonly machine: string;
    readonly deliveryState: "queued" | "held_at_hub" | "delivered";
    readonly count: number;
  } | null>(null);

  const selectedMachine = useMemo(
    () => targets.find((item) => item.key === targetKey) ?? targets[0] ?? null,
    [targets, targetKey],
  );

  const addExtra = () => {
    const id = extraId.trim();
    if (id === "") return;
    if (extraItems.some((one) => one.kind === extraKind && one.id === id)) {
      setExtraId("");
      return;
    }
    setExtraItems((prev) => [...prev, { kind: extraKind, id }]);
    setExtraId("");
    setError(null);
  };

  const confirmExport = async () => {
    if (selectedMachine === null || source.sendSettingsExport === undefined) {
      return;
    }
    const items: { kind: SettingsExportKind; id: string }[] = [
      { kind: "workflow", id: workflow },
      ...extraItems,
      ...(includePermissions
        ? [{ kind: "permission_rules" as const, id: "permission_rules" }]
        : []),
    ];
    setBusy(true);
    setError(null);
    const sent = await source.sendSettingsExport({
      to: selectedMachine.machineId,
      items,
      project,
      ...(note.trim() === "" ? {} : { note: note.trim() }),
    });
    setBusy(false);
    if (!sent.ok) {
      const reason = sent.details?.["reason"];
      if (reason === "body_too_large" || reason === "too_large") {
        setError(t("workflow.error.export-too-large", { name: workflow }));
      } else if (sent.message === "forbidden") {
        setError(
          t("workflow.dialog.export-denied", {
            machine: selectedMachine.label,
          }),
        );
      } else {
        setError(t("workflow.error.export-failed", { name: workflow }));
      }
      return;
    }
    setDone({
      machine: selectedMachine.label,
      deliveryState: sent.value.delivery_state,
      count: sent.value.item_count,
    });
  };

  const canSubmit = !busy && done === null && selectedMachine !== null;

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
          <p
            className={styles.dialogSuccess}
            role="status"
            data-export-delivery={done.deliveryState}
          >
            {t(
              done.deliveryState === "held_at_hub"
                ? "workflow.dialog.export-done-held"
                : "workflow.dialog.export-done-staged",
              {
                machine: done.machine,
                count: done.count,
              },
            )}
          </p>
        ) : targets.length === 0 ? (
          <p className={styles.dialogNote}>
            {t("workflow.dialog.export-empty-machines")}
          </p>
        ) : (
          <>
            <Field label={t("workflow.dialog.export-machine-label")}>
              <Select
                value={selectedMachine?.key ?? ""}
                disabled={busy}
                options={targets.map((item) => ({
                  value: item.key,
                  label: t(
                    item.connected
                      ? "workflow.dialog.export-machine-online"
                      : "workflow.dialog.export-machine-offline",
                    { name: item.label },
                  ),
                }))}
                onValueChange={(next) => {
                  setTargetKey(next);
                  setError(null);
                }}
              />
            </Field>
            <Checkbox
              label={t("workflow.dialog.export-include-permissions")}
              checked={includePermissions}
              disabled={busy}
              onCheckedChange={(checked) => {
                setIncludePermissions(checked);
                setError(null);
              }}
            />
            <Field label={t("workflow.dialog.export-extra-label")}>
              <div className={styles.dialogBody}>
                <Select
                  value={extraKind}
                  disabled={busy}
                  options={(["agent", "skill", "project_command"] as const).map(
                    (kind) => ({
                      value: kind,
                      label: t(EXTRA_KIND_LABEL[kind]),
                    }),
                  )}
                  onValueChange={(next) => setExtraKind(next as ExtraKind)}
                />
                <Input
                  value={extraId}
                  disabled={busy}
                  placeholder={t("workflow.dialog.export-extra-id-placeholder")}
                  onChange={(event) => setExtraId(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addExtra();
                    }
                  }}
                />
                <Button
                  size="sm"
                  disabled={busy || extraId.trim() === ""}
                  onClick={addExtra}
                >
                  {t("workflow.dialog.export-extra-add")}
                </Button>
              </div>
            </Field>
            {extraItems.length === 0 ? null : (
              <div>
                {extraItems.map((item) => (
                  <Button
                    key={`${item.kind}:${item.id}`}
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      setExtraItems((prev) =>
                        prev.filter(
                          (one) =>
                            !(one.kind === item.kind && one.id === item.id),
                        ),
                      )
                    }
                  >
                    {`${t(EXTRA_KIND_LABEL[item.kind])}: ${item.id} ×`}
                  </Button>
                ))}
              </div>
            )}
            <Field label={t("workflow.dialog.export-note-label")}>
              <Input
                value={note}
                disabled={busy}
                placeholder={t("workflow.dialog.export-note-placeholder")}
                onChange={(event) => setNote(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && canSubmit) {
                    void confirmExport();
                  }
                }}
              />
            </Field>
            <p className={styles.dialogNote}>
              {t("workflow.dialog.export-staged-note")}
            </p>
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
