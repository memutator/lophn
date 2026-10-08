// settings의 OS notification 자리(shell#T58). opt-in 설정 값만 저장하고 보인다. 실제 OS
// notification은 이 자리가 보내지 않는다(shell#T56은 표시 경로다). 값은 settings read·apply로
// 저장되고, 기본(꺼짐)·바뀐 출처는 설정 값의 정의를 따른다.
import { useCallback, useState } from "react";
import {
  ErrorState,
  Loading,
  Skeleton,
  Switch,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import type { NotificationsSource, NotificationsView } from "./source.ts";
import { useReload } from "../use-reload.ts";
import styles from "../settings.module.css";

export interface NotificationsPanelProps {
  source: NotificationsSource;
}

type Loaded =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly view: NotificationsView };

type Notice = "saved" | "failed" | "stale" | null;

export function NotificationsPanel({ source }: NotificationsPanelProps) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [notice, setNotice] = useState<Notice>(null);

  const load = useCallback(() => {
    void (async () => {
      const read = await source.notifications();
      if (!read.ok) {
        setLoaded({ state: "failed" });
        return;
      }
      setLoaded({ state: "ready", view: read.value });
    })();
  }, [source]);
  useReload(source, load);

  async function change(enabled: boolean): Promise<void> {
    if (loaded.state !== "ready") return;
    const was = loaded.view;
    setNotice(null);
    const saved = await source.setNotifications(was, enabled);
    if (saved.ok) {
      setNotice("saved");
      setLoaded({ state: "ready", view: { ...was, enabled } });
      return;
    }
    setNotice(saved.code === "conflict" ? "stale" : "failed");
    if (saved.code === "conflict") load();
  }

  const enabled = loaded.state === "ready"
    ? loaded.view.enabled === true
    : false;
  return (
    <Loading
      loading={loaded.state === "loading"}
      placeholder={<Skeleton lines={2} />}
    >
      {loaded.state === "failed"
        ? (
          <ErrorState
            target={t("settings.label.notifications-target")}
            onRetry={() => {
              setLoaded({ state: "loading" });
              load();
            }}
          />
        )
        : (
          <div className={styles.groups} data-notifications="">
            <section className={styles.section}>
              <h2 className={styles.heading}>
                {t("settings.notifications.heading")}
              </h2>
              <p className={styles.text}>{t("settings.notifications.intro")}</p>
              <div
                className={styles.row}
                data-notifications-row=""
                data-action="os-notifications"
              >
                <span className={styles.rowText}>
                  <span className={styles.subheading}>
                    {t("settings.notifications.label")}
                  </span>
                  <p className={styles.muted}>
                    {t("settings.notifications.help")}
                  </p>
                </span>
                <Switch
                  label={t("settings.notifications.label")}
                  checked={enabled}
                  disabled={loaded.state !== "ready"}
                  onCheckedChange={(value) => void change(value)}
                />
              </div>
              {notice === null ? null : (
                <p
                  className={styles.notice}
                  role="status"
                  data-notice={notice}
                >
                  {notice === "saved"
                    ? t("settings.notifications.changed")
                    : notice === "stale"
                    ? t("settings.error.changed")
                    : t("settings.notifications.changed-failed")}
                </p>
              )}
            </section>
          </div>
        )}
    </Loading>
  );
}
