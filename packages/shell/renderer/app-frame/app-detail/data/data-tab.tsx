// Data 탭. 이 앱의 데이터를 내보내는 일(앱 export)은 worker route다. 사람이 누를 때만 준비를
// 청하고 결과(ready·failed·preparing)를 구별해 보인다.
// 준비 본체는 core가 그래프 밖 프로세스로 하고 아무것도 바꾸지 않는다.
import { useState } from "react";
import { Button } from "@lophn/design/components";
import { t } from "@lophn/wording";

import { Loadable } from "../loadable.tsx";
import type { AppDetailSource } from "../source.ts";
import { useRead } from "../use-read.ts";
import styles from "../app-detail.module.css";

export interface DataTabProps {
  app: string;
  source: AppDetailSource;
  now: () => Date;
}

type ExportState =
  | { readonly kind: "idle" }
  | { readonly kind: "preparing" }
  | { readonly kind: "ready" }
  | { readonly kind: "failed" };

export function DataTab({ app, source, now }: DataTabProps) {
  const list = useRead(() => source.versions(app), [app, source], { now });
  const [moved, setMoved] = useState<ExportState>({ kind: "idle" });

  async function move(): Promise<void> {
    setMoved({ kind: "preparing" });
    const result = await source.exportApp(app);
    if (!result.ok) {
      setMoved({ kind: "failed" });
      return;
    }
    setMoved(
      result.value.state === "ready"
        ? { kind: "ready" }
        : result.value.state === "preparing"
        ? { kind: "preparing" }
        : { kind: "failed" },
    );
  }

  return (
    <div className={styles.tab} data-tab-body="data">
      <Loadable
        read={list}
        target={t("app-detail.label.data-target")}
        now={now}
      >
        {(value) => {
          const current = value.versions.find((version) =>
            version.id === value.current
          );
          return (
            <section className={styles.section}>
              {current
                ? (
                  <p className={styles.text} data-data-format="">
                    {t("app-detail.label.data-format", {
                      number: String(current.dataFormat),
                    })}
                  </p>
                )
                : null}
              <p className={styles.muted} data-export-note="">
                {t("app-detail.note.export")}
              </p>
              <div className={styles.actions}>
                <Button
                  size="sm"
                  variant="secondary"
                  data-action="export-app"
                  disabled={moved.kind === "preparing"}
                  onClick={() => void move()}
                >
                  {t("app-detail.button.export-app")}
                </Button>
              </div>
              {moved.kind === "preparing" && (
                <p className={styles.state} data-export="preparing">
                  {t("app-detail.note.export-preparing")}
                </p>
              )}
              {moved.kind === "ready" && (
                <p className={styles.text} data-export="ready">
                  {t("app-detail.note.export-ready")}
                </p>
              )}
              {moved.kind === "failed" && (
                <p className={styles.state} data-export="failed">
                  {t("app-detail.note.export-failed")}
                </p>
              )}
            </section>
          );
        }}
      </Loadable>
    </div>
  );
}
