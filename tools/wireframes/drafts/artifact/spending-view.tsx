// `spending` artifact가 그린 화면의 고정 그림. artifact view는 `lophn-artifact:` 문서라 lophn 화면이 아니고, gallery에서만 이 자리에
// 들어간다. agent가 쓴 HTML이 appearance token(색, dark mode)을 그대로 쓰는 모양이다. 고른 막대의 윤곽, 번호, 메모는 실제로는 page layer가 그린다.
import { t } from "@lophn/wording";

import { SPENDING_BARS } from "./data.ts";
import marks from "../app-space/orders-view.module.css";
import styles from "./artifact.module.css";

export interface BarMark {
  readonly n: number;
  /** 메모 칸을 이 막대 옆에 열어 둔다. */
  readonly memo?: string;
}

export function SpendingView(
  { title, picked = {} }: {
    title: string;
    /** 막대 label별로 고른 표시. */
    picked?: Readonly<Record<string, BarMark>>;
  },
) {
  const top = Math.max(...SPENDING_BARS.map((bar) => bar.value));
  return (
    <div className={styles.page} data-artifact-view="spending">
      <h1 className={styles.pageTitle}>{title}</h1>
      <p className={styles.pageNote}>October 2026 · USD</p>
      <div className={styles.bars}>
        {SPENDING_BARS.map((bar) => {
          const mark = picked[bar.label];
          return (
            <div key={bar.label} className={styles.barCell}>
              <span className={styles.barValue}>{bar.value}</span>
              <span className={styles.barTrack}>
                <span
                  className={`${styles.barTarget} ${mark ? marks.picked : ""}`}
                  style={{ height: `${bar.value / top * 100}%` }}
                >
                  {mark ? <span className={marks.badge}>{mark.n}</span> : null}
                  <span className={styles.bar} />
                  {mark?.memo === undefined
                    ? null
                    : (
                      <span className={`${marks.memo} ${styles.barMemo}`}>
                        <textarea
                          readOnly
                          rows={2}
                          defaultValue={mark.memo}
                          aria-label={t("artifact.label.note")}
                          style={{ font: "inherit", resize: "none" }}
                        />
                        <span className={marks.muted}>
                          {t("artifact.text.memo-note")}
                        </span>
                      </span>
                    )}
                </span>
              </span>
              <span className={styles.barLabel}>{bar.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
