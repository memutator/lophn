// Settings › Remote의 Phones 구역. pairing한 기기마다 이름, OS, 마지막 연결, 기준 표시, 터미널 입력 스위치와
// [Rename]·[Make primary](폰만)·[Unpair]다. 끊으면 그 폰은 다시 pairing해야 붙으므로 먼저 한 번 묻는다. 터미널 입력은 그 줄에서
// 바로 되돌릴 수 있어 켤 때 묻지 않는다.
import { useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { Field, Input, Switch } from "@lophn/ui/input";
import { Dialog } from "@lophn/ui/overlay";
import { formatRelativeTime, t } from "@lophn/i18n";

import { actionIcons } from "../../../icons/mod.ts";
import styles from "../settings.module.css";
import type {
  RemoteDevice,
  RemoteSettingsSource,
  SourceResult,
} from "./source.ts";

interface RemoteDeviceRowsProps {
  source: RemoteSettingsSource;
  devices: readonly RemoteDevice[] | "failed" | null;
  /** 바꾼 뒤 목록을 다시 읽는다. */
  reload: () => void;
}

const OS_LABEL = {
  ios: "settings.label.device-ios",
  android: "settings.label.device-android",
  linux: "settings.label.device-linux",
  macos: "settings.label.device-macos",
  windows: "settings.label.device-windows",
} as const;

function detailText(device: RemoteDevice): string {
  const os = t(OS_LABEL[device.os]);
  const platform =
    device.kind === "desktop"
      ? `${t("settings.label.device-kind-desktop")} · ${os}`
      : os;
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

export function RemoteDeviceRows({
  source,
  devices,
  reload,
}: RemoteDeviceRowsProps) {
  const [renaming, setRenaming] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [revoking, setRevoking] = useState<RemoteDevice | null>(null);
  const [failed, setFailed] = useState(false);

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

  async function act(run: Promise<SourceResult<null>>): Promise<boolean> {
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

  async function resetName(device: RemoteDevice): Promise<void> {
    if (await act(source.rename(device.id, null))) setRenaming(null);
  }

  async function revoke(device: RemoteDevice): Promise<void> {
    setRevoking(null);
    await act(source.revoke(device.id));
  }

  return (
    <>
      <ul className={styles.lines} data-remote-devices="ok">
        {devices.map((device) =>
          renaming?.id === device.id ? (
            <li
              key={device.id}
              className={styles.line}
              data-remote-device-form=""
            >
              <div className={styles.lineMain}>
                <Field label={t("settings.label.remote-device-name")}>
                  <Input
                    value={renaming.name}
                    placeholder={device.announcedName}
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
                  {device.alias === null ? null : (
                    <Button
                      icon={actionIcons.reset}
                      data-remote-name-reset=""
                      onClick={() => void resetName(device)}
                    >
                      {t("settings.button.device-name-reset")}
                    </Button>
                  )}
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
          ) : (
            <li
              key={device.id}
              className={styles.line}
              data-remote-device={device.id}
            >
              <div className={styles.lineMain}>
                <span className={styles.productName}>
                  {device.name}
                  {device.primary ? (
                    <span className={styles.caption}>
                      {t("settings.label.remote-primary")}
                    </span>
                  ) : null}
                </span>
                {device.alias !== null &&
                device.alias !== device.announcedName ? (
                  <span className={styles.caption} data-remote-announced="">
                    {t("settings.label.device-announced-name", {
                      name: device.announcedName,
                    })}
                  </span>
                ) : null}
                <span className={styles.lineHelp}>{detailText(device)}</span>
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
                    {t("settings.note.remote-terminal-input")}
                  </p>
                </div>
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
                    icon={actionIcons.disconnect}
                    data-remote-revoke=""
                    onClick={() => setRevoking(device)}
                  >
                    {t("settings.button.remote-revoke")}
                  </Button>
                </div>
              </div>
            </li>
          ),
        )}
      </ul>
      {failed ? (
        <p className={styles.rejected} role="alert">
          {t("settings.error.remote-device-failed")}
        </p>
      ) : null}
      <Dialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
        title={t("settings.title.remote-revoke", {
          name: revoking?.name ?? "",
        })}
        actions={
          <>
            <Button onClick={() => setRevoking(null)}>
              {t("settings.button.cancel")}
            </Button>
            <Button
              variant="danger"
              icon={actionIcons.disconnect}
              data-remote-revoke-confirm=""
              onClick={() => revoking && void revoke(revoking)}
            >
              {t("settings.button.remote-revoke")}
            </Button>
          </>
        }
      >
        {t("settings.note.remote-revoke", { name: revoking?.name ?? "" })}
      </Dialog>
    </>
  );
}
