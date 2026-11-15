// Settings › Remote. 폰 연결(`remote.enabled`)을 켜고, QR로 폰을 pairing하고, pairing한 폰을 관리한다.
// 기기가 바뀌면(`remote_devices`) 목록을 다시 읽고, QR이 보이는 동안 새 폰이 보이면 QR을 닫는다.

import { t } from "@lophn/i18n";
import { Switch } from "@lophn/ui/input";
import { Toast } from "@lophn/ui/overlay";
import { Button, CopyButton } from "@lophn/ui/primitives";
import { systemClipboard } from "@lophn/ui/shared";
import { useCallback, useEffect, useState } from "react";

import { actionIcons, modalityIcons } from "../../../icons/mod.ts";
import { useStateChanged } from "../../connection/core-read.ts";
import styles from "../settings.module.css";
import { RemoteDeviceRows } from "./device-rows.tsx";
import { QrCode } from "./qr-code.tsx";
import remoteStyles from "./remote.module.css";
import type {
  RemoteDevice,
  RemotePairingCode,
  RemoteRelayStatus,
  RemoteSettingsSource,
} from "./source.ts";

type Loaded<T> = T | "failed" | null;

type Pairing =
  | { readonly state: "idle" }
  // 켠 직후에는 core가 listener를 여는 중이라 code를 못 만든다(`unavailable`). 그동안 기다리며 다시 부른다.
  | { readonly state: "starting" }
  | { readonly state: "failed" }
  | {
      readonly state: "shown";
      readonly code: RemotePairingCode;
      /** code를 만들 때 있던 기기. 이 밖의 기기가 보이면 pairing이 끝난 것이다. */
      readonly known: ReadonlySet<string>;
    };

const START_TRIES = 5;
// relay 상태는 event가 없는 memory route라 켜 있는 동안 이 간격으로 다시 읽는다.
const RELAY_POLL_MS = 5000;
const START_WAIT_MS = 1000;

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function remainingText(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function RemotePanel({ source }: { source: RemoteSettingsSource }) {
  const [enabled, setEnabled] = useState<Loaded<boolean>>(null);
  const [devices, setDevices] = useState<Loaded<readonly RemoteDevice[]>>(null);
  const [pairing, setPairing] = useState<Pairing>({ state: "idle" });
  const [now, setNow] = useState(() => Date.now());
  const [paired, setPaired] = useState<string | null>(null);
  const [toggleFailed, setToggleFailed] = useState(false);
  const [relay, setRelay] = useState<RemoteRelayStatus | null>(null);
  // 카메라를 못 쓰는 폰은 QR에 든 글을 붙여 넣는다. 한 번 펼치면 새 code에도 펼친 채다.
  const [asText, setAsText] = useState(false);

  const loadDevices = useCallback(async () => {
    const read = await source.devices();
    setDevices(read.ok ? read.value : "failed");
    return read;
  }, [source]);

  const load = useCallback(() => {
    void source.enabled().then((read) => {
      setEnabled(read.ok ? read.value : "failed");
      if (read.ok && !read.value) setPairing({ state: "idle" });
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

  // QR이 보이는 동안 남은 시간을 1초마다 센다.
  useEffect(() => {
    if (pairing.state !== "shown") return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [pairing]);

  // QR이 보이는 동안 다시 읽은 목록에 새 기기가 있으면 pairing이 끝난 것이다.
  useEffect(() => {
    if (pairing.state !== "shown" || devices === null || devices === "failed")
      return;
    const fresh = devices.find((one) => !pairing.known.has(one.id));
    if (fresh === undefined) return;
    setPairing({ state: "idle" });
    setPaired(fresh.name);
  }, [pairing, devices]);

  async function choose(on: boolean): Promise<void> {
    const saved = await source.setEnabled(on);
    setToggleFailed(!saved.ok);
    if (!saved.ok) return;
    setEnabled(on);
    if (!on) setPairing({ state: "idle" });
  }

  async function startPairing(): Promise<void> {
    setPairing({ state: "starting" });
    const before = await loadDevices();
    const known = new Set(before.ok ? before.value.map((one) => one.id) : []);
    for (let attempt = 1; attempt <= START_TRIES; attempt += 1) {
      const started = await source.startPairing();
      if (started.ok) {
        setNow(Date.now());
        setPairing({ state: "shown", code: started.value, known });
        return;
      }
      if (started.code !== "unavailable" || attempt === START_TRIES) break;
      await delay(START_WAIT_MS);
    }
    setPairing({ state: "failed" });
  }

  return (
    <div data-remote-settings="">
      {paired === null ? null : (
        <div className={styles.toastSlot} data-remote-paired="">
          <Toast
            title={t("settings.notice.remote-paired", { name: paired })}
            duration="brief"
            onClose={() => setPaired(null)}
          />
        </div>
      )}
      <h1 className={styles.paneTitle}>{t("settings.label.tab-remote")}</h1>
      <p className={styles.lead}>{t("settings.intro.remote")}</p>
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
                  {t("settings.heading.remote-pair")}
                </h2>
                <ul className={styles.lines}>{pairingLine()}</ul>
              </section>
              <section className={styles.groupBlock}>
                <h2 className={styles.groupTitle}>
                  {t("settings.heading.remote-devices")}
                </h2>
                <RemoteDeviceRows
                  source={source}
                  devices={devices}
                  reload={() => void loadDevices()}
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

  function pairingLine() {
    switch (pairing.state) {
      case "idle":
        return (
          <li className={styles.line} data-remote-pairing="idle">
            <div className={styles.lineMain}>
              <span className={styles.lineHelp}>
                {t("settings.note.remote-pair")}
              </span>
            </div>
            <div className={styles.lineControl}>
              <Button
                icon={actionIcons.add}
                data-remote-pair=""
                onClick={() => void startPairing()}
              >
                {t("settings.button.remote-pair")}
              </Button>
            </div>
          </li>
        );
      case "starting":
        return (
          <li className={styles.line} data-remote-pairing="starting">
            <div className={styles.lineMain}>
              <span className={styles.lineHelp}>
                {t("settings.notice.remote-starting")}
              </span>
            </div>
          </li>
        );
      case "failed":
        return (
          <li className={styles.line} data-remote-pairing="failed">
            <div className={styles.lineMain}>
              <p className={styles.rejected} role="alert">
                {t("settings.error.remote-pair-failed")}
              </p>
            </div>
            <div className={styles.lineControl}>
              <Button
                icon={actionIcons.retry}
                onClick={() => void startPairing()}
              >
                {t("common.button.retry")}
              </Button>
            </div>
          </li>
        );
      case "shown": {
        const left = Date.parse(pairing.code.expiresAt) - now;
        return (
          <li className={styles.line} data-remote-pairing="shown">
            <div className={styles.lineMain}>
              {left > 0 ? (
                <>
                  <QrCode
                    text={pairing.code.qr}
                    label={t("settings.label.remote-qr")}
                  />
                  <span className={styles.lineName}>
                    {t("settings.label.remote-expires", {
                      time: remainingText(left),
                    })}
                  </span>
                  <span className={styles.lineHelp}>
                    {t("settings.note.remote-scan")}
                  </span>
                  {asText ? (
                    <div className={remoteStyles.asText}>
                      <code className={remoteStyles.text} data-remote-text="">
                        {pairing.code.qr}
                      </code>
                      <CopyButton
                        text={pairing.code.qr}
                        label={t("common.button.copy")}
                        clipboard={systemClipboard}
                      />
                    </div>
                  ) : (
                    <div>
                      <Button
                        size="sm"
                        icon={modalityIcons.text}
                        data-remote-show-text=""
                        onClick={() => setAsText(true)}
                      >
                        {t("settings.button.remote-show-text")}
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <span className={styles.notice} data-remote-expired="">
                  {t("settings.notice.remote-expired")}
                </span>
              )}
            </div>
            <div className={styles.lineControl}>
              <div className={styles.actions}>
                <Button onClick={() => setPairing({ state: "idle" })}>
                  {t("settings.button.cancel")}
                </Button>
                <Button
                  icon={actionIcons.refresh}
                  data-remote-new-code=""
                  onClick={() => void startPairing()}
                >
                  {t("settings.button.remote-new-code")}
                </Button>
              </div>
            </div>
          </li>
        );
      }
    }
  }
}
