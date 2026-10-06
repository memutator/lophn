// Data 탭. 이 앱의 데이터를 내보내는 일(앱 export)은 core에 아직 route가 없다(apps#T28). 있는 것처럼
// 단추를 두지 않고 지금 할 수 없다고 한 문장으로 보인다(P11). 지금 쓰는 Version이 읽는 데이터
// 형식 번호만 실제 값이다.
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

export function DataTab({ app, source, now }: DataTabProps) {
  const list = useRead(() => source.versions(app), [app, source], { now });
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
              <p className={styles.state} data-export-unavailable="">
                {t("app-detail.note.export-unavailable")}
              </p>
            </section>
          );
        }}
      </Loadable>
    </div>
  );
}
