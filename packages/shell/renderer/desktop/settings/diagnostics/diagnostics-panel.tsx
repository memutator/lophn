// Settings › Diagnostics. 구성 요소마다 지금 쓸 수 있는지, 안전한 불가 이유, 실제로 점검한 시각을 보인다.
// 사람이 [Run checks]를 누를 때만 점검한다. 보안 점검은 없다.
import { useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { Skeleton, StatusMark } from "@lophn/ui/feedback";
import { t } from "@lophn/i18n";

import { actionIcons } from "../../../icons/mod.ts";
import styles from "../settings.module.css";
import { clockText, componentName } from "./model.ts";
import type { DiagnosticsSource, DiagnosticsView } from "./source.ts";

interface DiagnosticsPanelProps {
  source: DiagnosticsSource;
}

type Loaded =
  | { readonly state: "idle" }
  | { readonly state: "checking"; readonly view: DiagnosticsView | null }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly view: DiagnosticsView };

export function DiagnosticsPanel({ source }: DiagnosticsPanelProps) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "idle" });

  async function check(): Promise<void> {
    setLoaded({
      state: "checking",
      view: loaded.state === "ready" ? loaded.view : null,
    });
    const read = await source.check();
    setLoaded(
      read.ok ? { state: "ready", view: read.value } : { state: "failed" },
    );
  }

  const view =
    loaded.state === "ready" || loaded.state === "checking"
      ? loaded.view
      : null;
  return (
    <div data-diagnostics="">
      <h1 className={styles.paneTitle}>
        {t("settings.label.tab-diagnostics")}
      </h1>
      <p className={styles.lead}>{t("settings.intro.diagnostics")}</p>
      <div className={styles.toolbar}>
        <span className={styles.lineHelp} data-checked="">
          {view === null
            ? t("settings.diagnostics.not-run")
            : t("settings.diagnostics.last-run", {
                time: clockText(view.checkedAt),
              })}
        </span>
        <Button
          icon={actionIcons.run}
          data-action="check"
          disabled={loaded.state === "checking"}
          onClick={() => void check()}
        >
          {t("settings.button.run-checks")}
        </Button>
      </div>
      {loaded.state === "failed" ? (
        <p className={styles.rejected} role="alert" data-check="failed">
          {t("settings.diagnostics.check-failed")}
        </p>
      ) : null}
      {loaded.state === "checking" && view === null ? (
        <Skeleton lines={4} />
      ) : null}
      {view === null ? null : (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t("settings.label.component")}</th>
                <th scope="col">{t("settings.label.available")}</th>
                <th scope="col">{t("settings.label.reason")}</th>
                <th scope="col">{t("settings.label.checked-at")}</th>
              </tr>
            </thead>
            <tbody>
              {view.components.map((item) => (
                <tr key={item.component} data-component={item.component}>
                  <td>
                    <span className={styles.productName}>
                      {componentName(item.component)}
                    </span>
                  </td>
                  <td>
                    <StatusMark
                      tone={item.available ? "good" : "critical"}
                      label={
                        item.available
                          ? t("settings.label.available-yes")
                          : t("settings.label.available-no")
                      }
                    />
                  </td>
                  <td>
                    {item.reason ?? <span className={styles.dim}>-</span>}
                  </td>
                  <td className={styles.mono}>{clockText(item.checkedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
