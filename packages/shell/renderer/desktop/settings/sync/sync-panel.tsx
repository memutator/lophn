// Settings › My computers 안의 동기화·파일 전송·staged 설정·폴더 섹션.
// 앱별 sync policy(`sync.app_policies`) 덮어쓰기, keep_both/held 해결, 받은 파일(`transfers/*`),
// 대기 중인 설정/workflow(`settings_export/*`, permission_rules 사람 명시 확인), 공유 폴더를 다룬다.
import { formatRelativeTime, type MessageKey, t } from "@lophn/i18n";
import { StatusMark } from "@lophn/ui/feedback";
import { Checkbox, Select } from "@lophn/ui/input";
import { Button } from "@lophn/ui/primitives";
import { useCallback, useState } from "react";

import { takeInText } from "../../../apps/take-in-note.ts";
import { actionIcons, homeIcons } from "../../../icons/mod.ts";
import { useStateChanged } from "../../connection/core-read.ts";
import { useMachinesView } from "../../machines/context.tsx";
import type { MachinesView } from "../../machines/source.ts";
import type { RemoteDevice } from "../remote/source.ts";
import { NamedControl } from "../general/named-control.tsx";
import styles from "../settings.module.css";
import { FolderForm } from "./folder-form.tsx";
import {
  type AppSyncOverride,
  type AppSyncPolicy,
  type AvailableApp as SyncAvailable,
  batchRequiresPermissionConfirmation,
  type SaveOutcome,
  type SettingsExportKind,
  type StagedSettingsBatch,
  type SyncFolder,
  type SyncFolders,
  type SyncSettingsSource,
  type SyncStatus,
  type TransferRecord,
} from "./source.ts";
import syncStyles from "./sync.module.css";

type Loaded<T> = T | "failed" | null;

/** 고치는 중인 폴더. `was`가 null인 named는 이름 붙인 폴더를 더하는 form이다. */
type Editing =
  | { readonly kind: "shared" }
  | { readonly kind: "named"; readonly was: string | null };

const STATE_TEXT = {
  missing: "settings-sync.state.missing",
  not_writable: "settings-sync.state.not-writable",
} as const;

const POLICY_LABEL: Record<AppSyncPolicy, MessageKey> = {
  computers: "settings-sync.label.policy-computers",
  local: "settings-sync.label.policy-local",
  mixed: "settings-sync.label.policy-mixed",
};

const STAGED_KIND_LABEL: Record<SettingsExportKind, MessageKey> = {
  agent: "settings-sync.label.staged-kind-agent",
  skill: "settings-sync.label.staged-kind-skill",
  project_command: "settings-sync.label.staged-kind-project_command",
  permission_rules: "settings-sync.label.staged-kind-permission_rules",
  workflow: "settings-sync.label.staged-kind-workflow",
};

function ago(at: string): string {
  return formatRelativeTime(new Date(at), new Date());
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 명단(`roster/list`)과 기계 목록(`MachinesView`)에서 같은 machine id를 공유하는 컴퓨터를 모은다. */
export function duplicateMachineIds(
  status: Loaded<SyncStatus>,
  view: MachinesView | null,
): Set<string> {
  const duplicates = new Set<string>(
    status === null || status === "failed" ? [] : status.duplicateMachines,
  );
  if (view !== null) {
    const seen = new Set<string>();
    const ids = [
      ...(view.thisComputer == null ? [] : [view.thisComputer.id]),
      ...view.machines.map((machine) => machine.id),
    ];
    for (const id of ids) {
      if (seen.has(id)) duplicates.add(id);
      else seen.add(id);
    }
  }
  return duplicates;
}

export function SyncSections({
  source,
  status,
  onReloadStatus,
  devices,
}: {
  source: SyncSettingsSource;
  status: Loaded<SyncStatus>;
  onReloadStatus: () => void;
  devices?: readonly RemoteDevice[] | "failed" | null;
}) {
  const [folders, setFolders] = useState<Loaded<SyncFolders>>(null);
  const [transfers, setTransfers] = useState<readonly TransferRecord[]>([]);
  const [staged, setStaged] = useState<readonly StagedSettingsBatch[]>([]);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [failed, setFailed] = useState(false);
  const [heldFailed, setHeldFailed] = useState<string | null>(null);
  const [stagedNotice, setStagedNotice] = useState<
    ReadonlyMap<string, { readonly error: boolean; readonly text: string }>
  >(new Map());
  const [stagedOverwrite, setStagedOverwrite] = useState<ReadonlySet<string>>(
    new Set(),
  );
  // permission_rules / locked_fields가 포함된 배치는 사람이 체크박스를 직접 켠 뒤에만 confirmPermissions: true를 보낸다.
  const [stagedConfirmed, setStagedConfirmed] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [stagedNeedsConfirm, setStagedNeedsConfirm] = useState<
    ReadonlySet<string>
  >(new Set());
  const [busyBatch, setBusyBatch] = useState<string | null>(null);
  // 앱 id → 들이기의 진행·결과 글. 사람이 [Install on this computer]를 누른 앱만 있다.
  const [installs, setInstalls] = useState<
    ReadonlyMap<
      string,
      {
        readonly state: "installing" | "done" | "failed";
        readonly text: string;
      }
    >
  >(new Map());
  const view = useMachinesView();

  const load = useCallback(() => {
    void source.folders().then((read) => {
      setFolders(read.ok ? read.value : "failed");
    });
    void source.transfers().then((read) => {
      if (read.ok) setTransfers(read.value);
    });
    void source.stagedSettings().then((read) => {
      if (read.ok) setStaged(read.value);
    });
  }, [source]);
  useStateChanged(
    ["settings", "remote_devices", "carry_files", "app_runtime", "apps"],
    load,
  );

  async function act(run: Promise<SaveOutcome>): Promise<void> {
    const done = await run;
    setFailed(!done.ok);
    if (done.ok) {
      load();
      onReloadStatus();
    }
  }

  function install(app: SyncAvailable): void {
    const put = (state: {
      state: "installing" | "done" | "failed";
      text: string;
    }) => setInstalls((now) => new Map(now).set(app.app, state));
    put({
      state: "installing",
      text: t("take-in.note.installing", { name: app.name }),
    });
    void source.takeIn(app.app).then((outcome) =>
      put({
        state: outcome.ok ? "done" : "failed",
        text: takeInText(outcome, app.name, machineName(app.machine)),
      }),
    );
  }

  const machineName = (id: string): string => {
    const fromView = view?.machines.find((machine) => machine.id === id)?.name;
    if (fromView !== undefined) return fromView;
    if (devices !== null && devices !== "failed" && devices !== undefined) {
      const fromRoster = devices.find((d) => d.machine === id)?.name;
      if (fromRoster !== undefined) return fromRoster;
    }
    return id;
  };

  async function changePolicy(
    appId: string,
    policy: AppSyncOverride,
  ): Promise<void> {
    const res = await source.setAppSyncPolicy(appId, policy);
    setFailed(!res.ok);
    if (res.ok) onReloadStatus();
  }

  async function resolveHeld(
    appId: string,
    action: "apply" | "discard",
  ): Promise<void> {
    setHeldFailed(null);
    const res = await source.resolveAppHeld(appId, action);
    if (!res.ok) {
      setHeldFailed(appId);
      return;
    }
    onReloadStatus();
  }

  async function clearTransfer(id: string): Promise<void> {
    const res = await source.clearTransfer(id);
    if (res.ok) {
      setTransfers((prev) => prev.filter((item) => item.id !== id));
    }
  }

  async function applyBatch(batch: StagedSettingsBatch): Promise<void> {
    const sensitive =
      batchRequiresPermissionConfirmation(batch) ||
      stagedNeedsConfirm.has(batch.id);
    const confirmed = stagedConfirmed.has(batch.id);
    if (sensitive && !confirmed) {
      setStagedNotice((prev) =>
        new Map(prev).set(batch.id, {
          error: true,
          text: t("settings-sync.error.staged-confirm-required"),
        }),
      );
      return;
    }
    setBusyBatch(batch.id);
    const res = await source.applyStagedSettings({
      batch: batch.id,
      overwrite: stagedOverwrite.has(batch.id),
      ...(confirmed ? { confirmPermissions: true } : {}),
    });
    setBusyBatch(null);
    if (!res.ok) {
      setStagedNotice((prev) =>
        new Map(prev).set(batch.id, {
          error: true,
          text: t("settings-sync.error.staged-failed"),
        }),
      );
      return;
    }
    if (res.value.requiresPermissionConfirmation) {
      setStagedNeedsConfirm((prev) => new Set(prev).add(batch.id));
      setStagedNotice((prev) =>
        new Map(prev).set(batch.id, {
          error: true,
          text: t("settings-sync.error.staged-confirm-required"),
        }),
      );
      return;
    }
    const appliedCount = res.value.applied.filter(
      (item) => item.status === "applied",
    ).length;
    const skippedCount = res.value.applied.filter(
      (item) => item.status === "skipped_conflict",
    ).length;
    setStagedNotice((prev) =>
      new Map(prev).set(batch.id, {
        error: false,
        text:
          skippedCount > 0
            ? t("settings-sync.note.staged-applied-conflicts", {
                applied: appliedCount,
                skipped: skippedCount,
              })
            : t("settings-sync.note.staged-applied", { applied: appliedCount }),
      }),
    );
    if (skippedCount === 0) {
      setStaged((prev) => prev.filter((one) => one.id !== batch.id));
    }
  }

  async function dismissBatch(id: string): Promise<void> {
    setBusyBatch(id);
    const res = await source.dismissStagedSettings(id);
    setBusyBatch(null);
    if (!res.ok) {
      setStagedNotice((prev) =>
        new Map(prev).set(id, {
          error: true,
          text: t("settings-sync.error.staged-failed"),
        }),
      );
      return;
    }
    setStaged((prev) => prev.filter((one) => one.id !== id));
  }

  const sharedState =
    status === "failed" || status === null || status.shared === null
      ? null
      : status.shared.state;
  const apps = status === "failed" || status === null ? [] : status.apps;
  const available =
    status === "failed" || status === null ? [] : status.available;

  return (
    <div data-sync-settings="">
      <section className={styles.groupBlock} data-sync-section="apps">
        <h2 className={styles.groupTitle}>{t("settings-sync.heading.apps")}</h2>
        {apps.length === 0 ? (
          <p className={styles.lineHelp} data-sync="no-apps">
            {t("settings-sync.note.apps-empty")}
          </p>
        ) : (
          <ul className={styles.lines}>
            {apps.map((app) => {
              const policy: AppSyncPolicy =
                app.syncPolicy ??
                (app.destinations.length > 0 ? "computers" : "local");
              const override: AppSyncOverride = app.syncOverride ?? "default";
              const heldCount = app.heldCount ?? 0;
              return (
                <NamedControl
                  key={app.app}
                  name={app.name}
                  labelClass={styles.productName}
                >
                  {({ label, provide }) => (
                    <li className={styles.line} data-sync-app={app.app}>
                      <div className={styles.lineMain}>
                        <span className={styles.productName}>
                          {label}
                          <span
                            className={syncStyles.badge}
                            data-sync-policy={policy}
                          >
                            {t(POLICY_LABEL[policy])}
                          </span>
                        </span>
                        <span className={styles.lineHelp}>
                          {app.destinations.length > 0 ? (
                            <>
                              {t("settings-sync.note.syncs-to", {
                                folder: app.destinations
                                  .map((name) =>
                                    name === "computers"
                                      ? t(
                                          "settings-sync.label.destination-computers",
                                        )
                                      : name,
                                  )
                                  .join(", "),
                              })}
                              {" · "}
                              {t("settings-sync.note.conflict-keep-both")}
                              {" · "}
                            </>
                          ) : null}
                          {app.readAt === null
                            ? t("settings-sync.note.never-synced")
                            : t("settings-sync.note.synced", {
                                time: ago(app.readAt),
                              })}
                        </span>
                        {heldCount > 0 ? (
                          <div
                            className={syncStyles.metaRow}
                            data-sync-held={heldCount}
                          >
                            <StatusMark
                              tone="warning"
                              label={t("settings-sync.warning.held-changes", {
                                count: heldCount,
                              })}
                            />
                            <Button
                              size="sm"
                              data-sync-held-apply=""
                              onClick={() => void resolveHeld(app.app, "apply")}
                            >
                              {t("settings-sync.button.apply-held")}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              data-sync-held-discard=""
                              onClick={() =>
                                void resolveHeld(app.app, "discard")
                              }
                            >
                              {t("settings-sync.button.discard-held")}
                            </Button>
                          </div>
                        ) : null}
                        {heldFailed === app.app ? (
                          <span className={styles.rejected} role="alert">
                            {t("settings-sync.error.held-failed")}
                          </span>
                        ) : null}
                      </div>
                      <div className={styles.lineControl}>
                        {provide(
                          <Select
                            value={override}
                            options={[
                              {
                                value: "default",
                                label: t(
                                  "settings-sync.label.override-default",
                                ),
                              },
                              {
                                value: "computers",
                                label: t(
                                  "settings-sync.label.override-computers",
                                ),
                              },
                              {
                                value: "local",
                                label: t("settings-sync.label.override-local"),
                              },
                            ]}
                            onValueChange={(next) =>
                              void changePolicy(
                                app.app,
                                next as AppSyncOverride,
                              )
                            }
                          />,
                        )}
                      </div>
                    </li>
                  )}
                </NamedControl>
              );
            })}
          </ul>
        )}
      </section>

      <section className={styles.groupBlock} data-sync-section="transfers">
        <h2 className={styles.groupTitle}>
          {t("settings-sync.heading.transfers")}
        </h2>
        {transfers.length === 0 ? (
          <p className={styles.lineHelp} data-sync="no-transfers">
            {t("settings-sync.note.transfers-empty")}
          </p>
        ) : (
          <ul className={styles.lines}>
            {transfers.map((transfer) => {
              const hubName =
                transfer.held_by !== undefined && transfer.held_by.length > 0
                  ? machineName(transfer.held_by[0]!)
                  : null;
              const statusTone =
                transfer.state === "delivered"
                  ? "good"
                  : transfer.state === "failed" || transfer.state === "expired"
                    ? "critical"
                    : transfer.state === "held_at_hub"
                      ? "warning"
                      : "neutral";
              const statusLabel =
                transfer.state === "delivered"
                  ? t("settings-sync.state.transfer-delivered")
                  : transfer.state === "held_at_hub"
                    ? hubName !== null
                      ? t("settings-sync.state.transfer-held", { hub: hubName })
                      : t("settings-sync.state.transfer-held-generic")
                    : transfer.state === "expired"
                      ? t("settings-sync.state.transfer-expired")
                      : transfer.state === "failed"
                        ? t("settings-sync.state.transfer-failed")
                        : t("settings-sync.state.transfer-queued");
              return (
                <li
                  key={transfer.id}
                  className={styles.line}
                  data-transfer-row={transfer.id}
                >
                  <div className={styles.lineMain}>
                    <span className={styles.productName}>
                      {transfer.direction === "incoming"
                        ? t("settings-sync.label.transfer-from", {
                            computer: transfer.from_name,
                          })
                        : t("settings-sync.label.transfer-to", {
                            computer: transfer.to_name,
                          })}
                      <span className={styles.caption}>
                        {ago(transfer.created_at)}
                      </span>
                    </span>
                    <span
                      className={syncStyles.metaRow}
                      data-transfer-state={transfer.state}
                    >
                      <StatusMark tone={statusTone} label={statusLabel} />
                    </span>
                    {transfer.note === null || transfer.note === "" ? null : (
                      <span className={styles.lineHelp}>{transfer.note}</span>
                    )}
                    <ul className={syncStyles.fileList}>
                      {transfer.files.map((file) => (
                        <li key={file.rel_path} className={syncStyles.fileItem}>
                          <span className={styles.mono}>{file.name}</span>
                          <span className={styles.caption}>
                            {formatBytes(file.size)}
                          </span>
                          {file.executable_stripped ? (
                            <span className={styles.caption}>
                              {t("settings-sync.note.executable-stripped")}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                    {transfer.inbox_dir === null ? null : (
                      <span
                        className={`${styles.caption} ${styles.mono} ${syncStyles.path}`}
                      >
                        {`inbox/${transfer.id}/`}
                      </span>
                    )}
                  </div>
                  <div className={styles.lineControl}>
                    <div className={styles.actions}>
                      {transfer.inbox_dir !== null &&
                      source.openInbox !== undefined ? (
                        <Button
                          size="sm"
                          icon={actionIcons.open}
                          data-transfer-open-inbox=""
                          onClick={() =>
                            void source.openInbox?.(transfer.inbox_dir!)
                          }
                        >
                          {t("settings-sync.button.open-inbox")}
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={actionIcons.remove}
                        data-transfer-clear=""
                        onClick={() => void clearTransfer(transfer.id)}
                      >
                        {t("settings-sync.button.clear-transfer")}
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className={styles.groupBlock} data-sync-section="staged">
        <h2 className={styles.groupTitle}>
          {t("settings-sync.heading.staged")}
        </h2>
        {staged.length === 0 ? (
          <p className={styles.lineHelp} data-sync="no-staged">
            {t("settings-sync.note.staged-empty")}
          </p>
        ) : (
          <ul className={styles.lines}>
            {staged.map((batch) => {
              const sensitive =
                batchRequiresPermissionConfirmation(batch) ||
                stagedNeedsConfirm.has(batch.id);
              const confirmed = stagedConfirmed.has(batch.id);
              const overwrite = stagedOverwrite.has(batch.id);
              const notice = stagedNotice.get(batch.id);
              const busy = busyBatch === batch.id;
              return (
                <li
                  key={batch.id}
                  className={styles.line}
                  data-staged-batch={batch.id}
                >
                  <div className={styles.lineMain}>
                    <span className={styles.productName}>
                      {t("settings-sync.label.staged-from", {
                        computer: batch.from_name,
                        time: ago(batch.created_at),
                      })}
                    </span>
                    <span className={syncStyles.metaRow}>
                      <StatusMark
                        tone={
                          batch.delivery_state === "delivered"
                            ? "good"
                            : batch.delivery_state === "held_at_hub"
                              ? "warning"
                              : "neutral"
                        }
                        label={
                          batch.delivery_state === "delivered"
                            ? t("settings-sync.state.transfer-delivered")
                            : batch.delivery_state === "held_at_hub"
                              ? t("settings-sync.state.transfer-held-generic")
                              : t("settings-sync.state.transfer-queued")
                        }
                      />
                      {sensitive ? (
                        <StatusMark
                          tone="warning"
                          label={t("settings-sync.warning.staged-permissions")}
                        />
                      ) : null}
                    </span>
                    {batch.note === null || batch.note === "" ? null : (
                      <span className={styles.lineHelp}>{batch.note}</span>
                    )}
                    <ul className={syncStyles.fileList}>
                      {batch.items.map((item) => (
                        <li
                          key={`${item.kind}:${item.id}`}
                          className={syncStyles.fileItem}
                          data-staged-item={item.kind}
                        >
                          <span className={syncStyles.badge}>
                            {t(STAGED_KIND_LABEL[item.kind])}
                          </span>
                          <span className={styles.mono}>{item.title}</span>
                          <span className={styles.caption}>
                            {t("settings-sync.label.staged-files", {
                              count: item.files.length,
                            })}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <div className={syncStyles.stagedChecks}>
                      <Checkbox
                        label={t("settings-sync.label.staged-overwrite")}
                        checked={overwrite}
                        disabled={busy}
                        onCheckedChange={(checked) =>
                          setStagedOverwrite((prev) => {
                            const next = new Set(prev);
                            if (checked) next.add(batch.id);
                            else next.delete(batch.id);
                            return next;
                          })
                        }
                      />
                      {sensitive ? (
                        <div data-staged-confirm-permissions="">
                          <Checkbox
                            label={t(
                              "settings-sync.label.staged-confirm-permissions",
                            )}
                            checked={confirmed}
                            disabled={busy}
                            onCheckedChange={(checked) => {
                              setStagedConfirmed((prev) => {
                                const next = new Set(prev);
                                if (checked) next.add(batch.id);
                                else next.delete(batch.id);
                                return next;
                              });
                              setStagedNotice((prev) => {
                                const next = new Map(prev);
                                next.delete(batch.id);
                                return next;
                              });
                            }}
                          />
                        </div>
                      ) : null}
                    </div>
                    {notice === undefined ? null : (
                      <p
                        className={
                          notice.error ? styles.rejected : styles.lineHelp
                        }
                        role={notice.error ? "alert" : "status"}
                      >
                        {notice.text}
                      </p>
                    )}
                  </div>
                  <div className={styles.lineControl}>
                    <div className={styles.actions}>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        data-staged-dismiss=""
                        onClick={() => void dismissBatch(batch.id)}
                      >
                        {t("settings-sync.button.staged-dismiss")}
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={busy || (sensitive && !confirmed)}
                        data-staged-apply=""
                        onClick={() => void applyBatch(batch)}
                      >
                        {t("settings-sync.button.staged-apply")}
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className={styles.groupBlock} data-sync-section="available">
        <h2 className={styles.groupTitle}>
          {t("settings-sync.heading.available")}
        </h2>
        {available.length === 0 ? (
          <p className={styles.lineHelp} data-sync="no-available">
            {t("settings-sync.note.available-empty")}
          </p>
        ) : (
          <ul className={styles.lines}>
            {available.map((app) => {
              const progress = installs.get(app.app);
              return (
                <li
                  key={app.app}
                  className={styles.line}
                  data-sync-available={app.app}
                >
                  <div className={styles.lineMain}>
                    <span className={styles.lineName}>{app.name}</span>
                    <span className={styles.lineHelp}>
                      {t("settings-sync.note.available-from", {
                        machine: machineName(app.machine),
                      })}
                    </span>
                    {progress === undefined ? null : (
                      <span
                        className={
                          progress.state === "failed"
                            ? styles.rejected
                            : styles.lineHelp
                        }
                        role={progress.state === "failed" ? "alert" : undefined}
                        data-sync-install={progress.state}
                      >
                        {progress.text}
                      </span>
                    )}
                  </div>
                  <div className={styles.lineControl}>
                    <Button
                      icon={actionIcons.add}
                      data-sync-install-button=""
                      disabled={progress?.state === "installing"}
                      onClick={() => install(app)}
                    >
                      {t("take-in.button.install")}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {[...installs.entries()]
          .filter(
            ([appId, progress]) =>
              progress.state === "done" &&
              !available.some((one) => one.app === appId),
          )
          .map(([appId, progress]) => (
            <p key={appId} className={styles.lineHelp} data-sync-install="done">
              {progress.text}
            </p>
          ))}
      </section>

      {folders === null ? null : folders === "failed" ? (
        <section className={styles.groupBlock} data-sync-section="folders">
          <h2 className={styles.groupTitle}>
            {t("settings-sync.heading.folders")}
          </h2>
          <p className={styles.notice} data-sync="failed">
            {t("settings-sync.error.load-failed")}
          </p>
        </section>
      ) : (
        <section className={styles.groupBlock} data-sync-section="folders">
          <h2 className={styles.groupTitle}>
            {t("settings-sync.heading.folders")}
          </h2>
          <ul className={styles.lines}>
            {editing?.kind === "shared" ? (
              <FolderForm
                source={source}
                name={null}
                path={folders.shared ?? ""}
                save={(_, path) => source.setShared(path)}
                onSaved={() => {
                  setEditing(null);
                  load();
                  onReloadStatus();
                }}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <li className={styles.line} data-sync-row="shared">
                <div className={styles.lineMain}>
                  <span className={styles.lineName}>
                    {t("settings-sync.label.shared")}
                  </span>
                  {folders.shared === null ? (
                    <span className={styles.lineHelp}>
                      {t("settings-sync.note.shared-empty")}
                    </span>
                  ) : (
                    <>
                      <span
                        className={`${styles.lineHelp} ${styles.mono} ${syncStyles.path}`}
                      >
                        {folders.shared}
                      </span>
                      {sharedState === null || sharedState === "ok" ? null : (
                        <span
                          className={syncStyles.warning}
                          data-sync-state={sharedState}
                        >
                          {t(STATE_TEXT[sharedState])}
                        </span>
                      )}
                      <span className={styles.lineHelp}>
                        {t("settings-sync.note.shared-set")}
                      </span>
                    </>
                  )}
                </div>
                <div className={styles.lineControl}>
                  <div className={styles.actions}>
                    {folders.shared === null ? null : (
                      <Button
                        icon={actionIcons.remove}
                        data-sync-remove=""
                        onClick={() => void act(source.setShared(null))}
                      >
                        {t("settings-sync.button.remove")}
                      </Button>
                    )}
                    <Button
                      icon={
                        folders.shared === null
                          ? homeIcons.chooseFolder
                          : actionIcons.edit
                      }
                      data-sync-edit=""
                      onClick={() => setEditing({ kind: "shared" })}
                    >
                      {t(
                        folders.shared === null
                          ? "settings-sync.button.choose"
                          : "settings-sync.button.edit",
                      )}
                    </Button>
                  </div>
                </div>
              </li>
            )}
            {folders.named.map((folder) =>
              editing?.kind === "named" && editing.was === folder.name ? (
                <FolderForm
                  key={folder.name}
                  source={source}
                  name={folder.name}
                  path={folder.path}
                  save={(name, path) =>
                    source.saveNamed({ name, path, was: folder.name })
                  }
                  onSaved={() => {
                    setEditing(null);
                    load();
                    onReloadStatus();
                  }}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <NamedRow
                  key={folder.name}
                  folder={folder}
                  onEdit={() => setEditing({ kind: "named", was: folder.name })}
                  onRemove={() => void act(source.removeNamed(folder.name))}
                />
              ),
            )}
            {editing?.kind === "named" && editing.was === null ? (
              <FolderForm
                source={source}
                name=""
                path=""
                save={(name, path) =>
                  source.saveNamed({ name, path, was: null })
                }
                onSaved={() => {
                  setEditing(null);
                  load();
                  onReloadStatus();
                }}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <li className={styles.line} data-sync-row="add">
                <div className={styles.lineMain}>
                  {folders.named.length === 0 ? (
                    <span className={styles.lineHelp}>
                      {t("settings-sync.note.named-empty")}
                    </span>
                  ) : null}
                </div>
                <div className={styles.lineControl}>
                  <Button
                    icon={actionIcons.add}
                    data-sync-add=""
                    onClick={() => setEditing({ kind: "named", was: null })}
                  >
                    {t("settings-sync.button.add")}
                  </Button>
                </div>
              </li>
            )}
          </ul>
          {failed ? (
            <p className={styles.rejected} role="alert">
              {t("settings.error.value-not-saved")}
            </p>
          ) : null}
        </section>
      )}
    </div>
  );
}

function NamedRow({
  folder,
  onEdit,
  onRemove,
}: {
  folder: SyncFolder;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <li className={styles.line} data-sync-row={folder.name}>
      <div className={styles.lineMain}>
        <span className={styles.lineName}>{folder.name}</span>
        <span
          className={`${styles.lineHelp} ${styles.mono} ${syncStyles.path}`}
        >
          {folder.path}
        </span>
        {folder.state === null || folder.state === "ok" ? null : (
          <span className={syncStyles.warning} data-sync-state={folder.state}>
            {t(STATE_TEXT[folder.state])}
          </span>
        )}
      </div>
      <div className={styles.lineControl}>
        <div className={styles.actions}>
          <Button
            icon={actionIcons.remove}
            data-sync-remove=""
            onClick={onRemove}
          >
            {t("settings-sync.button.remove")}
          </Button>
          <Button icon={actionIcons.edit} data-sync-edit="" onClick={onEdit}>
            {t("settings-sync.button.edit")}
          </Button>
        </div>
      </div>
    </li>
  );
}
