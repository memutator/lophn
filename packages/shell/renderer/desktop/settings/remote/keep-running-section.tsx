// Settings › Remote의 "Keep running". 이 컴퓨터를 로그인 때 띄우고 창을 닫아도 계속 돌리는 표시와, 따로 켜는 "Keep this computer
// awake"를 바꾸고, OS 등록의 사실(등록됨, 못 씀, OS 설정에서 꺼짐, 쓸 수 없음)을 그대로 보인다. 폰 연결이 꺼져 있어도 보인다.
import { t } from "@lophn/i18n";
import { Switch } from "@lophn/ui/input";
import { Button } from "@lophn/ui/primitives";
import { useCallback, useEffect, useState } from "react";

import { actionIcons } from "../../../icons/mod.ts";
import styles from "../settings.module.css";
import sectionStyles from "./keep-running-section.module.css";
import type { AlwaysOnView, RemoteSettingsSource } from "./source.ts";

type LoginReason = NonNullable<AlwaysOnView["loginReason"]>;

const LOGIN_REASONS = {
  development_build: "settings.reason.development-build",
  no_service_manager: "settings.reason.no-service-manager",
  unverified_path: "settings.reason.unverified-path",
  os_failed: "settings.reason.os-failed",
} as const satisfies Record<LoginReason, string>;

const AWAKE_REASONS = {
  no_inhibitor: "settings.reason.no-inhibitor",
  os_failed: "settings.reason.os-failed",
} as const;

// OS 설정에서 꺼진 등록을 사람이 어디서 만지는지.
const OFF_WHERE = {
  launchd: "settings.note.login-off-launchd",
  windows_run: "settings.note.login-off-windows",
  systemd: "settings.note.login-off-systemd",
} as const;

export function KeepRunningSection({
  source,
  name,
}: {
  source: RemoteSettingsSource;
  /** 다른 컴퓨터의 것을 바꿀 때 그 이름. 없으면 이 컴퓨터다. */
  name?: string;
}) {
  const [view, setView] = useState<AlwaysOnView | null>(null);
  const [failed, setFailed] = useState(false);

  // core가 OS에 다시 묻는다. 열 때와 바꾼 뒤에 읽는다.
  const load = useCallback(() => {
    void source.alwaysOn().then((read) => {
      if (read.ok) setView(read.value);
    });
  }, [source]);
  useEffect(load, [load]);

  if (view === null) return null;

  async function change(input: {
    keepRunning?: boolean;
    keepAwake?: boolean;
  }): Promise<void> {
    const saved = await source.setAlwaysOn(input);
    setFailed(!saved.ok);
    if (saved.ok) setView(saved.value);
    load();
  }

  const development = view.loginReason === "development_build";
  const onOff = (on: boolean) =>
    t(on ? "settings.label.value-on" : "settings.label.value-off");
  const tryAgain = (keepRunning: boolean, label = t("common.button.retry")) => (
    <Button
      size="sm"
      icon={actionIcons.retry}
      data-keep-running-retry=""
      onClick={() => void change({ keepRunning })}
    >
      {label}
    </Button>
  );

  function fact() {
    if (development) {
      return (
        <p className={styles.lineHelp} data-keep-running-fact="development">
          {t(LOGIN_REASONS.development_build)}
        </p>
      );
    }
    if (!view!.keepRunning) {
      return view!.startAtLogin === "registered" ? (
        <div className={sectionStyles.fact} data-keep-running-fact="leftover">
          <p className={sectionStyles.warning}>
            {t("settings.warning.login-still-registered")}
          </p>
          {tryAgain(false)}
        </div>
      ) : null;
    }
    switch (view!.startAtLogin) {
      case "registered":
        return (
          <p className={styles.lineHelp} data-keep-running-fact="registered">
            {t("settings.status.starts-at-login")}
          </p>
        );
      case "not_registered":
        return (
          <div
            className={sectionStyles.fact}
            data-keep-running-fact="not-registered"
          >
            <p className={sectionStyles.warning}>
              {t("settings.warning.login-not-registered")}
            </p>
            {tryAgain(true)}
          </div>
        );
      case "off_in_system":
        return (
          <div
            className={sectionStyles.fact}
            data-keep-running-fact="off-in-system"
          >
            <p className={sectionStyles.warning}>
              {t("settings.warning.login-off-in-system")}
              {view!.mechanism === null
                ? ""
                : ` ${t(OFF_WHERE[view!.mechanism])}`}
            </p>
            {tryAgain(true, t("settings.button.turn-on-again"))}
          </div>
        );
      case "unavailable":
        return (
          <div
            className={sectionStyles.fact}
            data-keep-running-fact="unavailable"
          >
            <p className={sectionStyles.warning}>
              {t(LOGIN_REASONS[view!.loginReason ?? "os_failed"])}
            </p>
            {view!.loginReason === "os_failed" ? tryAgain(true) : null}
          </div>
        );
    }
  }

  return (
    <section
      className={`${styles.groupBlock} ${sectionStyles.section}`}
      data-keep-running-section=""
    >
      <h2 className={styles.groupTitle}>
        {t("settings.heading.keep-running")}
      </h2>
      <ul className={styles.lines}>
        <li className={styles.line} data-keep-running-row="keep-running">
          <div className={styles.lineMain}>
            <span className={styles.lineName}>
              {name === undefined
                ? t("settings.label.keep-running")
                : t("settings.label.keep-running-on", { name })}
            </span>
            <span className={styles.lineHelp}>
              {t("settings.note.keep-running")}
            </span>
            {fact()}
          </div>
          <div className={styles.endSlot}>
            <Switch
              label={onOff(view.keepRunning)}
              checked={view.keepRunning}
              disabled={development}
              onCheckedChange={(on) => void change({ keepRunning: on })}
            />
          </div>
        </li>
        <li className={styles.line} data-keep-running-row="keep-awake">
          <div className={styles.lineMain}>
            <span className={styles.lineName}>
              {name === undefined
                ? t("settings.label.keep-awake")
                : t("settings.label.keep-awake-on", { name })}
            </span>
            <span className={styles.lineHelp}>
              {t("settings.note.keep-awake")}
            </span>
            {view.keepAwake && view.awake === "unavailable" ? (
              <p
                className={sectionStyles.warning}
                data-keep-running-fact="awake-unavailable"
              >
                {t(AWAKE_REASONS[view.awakeReason ?? "os_failed"])}
              </p>
            ) : null}
          </div>
          <div className={styles.endSlot}>
            <Switch
              label={onOff(view.keepAwake)}
              checked={view.keepAwake}
              disabled={!view.keepRunning}
              onCheckedChange={(on) => void change({ keepAwake: on })}
            />
          </div>
        </li>
      </ul>
      {failed ? (
        <p className={styles.rejected} role="alert">
          {t("settings.error.value-not-saved")}
        </p>
      ) : null}
    </section>
  );
}
