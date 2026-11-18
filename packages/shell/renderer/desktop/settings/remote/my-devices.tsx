// Settings › Remote의 My devices. 내 기기 명단의 기기마다 이름, 종류와 OS, 이 컴퓨터 표시, 컴퓨터면 연결 상태, 폰이면 마지막
// 연결, 터미널 입력 스위치와 [Rename]·[Make primary](폰)·[Remove]다. 이름과 터미널 입력은 명단에 있어 모든 기계에 같다. 이 컴퓨터의
// 이름은 위 This computer에서 바꾸고 이 컴퓨터는 뺄 수 없다. 빼면 그 기기는 모든 기계에서 끊기고 그 key로 다시 들지 못해 먼저 한 번
// 묻는다. 다른 컴퓨터가 있으면 아래에 시작 때 여는 기계 고르기가 선다.
import { useState } from "react";
import { formatRelativeTime, t } from "@lophn/i18n";
import { Field, Input, Select, Switch } from "@lophn/ui/input";
import { Dialog } from "@lophn/ui/overlay";
import { Button } from "@lophn/ui/primitives";

import { actionIcons } from "../../../icons/mod.ts";
import { useMachines, useMachinesView } from "../../machines/context.tsx";
import type { MachinesSource, MachinesView } from "../../machines/source.ts";
import { MachineStatus } from "../../machines/status.tsx";
import { NamedControl } from "../general/named-control.tsx";
import styles from "../settings.module.css";
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

const LAST = "last";

function detailText(device: RemoteDevice): string {
  const kind = t(
    device.kind === "computer"
      ? "settings.label.device-kind-computer"
      : "settings.label.device-kind-phone",
  );
  const platform = `${kind} · ${t(OS_LABEL[device.os])}`;
  // 컴퓨터의 연결은 기계 목록의 상태가 말한다.
  if (device.kind === "computer") return platform;
  const seen =
    device.lastConnectedAt === null
      ? t("settings.label.remote-never-connected")
      : t("settings.label.remote-last-connected", {
          time: formatRelativeTime(
            new Date(device.lastConnectedAt),
            new Date(),
          ),
        });
  return `${platform} · ${seen}`;
}

export function MyDevices({
  source,
  devices,
  removedAt,
  reload,
}: {
  source: RemoteSettingsSource;
  devices: readonly RemoteDevice[] | "failed" | null;
  /** 다른 컴퓨터가 이 컴퓨터를 빼 명단을 버렸다. 그 뒤로는 이 컴퓨터만 남은 명단이라 왜 비었는지 말한다. */
  removedAt: string | null;
  /** 바꾼 뒤 목록을 다시 읽는다. */
  reload: () => void;
}) {
  const machines = useMachines();
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

  // 다른 기계의 창에는 기계 목록이 없다(Settings가 없다). gallery가 기계 목록 없이 그리면 상태 줄이 없다.
  const machineOf = (device: RemoteDevice) =>
    view?.machines.find((one) => one.id === device.machine);
  const startable =
    machines !== null &&
    view !== null &&
    machines.thisWindow() === null &&
    view.machines.length > 0;

  return (
    <>
      {removedNotice}
      <ul className={styles.lines} data-remote-devices="ok">
        {devices.map((device) => {
          if (renaming?.id === device.id) {
            return (
              <li
                key={device.id}
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
          const machine = machineOf(device);
          return (
            <li
              key={device.id}
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
                </span>
                <span className={styles.lineHelp}>{detailText(device)}</span>
                {device.pending ? (
                  <span className={styles.lineHelp}>
                    {t("settings.note.remote-pending")}
                  </span>
                ) : null}
                {machine === undefined ? null : (
                  <span>
                    <MachineStatus machine={machine} full />
                  </span>
                )}
              </div>
              <div className={styles.lineControl}>
                <div data-remote-terminal-input={String(device.terminalInput)}>
                  <Switch
                    label={t("settings.label.remote-terminal-input")}
                    checked={device.terminalInput}
                    onCheckedChange={(on) =>
                      void act(source.setTerminalInput(device.id, on))
                    }
                  />
                  <p className={styles.lineHelp}>
                    {t("settings.note.remote-device-terminal-input")}
                  </p>
                </div>
                {device.thisComputer ? null : (
                  <div className={styles.actions}>
                    <Button
                      icon={actionIcons.edit}
                      data-remote-rename=""
                      onClick={() =>
                        setRenaming({ id: device.id, name: device.name })
                      }
                    >
                      {t("settings.button.remote-rename")}
                    </Button>
                    {device.primary || device.kind !== "phone" ? null : (
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
              </div>
            </li>
          );
        })}
        {startable ? (
          <StartLine
            machines={machines}
            view={view}
            act={(run) => void act(run)}
          />
        ) : null}
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
        title={t("settings.title.remote-remove", {
          name: removing?.name ?? "",
        })}
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
                const id = removing.id;
                setRemoving(null);
                void act(source.remove(id));
              }}
            >
              {t("settings.button.remote-remove")}
            </Button>
          </>
        }
      >
        <p className={remoteStyles.dialogText}>
          {t("settings.note.remote-remove", { name: removing?.name ?? "" })}
        </p>
        {removing !== null &&
        view?.start.mode === "machine" &&
        view.start.machine === removing.machine ? (
          <p className={remoteStyles.dialogText} data-remote-remove-start="">
            {t("machines.note.remove-start", { name: removing.name })}
          </p>
        ) : null}
      </Dialog>
    </>
  );
}

// 시작 때 여는 기계. 고른 기계가 꺼져 있으면 그 창이 그렇게 말하고 이 컴퓨터를 여는 길을 준다.
function StartLine({
  machines,
  view,
  act,
}: {
  machines: MachinesSource;
  view: MachinesView;
  act: (run: Promise<SourceResult<unknown>>) => void;
}) {
  const chosen = view.start.mode === "machine" ? view.start.machine : LAST;
  const options = [
    { value: LAST, label: t("machines.option.last") },
    ...(view.thisComputer === null
      ? []
      : [{ value: view.thisComputer.id, label: view.thisComputer.name }]),
    ...view.machines.map((one) => ({ value: one.id, label: one.name })),
  ];
  // 고른 기계가 명단에 없으면(옮긴 시작 기계를 아직 다시 들이지 않았다) 그대로 그 기계를 열고 그 창이 removed gate를 보인다.
  // 그 사실을 한 줄로 보인다.
  if (!options.some((one) => one.value === chosen)) {
    options.push({ value: chosen, label: t("machines.option.not-in-list") });
  }
  const startId = chosen;
  return (
    <li className={styles.line} data-machines-start="">
      <NamedControl
        name={t("machines.label.start")}
        labelClass={styles.lineName}
      >
        {({ label, provide }) => (
          <>
            <div className={styles.lineMain}>
              {label}
              <span className={styles.lineHelp}>
                {t("machines.note.start")}
              </span>
            </div>
            <div className={styles.lineControl}>
              {provide(
                <Select
                  options={options}
                  value={startId}
                  onValueChange={(value) =>
                    act(
                      machines.setStart(
                        value === LAST
                          ? { mode: "last" }
                          : { mode: "machine", machine: value },
                      ),
                    )
                  }
                />,
              )}
            </div>
          </>
        )}
      </NamedControl>
    </li>
  );
}
