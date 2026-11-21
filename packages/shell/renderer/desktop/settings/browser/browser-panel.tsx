// Settings › Browser. bookmark 목록을 고치고, browser profile을 만들고 지우고, profile마다 site login을 관리하고,
// preview 탭이 흉내 낼 기기를 등록하고, profile 하나의 cookie, site data, cache를 지운다(Browsing data 구역은 기본 profile이다).
import { useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { Dialog, Toast } from "@lophn/ui/overlay";
import { t } from "@lophn/i18n";
import { actionIcons } from "../../../icons/mod.ts";

import styles from "../settings.module.css";
import { BookmarkRows } from "./bookmark-rows.tsx";
import { DeviceRows } from "./device-rows.tsx";
import { LinkRows } from "./link-rows.tsx";
import { LoginRows } from "./login-rows.tsx";
import { ProfileRows } from "./profile-rows.tsx";
import type { BrowserProfile, BrowserSettingsSource } from "./source.ts";

interface BrowserPanelProps {
  source: BrowserSettingsSource;
}

export function BrowserPanel({ source }: BrowserPanelProps) {
  // 지울 profile. null은 확인 창이 닫혀 있다는 뜻이고 `{ profile: null }`은 기본 profile이다.
  const [confirming, setConfirming] = useState<{
    profile: BrowserProfile | null;
  } | null>(null);
  const [result, setResult] = useState<"cleared" | "failed" | null>(null);

  async function clear(profile: BrowserProfile | null): Promise<void> {
    setConfirming(null);
    const cleared = await source.clearData(profile?.id ?? null);
    setResult(cleared.ok ? "cleared" : "failed");
  }

  return (
    <div data-browser-settings="">
      {result === null ? null : (
        <div className={styles.toastSlot} data-browser-clear-result={result}>
          <Toast
            title={
              result === "cleared"
                ? t("settings.notice.browser-cleared")
                : t("settings.error.browser-clear-failed")
            }
            tone={result === "cleared" ? "neutral" : "error"}
            duration="brief"
            onClose={() => setResult(null)}
          />
        </div>
      )}
      <h1 className={styles.paneTitle}>{t("settings.label.tab-browser")}</h1>
      <section>
        <h2 className={styles.groupTitle}>{t("settings.heading.bookmarks")}</h2>
        <BookmarkRows source={source} />
      </section>
      <section className={styles.groupBlock}>
        <h2 className={styles.groupTitle}>{t("settings.heading.links")}</h2>
        <LinkRows source={source} />
      </section>
      <section className={styles.groupBlock}>
        <h2 className={styles.groupTitle}>{t("settings.heading.profiles")}</h2>
        <p className={styles.lineHelp}>{t("settings.note.profiles")}</p>
        <ProfileRows
          source={source}
          onClear={(profile) => setConfirming({ profile })}
        />
      </section>
      <section className={styles.groupBlock}>
        <h2 className={styles.groupTitle}>{t("settings.heading.logins")}</h2>
        <p className={styles.lineHelp}>{t("settings.note.logins")}</p>
        <LoginRows source={source} />
      </section>
      <section className={styles.groupBlock}>
        <h2 className={styles.groupTitle}>{t("settings.heading.devices")}</h2>
        <p className={styles.lineHelp}>{t("settings.note.devices")}</p>
        <DeviceRows source={source} />
      </section>
      <section className={styles.groupBlock}>
        <h2 className={styles.groupTitle}>
          {t("settings.heading.browser-data")}
        </h2>
        <ul className={styles.lines}>
          <li className={styles.line}>
            <div className={styles.lineMain}>
              <span className={styles.lineHelp}>
                {t("settings.note.browser-clear")}
              </span>
            </div>
            <div className={styles.lineControl}>
              <Button
                variant="secondary"
                icon={actionIcons.delete}
                data-browser-clear=""
                onClick={() => setConfirming({ profile: null })}
              >
                {t("settings.button.browser-clear")}
              </Button>
            </div>
          </li>
        </ul>
      </section>
      <Dialog
        open={confirming !== null}
        onOpenChange={(next) => (next ? undefined : setConfirming(null))}
        title={
          confirming?.profile == null
            ? t("settings.title.browser-clear")
            : t("settings.title.profile-clear", {
                name: confirming.profile.name,
              })
        }
        actions={
          <>
            <Button onClick={() => setConfirming(null)}>
              {t("settings.button.cancel")}
            </Button>
            <Button
              variant="danger"
              icon={actionIcons.delete}
              data-browser-clear-confirm=""
              onClick={() => void clear(confirming!.profile)}
            >
              {t("settings.button.browser-clear-confirm")}
            </Button>
          </>
        }
      >
        {confirming?.profile == null
          ? t("settings.note.browser-clear-confirm")
          : t("settings.note.profile-clear-confirm")}
      </Dialog>
    </div>
  );
}
