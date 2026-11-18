// Settings › Sync. 사람이 정하는 것은 폴더뿐이다: 이름 붙인 폴더들과 "내 컴퓨터들이 같이 보는 폴더". 지금 길은 보기만 한다:
// 컴퓨터마다 연결과 그 컴퓨터의 file을 마지막으로 받은 길·때, 앱마다 마지막으로 맞춘 때. 길을 고르는 설정은 없다.
import { formatRelativeTime, t } from "@lophn/i18n";
import { Button } from "@lophn/ui/primitives";
import { useCallback, useState } from "react";

import { actionIcons, homeIcons } from "../../../icons/mod.ts";
import { useStateChanged } from "../../connection/core-read.ts";
import { useMachinesView } from "../../machines/context.tsx";
import { MachineStatus } from "../../machines/status.tsx";
import type { SettingsPane } from "../model.ts";
import styles from "../settings.module.css";
import { FolderForm } from "./folder-form.tsx";
import type {
  SaveOutcome,
  SyncFolder,
  SyncFolders,
  SyncSettingsSource,
  SyncStatus,
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

function ago(at: string): string {
  return formatRelativeTime(new Date(at), new Date());
}

export function SyncPanel({
  source,
  onPane,
}: {
  source: SyncSettingsSource;
  /** [Open Remote]가 쓴다. */
  onPane: (pane: SettingsPane) => void;
}) {
  const [folders, setFolders] = useState<Loaded<SyncFolders>>(null);
  const [status, setStatus] = useState<Loaded<SyncStatus>>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [failed, setFailed] = useState(false);
  const view = useMachinesView();

  const load = useCallback(() => {
    void source.folders().then((read) => {
      setFolders(read.ok ? read.value : "failed");
    });
    void source.status().then((read) => {
      setStatus(read.ok ? read.value : "failed");
    });
  }, [source]);
  useStateChanged(
    ["settings", "remote_devices", "carry_files", "app_runtime"],
    load,
  );

  // 지우기처럼 form 없이 쓰는 일. 저장된 값은 core가 낸 변경으로 다시 읽어 보인다.
  async function act(run: Promise<SaveOutcome>): Promise<void> {
    const done = await run;
    setFailed(!done.ok);
  }

  if (folders === null) return null;
  if (folders === "failed") {
    return (
      <div data-sync-settings="">
        <h1 className={styles.paneTitle}>{t("settings-sync.label.tab")}</h1>
        <p className={styles.notice} data-sync="failed">
          {t("settings-sync.error.load-failed")}
        </p>
      </div>
    );
  }

  const received = new Map(
    (status === "failed" || status === null ? [] : status.received).map(
      (row) => [row.machine, row],
    ),
  );
  const sharedState =
    status === "failed" || status === null || status.shared === null
      ? null
      : status.shared.state;
  const apps = status === "failed" || status === null ? [] : status.apps;

  return (
    <div data-sync-settings="">
      <h1 className={styles.paneTitle}>{t("settings-sync.label.tab")}</h1>
      <p className={styles.lead}>{t("settings-sync.intro")}</p>

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
              onSaved={() => setEditing(null)}
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
                onSaved={() => setEditing(null)}
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
              save={(name, path) => source.saveNamed({ name, path, was: null })}
              onSaved={() => setEditing(null)}
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

      <section className={styles.groupBlock} data-sync-section="computers">
        <h2 className={styles.groupTitle}>
          {t("settings-sync.heading.computers")}
        </h2>
        {!folders.remoteEnabled ? (
          <div className={styles.lines} data-sync="remote-off">
            <div className={styles.line}>
              <p className={styles.lineHelp}>
                {t("settings-sync.note.remote-off")}
              </p>
              <div className={styles.lineControl}>
                <Button
                  icon={actionIcons.open}
                  onClick={() => onPane("remote")}
                >
                  {t("settings-sync.button.open-remote")}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <ul className={styles.lines}>
            {view?.thisComputer == null ? null : (
              <li
                className={styles.line}
                data-sync-computer={view.thisComputer.id}
              >
                <div className={styles.lineMain}>
                  <span className={styles.productName}>
                    {view.thisComputer.name}
                    <span className={styles.caption}>
                      {t("settings-sync.label.this-computer")}
                    </span>
                  </span>
                </div>
              </li>
            )}
            {view?.machines.map((machine) => {
              const got = received.get(machine.id);
              return (
                <li
                  key={machine.id}
                  className={styles.line}
                  data-sync-computer={machine.id}
                >
                  <div className={styles.lineMain}>
                    <span className={styles.productName}>{machine.name}</span>
                    <span>
                      <MachineStatus machine={machine} full />
                    </span>
                    {got?.receivedAt == null || got.via === null ? null : (
                      <span className={styles.lineHelp} data-sync-received="">
                        {t("settings-sync.note.received", {
                          via: got.via,
                          time: ago(got.receivedAt),
                        })}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
            {view !== null && view.machines.length === 0 ? (
              <li className={styles.line} data-sync="no-computers">
                <p className={styles.lineHelp}>
                  {t("settings-sync.note.no-other-computers")}
                </p>
              </li>
            ) : null}
          </ul>
        )}
      </section>

      <section className={styles.groupBlock} data-sync-section="apps">
        <h2 className={styles.groupTitle}>{t("settings-sync.heading.apps")}</h2>
        {apps.length === 0 ? (
          <p className={styles.lineHelp} data-sync="no-apps">
            {t("settings-sync.note.apps-empty")}
          </p>
        ) : (
          <ul className={styles.lines}>
            {apps.map((app) => (
              <li key={app.app} className={styles.line} data-sync-app={app.app}>
                <div className={styles.lineMain}>
                  <span className={styles.lineName}>{app.name}</span>
                  <span className={styles.lineHelp}>
                    {t("settings-sync.note.syncs-to", {
                      folder:
                        app.syncTo === "computers"
                          ? t("settings-sync.label.destination-computers")
                          : app.syncTo,
                    })}
                    {" · "}
                    {app.readAt === null
                      ? t("settings-sync.note.never-synced")
                      : t("settings-sync.note.synced", {
                          time: ago(app.readAt),
                        })}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
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
