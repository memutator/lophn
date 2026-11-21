// Settings › Remote. 폰과 다른 컴퓨터의 연결(`remote.enabled`)을 켜고, 내 기기 명단(My devices)을 보고 고치고, 초대장으로 기기를
// 들이거나 이 컴퓨터가 다른 컴퓨터의 명단에 든다(Add a device). 명단이 바뀌면(`remote_devices`) 목록을 다시 읽는다.

import { t } from "@lophn/i18n";
import { Switch } from "@lophn/ui/input";
import { useCallback, useEffect, useState } from "react";

import { useStateChanged } from "../../connection/core-read.ts";
import { useScopeMachineItem } from "../../machines/context.tsx";
import styles from "../settings.module.css";
import { AddDevice } from "./add-device.tsx";
import { AddressesSection } from "./addresses-section.tsx";
import { KeepRunningSection } from "./keep-running-section.tsx";
import { MyDevices } from "./my-devices.tsx";
import type {
  RemoteDevices,
  RemoteRelayStatus,
  RemoteSettingsSource,
} from "./source.ts";
import { ThisComputer } from "./this-computer.tsx";

type Loaded<T> = T | "failed" | null;

// relay 상태는 event가 없는 memory route라 켜 있는 동안 이 간격으로 다시 읽는다.
const RELAY_POLL_MS = 5000;

// 다른 기계의 범위에서는 그 기계의 Keep running만 있다. 기기, pairing, 터미널 입력 허락은 이 컴퓨터의 것이다.
export function RemotePanel({ source }: { source: RemoteSettingsSource }) {
  const machine = useScopeMachineItem();
  if (machine === null) return <ThisComputerRemote source={source} />;
  return (
    <div data-remote-settings="">
      <h1 className={styles.paneTitle}>{t("settings.label.tab-remote")}</h1>
      <KeepRunningSection
        source={source}
        name={
          machine.name === "" ? t("machines.label.unknown-name") : machine.name
        }
      />
    </div>
  );
}

function ThisComputerRemote({ source }: { source: RemoteSettingsSource }) {
  const [enabled, setEnabled] = useState<Loaded<boolean>>(null);
  const [listed, setListed] = useState<Loaded<RemoteDevices>>(null);
  const devices =
    listed === null || listed === "failed" ? listed : listed.devices;
  const removedAt =
    listed === null || listed === "failed" ? null : listed.removedAt;
  const [toggleFailed, setToggleFailed] = useState(false);
  const [relay, setRelay] = useState<RemoteRelayStatus | null>(null);

  const loadDevices = useCallback(async () => {
    const read = await source.devices();
    setListed(read.ok ? read.value : "failed");
    return read;
  }, [source]);

  const load = useCallback(() => {
    void source.enabled().then((read) => {
      setEnabled(read.ok ? read.value : "failed");
    });
    void loadDevices();
  }, [source, loadDevices]);
  useStateChanged(["settings", "remote_devices"], load);

  useEffect(() => {
    if (enabled !== true) return;
    const read = () =>
      void source.relayStatus().then((status) => {
        setRelay(status.ok ? status.value : null);
      });
    read();
    const poll = setInterval(read, RELAY_POLL_MS);
    return () => clearInterval(poll);
  }, [source, enabled]);

  async function choose(on: boolean): Promise<void> {
    const saved = await source.setEnabled(on);
    setToggleFailed(!saved.ok);
    if (!saved.ok) return;
    setEnabled(on);
  }

  return (
    <div data-remote-settings="">
      <h1 className={styles.paneTitle}>{t("settings.label.tab-remote")}</h1>
      <p className={styles.lead}>{t("settings.intro.remote")}</p>
      <ThisComputer
        source={source}
        devices={devices}
        onRenamed={() => void loadDevices()}
      />
      <KeepRunningSection source={source} />
      {enabled === null ? null : enabled === "failed" ? (
        <p className={styles.notice} data-remote="failed">
          {t("settings.error.remote-load-failed")}
        </p>
      ) : (
        <>
          <ul className={styles.lines}>
            <li className={styles.line} data-remote-row="enabled">
              <div className={styles.lineMain}>
                <span className={styles.lineName}>
                  {t("settings.label.remote-enabled")}
                </span>
                <span className={styles.lineHelp}>
                  {t("settings.note.remote-enabled")}
                </span>
              </div>
              <div className={styles.endSlot}>
                <Switch
                  label={t(
                    enabled
                      ? "settings.label.value-on"
                      : "settings.label.value-off",
                  )}
                  checked={enabled}
                  onCheckedChange={(on) => void choose(on)}
                />
              </div>
            </li>
            {enabled && relay !== null && relay.url !== null ? (
              <li className={styles.line} data-remote-row="relay">
                <div className={styles.lineMain}>
                  <span
                    className={styles.lineName}
                    data-remote-relay={relay.state}
                  >
                    {t(
                      relay.state === "connected"
                        ? "settings.label.remote-relay-connected"
                        : "settings.label.remote-relay-unreachable",
                    )}
                  </span>
                  <span className={styles.lineHelp}>{relay.url}</span>
                </div>
              </li>
            ) : null}
          </ul>
          {toggleFailed ? (
            <p className={styles.rejected} role="alert">
              {t("settings.error.value-not-saved")}
            </p>
          ) : null}
          {enabled ? (
            <>
              <section className={styles.groupBlock}>
                <h2 className={styles.groupTitle}>
                  {t("settings.heading.remote-devices")}
                </h2>
                <MyDevices
                  source={source}
                  devices={devices}
                  removedAt={removedAt}
                  reload={() => void loadDevices()}
                />
              </section>
              <section className={styles.groupBlock}>
                <h2 className={styles.groupTitle}>
                  {t("settings.heading.remote-addresses")}
                </h2>
                <AddressesSection source={source} />
              </section>
              <section className={styles.groupBlock}>
                <h2 className={styles.groupTitle}>
                  {t("settings.heading.remote-add")}
                </h2>
                <AddDevice
                  source={source}
                  devices={devices}
                  removedAt={removedAt}
                  reload={loadDevices}
                />
              </section>
            </>
          ) : (
            <p
              className={`${styles.lineHelp} ${styles.groupBlock}`}
              data-remote="off"
            >
              {t("settings.notice.remote-off")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
