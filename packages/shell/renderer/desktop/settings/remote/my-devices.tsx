// Settings › Remote의 My devices. 내 기기 명단의 기기마다 이름, 종류와 OS, 이 컴퓨터 표시, 컴퓨터면 연결 상태, 폰이면 마지막
// 연결, 터미널 입력 스위치와 [Rename]·[Make primary](폰)·[Remove]다. 이름은 명단에 있어 모든 기계에 같다. 터미널 입력 스위치는
// 이 컴퓨터에서 그 기기를 허락하는가이고 컴퓨터마다 따로다(이 컴퓨터의 줄에는 스위치가 없다). 이 컴퓨터의
// 이름은 위 This computer에서 바꾸고 이 컴퓨터는 뺄 수 없다. 빼면 그 기기는 모든 기계에서 끊기고 그 key로 다시 들지 못해 먼저 한 번
// 묻는다. 두 컴퓨터가 서로 뺀 엇갈림으로 빠진 기기는 "Disputed"와 한 줄 설명, [Remove]만 선다: 믿지 않는 쪽을 여기서 빼면
// 다른 쪽이 돌아온다.
import { useState } from "react";
import { formatRelativeTime, t } from "@lophn/i18n";
import { StatusMark } from "@lophn/ui/feedback";
import { Field, Input, Switch } from "@lophn/ui/input";
import { Dialog, Tooltip } from "@lophn/ui/overlay";
import { Button } from "@lophn/ui/primitives";

import { actionIcons } from "../../../icons/mod.ts";
import { useMachinesView } from "../../machines/context.tsx";
import { MachineStatus } from "../../machines/status.tsx";
import styles from "../settings.module.css";
import type { SyncReceived } from "../sync/source.ts";
import syncStyles from "../sync/sync.module.css";
import remoteStyles from "./remote.module.css";
import type {
  RemoteDevice,
  RemoteSettingsSource,
  SourceResult,
} from "./source.ts";

const OS_LABEL = {
  ios: "settings.label.device-ios",
  android: "settings.label.device-android",
  linux: "settings.label.device-linux",
  macos: "settings.label.device-macos",
  windows: "settings.label.device-windows",
} as const;

// 공개 key의 앞 8글자. 같은 이름의 엇갈린 줄을 가르고 다른 컴퓨터의 Settings › Remote·CLI와 대조하는 데 쓴다.
export function shortKey(key: string): string {
  return key.slice(0, 8);
}

function platformText(device: RemoteDevice): string {
  const kind = t(
    device.kind === "computer"
      ? "settings.label.device-kind-computer"
      : "settings.label.device-kind-phone",
  );
  return `${kind} · ${t(OS_LABEL[device.os])}`;
}

function seenText(device: RemoteDevice): string | null {
  // 컴퓨터의 연결은 기계 목록의 상태가 말한다. 엇갈린 컴퓨터는 link가 없어 마지막으로 본 때를 함께 보인다.
  if (device.kind === "computer" && !device.disputed) return null;
  return device.lastConnectedAt === null
    ? t("settings.label.remote-never-connected")
    : t("settings.label.remote-last-connected", {
        time: formatRelativeTime(new Date(device.lastConnectedAt), new Date()),
      });
}

export function MyDevices({
  source,
  devices,
  removedAt,
  reload,
  receivedByMachine,
  hubMachines,
  versionByMachine,
  duplicateMachines,
}: {
  source: RemoteSettingsSource;
  devices: readonly RemoteDevice[] | "failed" | null;
  /** 다른 컴퓨터가 이 컴퓨터를 빼 명단을 버렸다. 그 뒤로는 이 컴퓨터만 남은 명단이라 왜 비었는지 말한다. */
  removedAt: string | null;
  /** 바꾼 뒤 목록을 다시 읽는다. */
  reload: () => void;
  /** 컴퓨터 id → 마지막으로 받은 file의 길과 시각. */
  receivedByMachine?: ReadonlyMap<string, SyncReceived>;
  /** hub 역할을 맡은 machine id 집합. */
  hubMachines?: ReadonlySet<string>;
  /** 기계 id → 설치된 lophn 판(이 컴퓨터 포함). */
  versionByMachine?: ReadonlyMap<string, string>;
  /** 명단에 중복 machine id가 있는 기계 집합. */
  duplicateMachines?: ReadonlySet<string>;
}) {
  const view = useMachinesView();
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [removing, setRemoving] = useState<RemoteDevice | null>(null);
  const [failed, setFailed] = useState(false);

  const removedNotice =
    removedAt === null ? null : (
      <p className={styles.notice} data-remote-removed="">
        {t("settings.notice.remote-this-removed", {
          time: formatRelativeTime(new Date(removedAt), new Date()),
        })}
      </p>
    );

  if (devices === null) return null;
  if (devices === "failed") {
    return (
      <p className={styles.notice} data-remote-devices="failed">
        {t("settings.error.remote-devices-failed")}
      </p>
    );
  }
  if (devices.length === 0) {
    return (
      <p className={styles.notice} data-remote-devices="empty">
        {t("settings.notice.remote-devices-empty")}
      </p>
    );
  }

  async function act(run: Promise<SourceResult<unknown>>): Promise<boolean> {
    const done = await run;
    setFailed(!done.ok);
    reload();
    return done.ok;
  }

  async function saveName(): Promise<void> {
    if (renaming === null) return;
    if (await act(source.rename(renaming.id, renaming.name.trim()))) {
      setRenaming(null);
    }
  }

  // gallery가 기계 목록 없이 그리면 상태 줄이 없다.
  const machineOf = (device: RemoteDevice) =>
    view?.machines.find((one) => one.id === device.machine);
  const isDeviceHub = (device: RemoteDevice): boolean =>
    device.hub === true ||
    (device.machine !== null && hubMachines?.has(device.machine) === true) ||
    machineOf(device)?.hub === true;
  // offline 컴퓨터의 Two Promises 문구에 붙일 대표 hub 이름.
  const activeHubName =
    devices.find(
      (one) =>
        one.kind === "computer" &&
        !one.disputed &&
        isDeviceHub(one) &&
        (one.thisComputer || machineOf(one)?.status === "connected"),
    )?.name ??
    devices.find(
      (one) => one.kind === "computer" && !one.disputed && isDeviceHub(one),
    )?.name ??
    null;
  const removeName =
    removing === null
      ? ""
      : removing.disputed
        ? `${removing.name} (${shortKey(removing.key)})`
        : removing.name;

  return (
    <>
      {removedNotice}
      <p className={`${styles.lineHelp} ${remoteStyles.listNote}`}>
        {t("settings.note.remote-device-terminal-input")}
      </p>
      <ul className={styles.lines} data-remote-devices="ok">
        {devices.map((device) => {
          if (renaming?.id === device.id && !device.disputed) {
            return (
              <li
                key={device.key}
                className={styles.line}
                data-remote-device-form=""
              >
                <div className={styles.lineMain}>
                  <Field label={t("settings.label.remote-device-name")}>
                    <Input
                      value={renaming.name}
                      maxLength={64}
                      autoFocus
                      onChange={(event) =>
                        setRenaming({ id: device.id, name: event.target.value })
                      }
                    />
                  </Field>
                </div>
                <div className={styles.lineControl}>
                  <div className={styles.actions}>
                    <Button onClick={() => setRenaming(null)}>
                      {t("settings.button.cancel")}
                    </Button>
                    <Button
                      variant="primary"
                      icon={actionIcons.save}
                      disabled={renaming.name.trim() === ""}
                      onClick={() => void saveName()}
                    >
                      {t("settings.button.save")}
                    </Button>
                  </div>
                </div>
              </li>
            );
          }
          // 엇갈림으로 빠진 컴퓨터는 link가 없다.
          const machine = device.disputed ? undefined : machineOf(device);
          const deviceHub = isDeviceHub(device);
          const lophnVersion =
            device.kind !== "computer"
              ? null
              : (machine?.lophnVersion ??
                device.lophnVersion ??
                (device.machine !== null
                  ? versionByMachine?.get(device.machine)
                  : undefined) ??
                null);
          const seen = seenText(device);
          const got =
            device.machine === null
              ? undefined
              : receivedByMachine?.get(device.machine);
          const duplicate =
            device.machine !== null &&
            duplicateMachines?.has(device.machine) === true;
          const viewOnly =
            device.kind === "computer" &&
            !device.thisComputer &&
            !device.disputed &&
            !device.terminalInput;
          const online = machine?.status === "connected";
          return (
            <li
              key={device.key}
              className={styles.line}
              data-remote-device={device.id}
            >
              <div className={styles.lineMain}>
                <span className={styles.productName}>
                  {device.name}
                  {device.thisComputer ? (
                    <span className={styles.caption}>
                      {t("settings.label.remote-this-computer")}
                    </span>
                  ) : null}
                  {deviceHub ? (
                    <span className={remoteStyles.hubBadge} data-remote-hub="">
                      {t("settings.label.remote-hub-badge")}
                    </span>
                  ) : null}
                  {device.primary ? (
                    <span className={styles.caption}>
                      {t("settings.label.remote-primary")}
                    </span>
                  ) : null}
                  {device.pending ? (
                    <span className={styles.caption} data-remote-pending="">
                      {t("settings.label.remote-pending")}
                    </span>
                  ) : null}
                  {device.disputed ? (
                    <span className={styles.caption} data-remote-disputed="">
                      {t("settings.label.remote-disputed")}
                    </span>
                  ) : null}
                  {viewOnly ? (
                    <span className={styles.caption} data-remote-view-only="">
                      {t("settings.label.remote-view-only")}
                    </span>
                  ) : null}
                  {device.disputed || device.thisComputer ? (
                    <Tooltip content={device.key}>
                      <code
                        className={`${styles.caption} ${styles.mono} ${remoteStyles.deviceKey}`}
                        data-remote-device-key=""
                      >
                        {shortKey(device.key)}
                      </code>
                    </Tooltip>
                  ) : null}
                </span>
                <span className={styles.lineHelp}>
                  {platformText(device)}
                  {lophnVersion === null ? null : (
                    <>
                      {" · "}
                      <span data-remote-device-version={lophnVersion}>
                        {t("machine-update.status.lophn-version", {
                          version: lophnVersion,
                        })}
                      </span>
                    </>
                  )}
                  {seen === null ? null : ` · ${seen}`}
                </span>
                {viewOnly ? (
                  <span className={styles.lineHelp} data-remote-no-grant="">
                    {t("settings.note.remote-no-grant")}
                  </span>
                ) : null}
                {device.pending ? (
                  <span className={styles.lineHelp}>
                    {t("settings.note.remote-pending")}
                  </span>
                ) : null}
                {device.disputed ? (
                  <span className={styles.lineHelp}>
                    {t("settings.note.remote-disputed")}
                  </span>
                ) : null}
                {duplicate ? (
                  <span
                    className={syncStyles.warning}
                    role="alert"
                    data-sync-duplicate=""
                  >
                    {t("settings-sync.warning.duplicate-machine")}
                  </span>
                ) : null}
                {machine === undefined ? null : (
                  <span className={remoteStyles.badges}>
                    <MachineStatus machine={machine} full />
                    <span data-remote-promise={online ? "now" : "awake"}>
                      <StatusMark
                        tone={online ? "good" : "neutral"}
                        label={
                          online
                            ? t("settings.label.promise-now")
                            : activeHubName !== null
                              ? t("settings.label.promise-held-at", {
                                  hub: activeHubName,
                                })
                              : t("settings.label.promise-awake")
                        }
                      />
                    </span>
                  </span>
                )}
                {got?.receivedAt == null || got.via === null ? null : (
                  <span className={styles.lineHelp} data-sync-received="">
                    {t("settings-sync.note.received", {
                      via: got.via,
                      time: formatRelativeTime(
                        new Date(got.receivedAt),
                        new Date(),
                      ),
                    })}
                  </span>
                )}
              </div>
              <div className={styles.lineControl}>
                {device.disputed || device.thisComputer ? null : (
                  <div
                    data-remote-terminal-input={String(device.terminalInput)}
                  >
                    <Switch
                      label={t(
                        device.kind === "computer"
                          ? "settings.label.remote-computer-terminal-input"
                          : "settings.label.remote-terminal-input",
                      )}
                      checked={device.terminalInput}
                      onCheckedChange={(on) =>
                        void act(source.setTerminalInput(device.id, on))
                      }
                    />
                  </div>
                )}
              </div>
              {device.thisComputer ? null : (
                <div className={remoteStyles.deviceActions}>
                  {device.disputed ? null : (
                    <Button
                      icon={actionIcons.edit}
                      data-remote-rename=""
                      onClick={() =>
                        setRenaming({ id: device.id, name: device.name })
                      }
                    >
                      {t("settings.button.remote-rename")}
                    </Button>
                  )}
                  {device.primary ||
                  device.disputed ||
                  device.kind !== "phone" ? null : (
                    <Button
                      icon={actionIcons.confirm}
                      data-remote-primary=""
                      onClick={() => void act(source.setPrimary(device.id))}
                    >
                      {t("settings.button.remote-make-primary")}
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    icon={actionIcons.remove}
                    data-remote-remove=""
                    onClick={() => setRemoving(device)}
                  >
                    {t("settings.button.remote-remove")}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {failed ? (
        <p className={styles.rejected} role="alert">
          {t("settings.error.remote-device-failed")}
        </p>
      ) : null}
      <Dialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={t("settings.title.remote-remove", { name: removeName })}
        actions={
          <>
            <Button onClick={() => setRemoving(null)}>
              {t("settings.button.cancel")}
            </Button>
            <Button
              variant="danger"
              icon={actionIcons.remove}
              data-remote-remove-confirm=""
              onClick={() => {
                if (removing === null) return;
                const { key } = removing;
                setRemoving(null);
                void act(source.remove(key));
              }}
            >
              {t("settings.button.remote-remove")}
            </Button>
          </>
        }
      >
        <p className={remoteStyles.dialogText}>
          {t("settings.note.remote-remove", { name: removeName })}
        </p>
        {removing?.kind === "computer" ? (
          <p className={remoteStyles.dialogText}>
            {t("settings.note.remote-remove-logins", { name: removeName })}
          </p>
        ) : null}
      </Dialog>
    </>
  );
}
