// Settings › Browser. browser 탭의 cookie, site data, cache를 한 번에 지운다.
import { useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { Dialog, Toast } from "@lophn/ui/overlay";
import { t } from "@lophn/wording";

import styles from "../settings.module.css";
import type { BrowserSettingsSource } from "./source.ts";

interface BrowserPanelProps {
  source: BrowserSettingsSource;
}

export function BrowserPanel({ source }: BrowserPanelProps) {
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<"cleared" | "failed" | null>(null);

  async function clear(): Promise<void> {
    setConfirming(false);
    const cleared = await source.clearData();
    setResult(cleared.ok ? "cleared" : "failed");
  }

  return (
    <div data-browser-settings="">
      {result === null
        ? null
        : (
          <div className={styles.toastSlot} data-browser-clear-result={result}>
            <Toast
              title={result === "cleared"
                ? t("settings.notice.browser-cleared")
                : t("settings.error.browser-clear-failed")}
              tone={result === "cleared" ? "neutral" : "error"}
              duration="brief"
              onClose={() => setResult(null)}
            />
          </div>
        )}
      <h1 className={styles.paneTitle}>{t("settings.label.tab-browser")}</h1>
      <section>
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
                data-browser-clear=""
                onClick={() => setConfirming(true)}
              >
                {t("settings.button.browser-clear")}
              </Button>
            </div>
          </li>
        </ul>
      </section>
      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("settings.title.browser-clear")}
        actions={
          <>
            <Button onClick={() => setConfirming(false)}>
              {t("settings.button.cancel")}
            </Button>
            <Button
              variant="primary"
              data-browser-clear-confirm=""
              onClick={() => void clear()}
            >
              {t("settings.button.browser-clear-confirm")}
            </Button>
          </>
        }
      >
        {t("settings.note.browser-clear-confirm")}
      </Dialog>
    </div>
  );
}
