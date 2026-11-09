// App details의 Run 절. 앱 실행 허용(run_enabled)을 켜고 끄는 곳이다. 끄면 앱 process가 멈추고, 켜면 채택한 release가
// 다시 뜬다. crash loop로 멈춘 앱은 켜진 채라 껐다 켜야 하고, 최근 10분 안 종료가 남아 있으면 그 창이 지난 뒤에 다시 돈다.
import { useEffect, useState } from "react";
import { Switch } from "@lophn/ui/input";
import { t } from "@lophn/i18n";

import { Loadable } from "./loadable.tsx";
import { PaneToast } from "./parts.tsx";
import type { AppDetailSource, RunState } from "./source.ts";
import { useRead } from "./use-read.ts";
import styles from "./app-section.module.css";

const POLL_MS = 3000;

const LABEL: Record<RunState, () => string> = {
  running: () => t("app-detail.label.run-running"),
  stopped: () => t("app-detail.label.run-stopped"),
  unavailable: () => t("app-detail.label.run-unavailable"),
  halted: () => t("app-detail.label.run-halted"),
  preparing: () => t("app-detail.label.run-preparing"),
};

const NOTE: Record<RunState, () => string | null> = {
  running: () => null,
  stopped: () => t("app-detail.note.run-stopped"),
  unavailable: () => t("app-detail.note.run-unavailable"),
  halted: () => t("app-detail.note.run-halted"),
  preparing: () => t("app-detail.note.run-preparing"),
};

export function RunSection({
  app,
  source,
  now,
}: {
  app: string;
  source: AppDetailSource;
  now: () => Date;
}) {
  const [failed, setFailed] = useState<boolean | null>(null);
  const [polling, setPolling] = useState(false);
  const read = useRead(() => source.run(app), [app, source], {
    pollMs: polling ? POLL_MS : undefined,
    now,
  });
  const state = read.loaded.state === "ready" ? read.loaded.value.state : null;
  // 켰는데 아직 답하지 않는 동안만 다시 읽는다.
  useEffect(() => setPolling(state === "unavailable"), [state]);

  const change = async (enabled: boolean) => {
    const reply = await source.setRun(app, enabled);
    setFailed(reply.ok ? null : enabled);
    read.reload();
  };

  return (
    <section
      className={styles.section}
      aria-label={t("app-detail.heading.run")}
      data-app-run=""
    >
      {failed === null ? null : (
        <PaneToast
          title={t(
            failed
              ? "app-detail.error.run-failed-on"
              : "app-detail.error.run-failed-off",
          )}
          error
          onClose={() => setFailed(null)}
        />
      )}
      <div className={styles.head}>
        <h4 className={styles.label}>{t("app-detail.heading.run")}</h4>
      </div>
      <Loadable read={read} target={t("app-detail.label.run-target")} now={now}>
        {(view) => (
          <div className={styles.row} data-run-state={view.state}>
            <span className={styles.stack}>
              <span className={styles.state}>{LABEL[view.state]()}</span>
              {NOTE[view.state]() === null ? null : (
                <p className={styles.note}>{NOTE[view.state]()}</p>
              )}
            </span>
            <span className={styles.action}>
              <Switch
                size="sm"
                label={t("app-detail.label.run-switch")}
                checked={view.enabled}
                disabled={view.state === "preparing"}
                onCheckedChange={(next) => void change(next)}
              />
            </span>
          </div>
        )}
      </Loadable>
    </section>
  );
}
