// Settings › My computers. 기존 Remote와 Sync 설정을 하나로 합쳤다:
// 이 컴퓨터 이름·Keep running, 연결·Hub(`/v1/*` relay + offline custody)·port·fallback relay·OSC 52 clipboard 스위치,
// 명단의 기기 목록(Two Promises 배지, Hub 배지, "Allow controlling this computer" 스위치), 주소, 초대/합류,
// 그리고 앱 데이터 동기화 정책(`sync.app_policies`), 송수신 파일(`transfers/*`), 대기 중인 설정(`settings_export/*`), 공유 폴더.

import { t } from "@lophn/i18n";
import { StatusMark } from "@lophn/ui/feedback";
import { Input, Switch } from "@lophn/ui/input";
import { type KeyboardEvent, useCallback, useEffect, useState } from "react";

import { useStateChanged } from "../../connection/core-read.ts";
import {
  useMachinesView,
  useScopeMachineItem,
} from "../../machines/context.tsx";
import { NamedControl } from "../general/named-control.tsx";
import styles from "../settings.module.css";
import type { SyncSettingsSource, SyncStatus } from "../sync/source.ts";
import { duplicateMachineIds, SyncSections } from "../sync/sync-panel.tsx";
import { AddDevice } from "./add-device.tsx";
import { AddressesSection } from "./addresses-section.tsx";
import { KeepRunningSection } from "./keep-running-section.tsx";
import { MyDevices } from "./my-devices.tsx";
import type {
  RemoteConnectionSettings,
  RemoteDevices,
  RemoteRelayStatus,
  RemoteSettingsSource,
} from "./source.ts";
import { ThisComputer } from "./this-computer.tsx";

type Loaded<T> = T | "failed" | null;

// relay 상태는 event가 없는 memory route라 켜 있는 동안 이 간격으로 다시 읽는다.
const RELAY_POLL_MS = 5000;

// 다른 기계의 범위에서는 그 기계의 Keep running과 Hub 역할만 있다(화면 없는 기계는 가서 켤 곳이 없다).
// 연결 켜기·port·relay, 기기, pairing, 제어 허락은 이 컴퓨터의 것이다.
export function RemotePanel({
  source,
  sync,
}: {
  source: RemoteSettingsSource;
  sync?: SyncSettingsSource;
}) {
  const machine = useScopeMachineItem();
  if (machine === null) {
    return <ThisComputerMyComputers source={source} sync={sync} />;
  }
  const name =
    machine.name === "" ? t("machines.label.unknown-name") : machine.name;
  return (
    <div data-remote-settings="">
      <h1 className={styles.paneTitle}>{t("settings.label.tab-remote")}</h1>
      <KeepRunningSection source={source} name={name} />
      <OtherComputerHub source={source} name={name} />
    </div>
  );
}

function OtherComputerHub({
  source,
  name,
}: {
  source: RemoteSettingsSource;
  name: string;
}) {
  const [hub, setHub] = useState<boolean | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const load = useCallback(() => {
    void source.connectionSettings().then((read) => {
      if (read.ok) setHub(read.value.hub);
    });
  }, [source]);
  useEffect(load, [load]);
  useStateChanged(["settings"], load);

  if (hub === null) return null;

  async function choose(on: boolean): Promise<void> {
    const saved = await source.setHub(on);
    setSaveFailed(!saved.ok);
    if (saved.ok) setHub(on);
  }

  return (
    <>
      <ul className={styles.lines}>
        <HubRow
          name={t("settings.label.remote-hub-on", { name })}
          hub={hub}
          onChange={(on) => void choose(on)}
        />
      </ul>
      {saveFailed ? (
        <p className={styles.rejected} role="alert">
          {t("settings.error.value-not-saved")}
        </p>
      ) : null}
    </>
  );
}

function HubRow({
  name,
  hub,
  status,
  onChange,
}: {
  name: string;
  hub: boolean;
  /** 켜져 있을 때 이름 아래에 보일 listener 상태. */
  status?: { listening: boolean; port: number };
  onChange: (on: boolean) => void;
}) {
  return (
    <li className={styles.line} data-remote-row="hub">
      <div className={styles.lineMain}>
        <span className={styles.lineName}>{name}</span>
        <span className={styles.lineHelp}>{t("settings.note.remote-hub")}</span>
        {status === undefined ? null : (
          <span data-remote-hub-status="">
            <StatusMark
              tone={status.listening ? "good" : "neutral"}
              label={t(
                status.listening
                  ? "settings.status.remote-hub-listening"
                  : "settings.status.remote-hub-enabled",
                { port: status.port },
              )}
            />
          </span>
        )}
      </div>
      <div className={styles.endSlot}>
        <Switch
          label={t(
            hub ? "settings.label.value-on" : "settings.label.value-off",
          )}
          checked={hub}
          onCheckedChange={onChange}
        />
      </div>
    </li>
  );
}

function ThisComputerMyComputers({
  source,
  sync,
}: {
  source: RemoteSettingsSource;
  sync?: SyncSettingsSource;
}) {
  const view = useMachinesView();
  const [enabled, setEnabled] = useState<Loaded<boolean>>(null);
  const [conn, setConn] = useState<RemoteConnectionSettings | null>(null);
  const [portText, setPortText] = useState("");
  const [relayText, setRelayText] = useState("");
  const [listed, setListed] = useState<Loaded<RemoteDevices>>(null);
  const [syncStatus, setSyncStatus] = useState<Loaded<SyncStatus>>(null);
  const devices =
    listed === null || listed === "failed" ? listed : listed.devices;
  const removedAt =
    listed === null || listed === "failed" ? null : listed.removedAt;
  const [saveFailed, setSaveFailed] = useState(false);
  const [relay, setRelay] = useState<RemoteRelayStatus | null>(null);

  const loadDevices = useCallback(async () => {
    const read = await source.devices();
    setListed(read.ok ? read.value : "failed");
    return read;
  }, [source]);

  const loadSyncStatus = useCallback(() => {
    if (sync === undefined) return;
    void sync.status().then((read) => {
      setSyncStatus(read.ok ? read.value : "failed");
    });
  }, [sync]);

  const load = useCallback(() => {
    void source.enabled().then((read) => {
      setEnabled(read.ok ? read.value : "failed");
    });
    void source.connectionSettings().then((read) => {
      if (!read.ok) return;
      setConn(read.value);
      setPortText(String(read.value.port));
      setRelayText(read.value.relay);
    });
    void loadDevices();
    loadSyncStatus();
  }, [source, loadDevices, loadSyncStatus]);
  useStateChanged(
    ["settings", "remote_devices", "carry_files", "app_runtime", "apps"],
    load,
  );

  useEffect(() => {
    if (enabled !== true) {
      setRelay(null);
      return;
    }
    const read = () =>
      void source.relayStatus().then((status) => {
        setRelay(status.ok ? status.value : null);
      });
    read();
    const poll = setInterval(read, RELAY_POLL_MS);
    return () => clearInterval(poll);
  }, [source, enabled, conn?.hub, conn?.relay]);

  async function chooseEnabled(on: boolean): Promise<void> {
    const saved = await source.setEnabled(on);
    setSaveFailed(!saved.ok);
    if (!saved.ok) return;
    setEnabled(on);
  }

  async function chooseHub(on: boolean): Promise<void> {
    const saved = await source.setHub(on);
    setSaveFailed(!saved.ok);
    if (!saved.ok) return;
    setConn((prev) => (prev === null ? null : { ...prev, hub: on }));
    void loadDevices();
  }

  async function commitPort(): Promise<void> {
    if (conn === null) return;
    const parsed = Number(portText.trim());
    if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) {
      setPortText(String(conn.port));
      return;
    }
    if (parsed === conn.port) return;
    const saved = await source.setPort(parsed);
    setSaveFailed(!saved.ok);
    if (!saved.ok) {
      setPortText(String(conn.port));
      return;
    }
    setConn((prev) => (prev === null ? null : { ...prev, port: parsed }));
  }

  async function commitRelay(): Promise<void> {
    if (conn === null) return;
    const trimmed = relayText.trim().replace(/\/+$/, "");
    if (trimmed === conn.relay) {
      setRelayText(conn.relay);
      return;
    }
    const saved = await source.setRelay(trimmed);
    setSaveFailed(!saved.ok);
    if (!saved.ok) {
      setRelayText(conn.relay);
      return;
    }
    setConn((prev) => (prev === null ? null : { ...prev, relay: trimmed }));
    setRelayText(trimmed);
  }

  async function chooseOsc52(on: boolean): Promise<void> {
    const saved = await source.setOsc52Clipboard(on);
    setSaveFailed(!saved.ok);
    if (!saved.ok) return;
    setConn((prev) => (prev === null ? null : { ...prev, osc52Clipboard: on }));
  }

  const receivedByMachine = new Map(
    syncStatus === null || syncStatus === "failed"
      ? []
      : syncStatus.received.map((row) => [row.machine, row] as const),
  );
  const hubMachines = new Set<string>(
    syncStatus === null || syncStatus === "failed"
      ? []
      : (syncStatus.hubMachines ?? []),
  );
  const duplicateMachines = duplicateMachineIds(syncStatus, view);

  const onOff = (on: boolean) =>
    t(on ? "settings.label.value-on" : "settings.label.value-off");

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
                  label={onOff(enabled)}
                  checked={enabled}
                  onCheckedChange={(on) => void chooseEnabled(on)}
                />
              </div>
            </li>
            {conn === null ? null : (
              <>
                <HubRow
                  name={t("settings.label.remote-hub")}
                  hub={conn.hub}
                  status={
                    enabled && conn.hub
                      ? {
                          listening: relay?.hubListening === true,
                          port: conn.port,
                        }
                      : undefined
                  }
                  onChange={(on) => void chooseHub(on)}
                />
                <NamedControl
                  name={t("settings.label.remote-port")}
                  labelClass={styles.lineName}
                >
                  {({ label, provide }) => (
                    <li className={styles.line} data-remote-row="port">
                      <div className={styles.lineMain}>
                        {label}
                        <span className={styles.lineHelp}>
                          {t("settings.note.remote-port")}
                        </span>
                      </div>
                      <div className={styles.lineControl}>
                        {provide(
                          <Input
                            type="number"
                            min={1024}
                            max={65535}
                            step={1}
                            value={portText}
                            data-remote-port-input=""
                            onChange={(event) =>
                              setPortText(event.target.value)
                            }
                            onBlur={() => void commitPort()}
                            onKeyDown={(
                              event: KeyboardEvent<HTMLInputElement>,
                            ) => {
                              if (event.key === "Enter")
                                event.currentTarget.blur();
                            }}
                          />,
                        )}
                      </div>
                    </li>
                  )}
                </NamedControl>
                <NamedControl
                  name={t("settings.label.remote-relay")}
                  labelClass={styles.lineName}
                >
                  {({ label, provide }) => (
                    <li className={styles.line} data-remote-row="relay-url">
                      <div className={styles.lineMain}>
                        {label}
                        <span className={styles.lineHelp}>
                          {t("settings.note.remote-relay")}
                        </span>
                        {enabled && relay !== null && relay.url !== null ? (
                          <span
                            className={styles.lineHelp}
                            data-remote-relay={relay.state}
                          >
                            <StatusMark
                              tone={
                                relay.state === "connected" ? "good" : "warning"
                              }
                              label={t(
                                relay.state === "connected"
                                  ? "settings.label.remote-relay-connected"
                                  : "settings.label.remote-relay-unreachable",
                              )}
                            />
                          </span>
                        ) : null}
                      </div>
                      <div className={styles.lineControl}>
                        {provide(
                          <Input
                            placeholder={t("settings.placeholder.remote-relay")}
                            value={relayText}
                            spellCheck={false}
                            data-remote-relay-input=""
                            onChange={(event) =>
                              setRelayText(event.target.value)
                            }
                            onBlur={() => void commitRelay()}
                            onKeyDown={(
                              event: KeyboardEvent<HTMLInputElement>,
                            ) => {
                              if (event.key === "Enter")
                                event.currentTarget.blur();
                            }}
                          />,
                        )}
                      </div>
                    </li>
                  )}
                </NamedControl>
                <li className={styles.line} data-remote-row="osc52-clipboard">
                  <div className={styles.lineMain}>
                    <span className={styles.lineName}>
                      {t("settings.label.terminal-osc52")}
                    </span>
                    <span className={styles.lineHelp}>
                      {t("settings.note.terminal-osc52")}
                    </span>
                  </div>
                  <div className={styles.endSlot}>
                    <Switch
                      label={onOff(conn.osc52Clipboard)}
                      checked={conn.osc52Clipboard}
                      onCheckedChange={(on) => void chooseOsc52(on)}
                    />
                  </div>
                </li>
              </>
            )}
          </ul>
          {saveFailed ? (
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
                  receivedByMachine={receivedByMachine}
                  hubMachines={hubMachines}
                  duplicateMachines={duplicateMachines}
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
      {sync === undefined ? null : (
        <SyncSections
          source={sync}
          status={syncStatus}
          onReloadStatus={loadSyncStatus}
          devices={devices}
        />
      )}
    </div>
  );
}
