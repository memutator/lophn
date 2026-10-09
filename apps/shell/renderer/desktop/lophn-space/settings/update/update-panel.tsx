// settings의 update 자리(shell#T58, platform#T50에서 넘어온 것). 새 version·지원 OS·schema
// 호환·정상 정지·재시작 필요만 보인다. 자동 다운로드·재시작은 없다. 설치 파일 교체는
// 화면에 보이지 않는다.
import { useCallback, useState } from "react";
import { Button, Skeleton } from "@lophn/design/components";
import { t } from "@lophn/wording";

import type { UpdatePackageView, UpdateSource } from "./source.ts";
import { useReload } from "../use-reload.ts";
import styles from "../settings.module.css";

export interface UpdatePanelProps {
  source: UpdateSource;
}

type Loaded =
  | { readonly state: "idle" }
  | { readonly state: "reading" }
  | { readonly state: "ready"; readonly candidate: UpdatePackageView }
  | { readonly state: "unreadable" };

type StopState = "idle" | "stopping" | "stopped" | "failed";

/** notice 결과를 준비한다. 실패는 OS 불일치와 다른 오류를 구별한다. */
export function UpdatePanel({ source }: UpdatePanelProps) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "idle" });
  const [notice, setNotice] = useState<
    | { readonly state: "idle" }
    | {
      readonly state: "ready";
      readonly version: string;
      readonly current: string;
      readonly os: string;
      readonly schema: string;
      readonly restart: boolean;
    }
    | { readonly state: "failed"; readonly mismatch: boolean }
  >({ state: "idle" });
  const [stop, setStop] = useState<StopState>("idle");

  const load = useCallback(() => {}, [source]);
  useReload(source, load);

  async function choose(): Promise<void> {
    setLoaded({ state: "reading" });
    const picked = await source.choosePackage();
    if (!picked.ok) {
      setLoaded({ state: "unreadable" });
      return;
    }
    if (picked.value === null) {
      setLoaded({ state: "idle" });
      return;
    }
    const candidate = picked.value;
    setLoaded({ state: "ready", candidate });
    const read = await source.notice(candidate);
    if (read.state !== "ready") {
      // notice가 이 OS가 아닌 package를 거절했다(mismatch)거나 다른 오류다.
      setNotice({
        state: "failed",
        mismatch: "mismatch" in read,
      });
      return;
    }
    setNotice({
      state: "ready",
      version: read.newVersion,
      current: read.currentVersion,
      os: read.os,
      schema: read.schema,
      restart: read.restartRequired,
    });
  }

  async function stopNow(): Promise<void> {
    setStop("stopping");
    const result = await source.stopForUpdate();
    setStop(result.ok && result.value ? "stopped" : "failed");
  }

  const candidate = loaded.state === "ready" ? loaded.candidate : null;
  const known = notice.state === "ready" ? notice : null;
  return (
    <div className={styles.groups} data-update="">
      <section className={styles.section}>
        <h2 className={styles.heading}>{t("settings.update.heading")}</h2>
        <p className={styles.text}>{t("settings.update.intro")}</p>
        {loaded.state === "idle" && (
          <p className={styles.muted} data-package="none">
            {t("settings.update.no-package")}
          </p>
        )}
        {loaded.state === "unreadable" && (
          <p className={styles.state} data-package="unreadable">
            {t("settings.update.package-unreadable")}
          </p>
        )}
        {notice.state === "failed" && (
          <p className={styles.state} data-notice="mismatch">
            {notice.mismatch
              ? t("settings.update.system-mismatch")
              : t("settings.update.package-unreadable")}
          </p>
        )}
        {candidate !== null && known !== null && (
          <div data-notice="ready">
            <p className={styles.text} data-update-version="">
              {t("settings.update.new-version", {
                version: known.version,
                os: known.os,
                current: known.current,
              })}
            </p>
            <p className={styles.text} data-update-schema="">
              {known.schema === "compatible"
                ? t("settings.update.schema-compatible")
                : known.schema === "migration_required"
                ? t("settings.update.schema-migration")
                : t("settings.update.schema-newer")}
            </p>
            {known.restart && (
              <p className={styles.muted} data-update-restart="">
                {t("settings.update.restart-required")}
              </p>
            )}
          </div>
        )}
        <div className={styles.actions}>
          <Button
            size="sm"
            variant="secondary"
            data-action="choose-package"
            disabled={loaded.state === "reading"}
            onClick={() => void choose()}
          >
            {t("settings.button.choose-package")}
          </Button>
          {stop !== "stopped" && candidate !== null && (
            <Button
              size="sm"
              data-action="stop-and-update"
              disabled={stop === "stopping"}
              onClick={() => void stopNow()}
            >
              {t("settings.button.stop-and-update")}
            </Button>
          )}
        </div>
        {stop === "stopping" && (
          <p className={styles.notice} data-stop="stopping">
            <Skeleton lines={1} />
          </p>
        )}
        {stop === "stopped" && (
          <p className={styles.notice} data-stop="stopped">
            {t("settings.update.stopped")}
          </p>
        )}
        {stop === "failed" && (
          <p className={styles.notice} data-stop="failed">
            {t("settings.update.stop-failed")}
          </p>
        )}
        <p className={styles.muted} data-deployment="">
          {t("settings.update.deployment-unverified")}
        </p>
      </section>
    </div>
  );
}
