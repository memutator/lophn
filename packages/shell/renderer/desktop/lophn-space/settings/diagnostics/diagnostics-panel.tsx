// settings의 진단 자리. 보안 상태 점검(doctor) 결과는 영향 한 문장과 다음 행동으로만
// 보이고 원문(check 이름·finding message·코드)은 개발자 diagnostics 펼침에만 둔다
// (shell/wording#R8, R10). 사람이 누를 때만 검사를 돌린다.
import { useState } from "react";
import { Button, Skeleton } from "@lophn/design/components";
import { t } from "@lophn/wording";

import { timeText } from "../model.ts";
import type { DiagnosticsSource, DiagnosticsView } from "./source.ts";
import styles from "../settings.module.css";

export interface DiagnosticsPanelProps {
  source: DiagnosticsSource;
}

type Loaded =
  | { readonly state: "idle" }
  | { readonly state: "checking" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly view: DiagnosticsView };

/** 다음 행동 문장. 영향 종류 하나씩이다(다음 행동은 하나다: shell/wording#R10). */
function nextOf(
  impact: "wide_grant" | "raw_key",
): string {
  return impact === "wide_grant"
    ? t("settings.diagnostics.next-wide-grant")
    : t("settings.diagnostics.next-raw-key");
}

function impactOf(impact: "wide_grant" | "raw_key"): string {
  return impact === "wide_grant"
    ? t("settings.diagnostics.wide-grant")
    : t("settings.diagnostics.raw-key");
}

export function DiagnosticsPanel({ source }: DiagnosticsPanelProps) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "idle" });
  const [rawOpen, setRawOpen] = useState(false);

  async function check(): Promise<void> {
    setLoaded({ state: "checking" });
    const read = await source.check();
    setLoaded(
      read.ok ? { state: "ready", view: read.value } : { state: "failed" },
    );
  }

  const findings = loaded.state === "ready"
    ? loaded.view.rows.filter((row) => row.finding !== null)
    : [];
  return (
    <div className={styles.groups} data-diagnostics="">
      <section className={styles.section}>
        <h2 className={styles.heading}>{t("settings.diagnostics.heading")}</h2>
        <p className={styles.text}>{t("settings.diagnostics.intro")}</p>
        {loaded.state === "idle" && (
          <p className={styles.muted} data-check="none">
            {t("settings.diagnostics.check-failed-no")}
          </p>
        )}
        {loaded.state === "checking" && <Skeleton lines={2} />}
        {loaded.state === "failed" && (
          <p className={styles.state} data-check="failed">
            {t("settings.diagnostics.check-failed")}
          </p>
        )}
        {loaded.state === "ready" && (
          <div data-check="ready">
            {findings.length === 0
              ? (
                <p className={styles.notice} data-check-result="clean">
                  {t("settings.check.clean")}{" "}
                  {t("settings.diagnostics.checked-at", {
                    time: timeText(loaded.view.observedAt),
                  })}
                </p>
              )
              : (
                <ul className={styles.rows}>
                  {findings.map((row) => (
                    <li
                      key={row.check}
                      className={styles.row}
                      data-finding={row.check}
                    >
                      <span className={styles.rowText}>
                        <span className={styles.subheading}>
                          {row.finding === null
                            ? null
                            : impactOf(row.finding.impact)}
                        </span>
                        <details className={styles.details}>
                          <summary>{t("settings.label.details")}</summary>
                          <dl>
                            <dt>{t("settings.label.source")}</dt>
                            <dd>
                              {row.finding === null ? null : row.finding.raw}
                            </dd>
                            <dt>{t("settings.label.checked-at")}</dt>
                            <dd>
                              {row.finding === null
                                ? null
                                : timeText(row.finding.at)}
                            </dd>
                          </dl>
                        </details>
                      </span>
                      <span className={styles.rowText} data-next-check="">
                        {row.finding === null
                          ? null
                          : nextOf(row.finding.impact)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
          </div>
        )}
        <div className={styles.actions}>
          <Button
            size="sm"
            variant="secondary"
            data-action="check"
            disabled={loaded.state === "checking"}
            onClick={() => void check()}
          >
            {t("settings.button.check-security")}
          </Button>
        </div>
      </section>
      <section className={styles.section} data-diagnostics-raw="">
        <h3 className={styles.subheading}>
          {t("settings.diagnostics.raw-heading")}
        </h3>
        <p className={styles.muted}>{t("settings.diagnostics.raw-intro")}</p>
        <div className={styles.actions}>
          <Button
            size="sm"
            variant="secondary"
            data-action="raw"
            aria-expanded={rawOpen}
            onClick={() => setRawOpen(!rawOpen)}
          >
            {t("settings.label.details")}
          </Button>
        </div>
        {rawOpen && (
          <div data-raw="">
            {loaded.state !== "ready"
              ? (
                <p className={styles.state} data-raw="failed">
                  {t("settings.diagnostics.raw-failed")}
                </p>
              )
              : (
                <ul className={styles.rows} data-raw-list="">
                  {loaded.view.rows.map((row) => (
                    <li
                      key={row.check}
                      className={styles.row}
                      data-raw-row={row.check}
                    >
                      <span className={styles.rowText}>
                        <span>{row.check}</span>
                        <span className={styles.value}>
                          {row.finding === null
                            ? t("settings.diagnostics.clean-row")
                            : row.finding.raw}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
          </div>
        )}
      </section>
    </div>
  );
}
