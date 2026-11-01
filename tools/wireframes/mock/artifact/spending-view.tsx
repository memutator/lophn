// `spending` artifact가 그린 화면의 고정 그림. artifact view는 `lophn-artifact:` 문서라 lophn 화면이 아니고, gallery에서만
// view 자리(artifact 탭의 page 영역) 안에 들어간다. agent가 쓴 HTML이 appearance token(색, dark mode)을 그대로 쓰는 모양이다.
// 고른 막대의 윤곽, 번호, 메모는 실제로는 view 안 page layer가 그린다.
import { t } from "@lophn/i18n";

import { SPENDING_BARS } from "./data.ts";
import marks from "../../drafts/app-space/orders-view.module.css";

export interface BarMark {
  readonly n: number;
  /** 메모 칸을 이 막대 옆에 열어 둔다. */
  readonly memo?: string;
}

const small = {
  color: "var(--color-text-muted)",
  fontSize: "var(--type-caption-size)",
  lineHeight: "var(--type-caption-line)",
  textAlign: "center",
  fontVariantNumeric: "tabular-nums",
} as const;

export function SpendingView({
  title,
  picked = {},
}: {
  title: string;
  /** 막대 label별로 고른 표시. */
  picked?: Readonly<Record<string, BarMark>>;
}) {
  const top = Math.max(...SPENDING_BARS.map((bar) => bar.value));
  return (
    <div
      data-artifact-view="spending"
      style={{
        boxSizing: "border-box",
        width: "100%",
        maxWidth: 720,
        margin: "0 auto",
        padding: "var(--space-8) var(--space-6)",
        color: "var(--color-text-primary)",
        fontFamily: "var(--font-sans)",
      }}
    >
      <h1
        style={{
          margin: 0,
          fontSize: "var(--type-title-size)",
          lineHeight: "var(--type-title-line)",
          letterSpacing: "var(--type-tracking-title)",
        }}
      >
        {title}
      </h1>
      <p
        style={{
          margin: "var(--space-4) 0 0",
          color: "var(--color-text-muted)",
          fontSize: "var(--type-small-size)",
          lineHeight: "var(--type-small-line)",
        }}
      >
        October 2026 · USD
      </p>
      <div
        style={{
          display: "flex",
          gap: "var(--space-5)",
          height: 260,
          marginTop: "var(--space-6)",
          paddingBottom: "var(--space-2)",
          borderBottom: "var(--border-width) solid var(--color-border-base)",
        }}
      >
        {SPENDING_BARS.map((bar) => {
          const mark = picked[bar.label];
          return (
            <div
              key={bar.label}
              style={{
                display: "flex",
                flex: "1 1 0",
                flexDirection: "column",
                gap: "var(--space-2)",
                minWidth: 0,
              }}
            >
              <span style={small}>{bar.value}</span>
              <span
                style={{
                  display: "flex",
                  flex: "1 1 auto",
                  alignItems: "flex-end",
                  minHeight: 0,
                }}
              >
                <span
                  className={mark ? marks.picked : undefined}
                  style={{
                    position: "relative",
                    display: "block",
                    width: "100%",
                    height: `${(bar.value / top) * 100}%`,
                  }}
                >
                  {mark ? <span className={marks.badge}>{mark.n}</span> : null}
                  <span
                    style={{
                      display: "block",
                      width: "100%",
                      height: "100%",
                      borderRadius:
                        "var(--chart-bar-radius) var(--chart-bar-radius) 0 0",
                      background: "var(--chart-series-0)",
                    }}
                  />
                  {mark?.memo === undefined ? null : (
                    <span
                      className={marks.memo}
                      style={{
                        top: 0,
                        left: "100%",
                        marginLeft: "var(--space-5)",
                      }}
                    >
                      <textarea
                        readOnly
                        rows={2}
                        defaultValue={mark.memo}
                        aria-label={t("artifact.label.note")}
                        style={{ font: "inherit", resize: "none" }}
                      />
                      <span className={marks.memoFoot}>
                        <span className={marks.muted}>
                          {t("artifact.text.memo-note")}
                        </span>
                        <span className={marks.memoRemove} aria-hidden="true">
                          ×
                        </span>
                      </span>
                    </span>
                  )}
                </span>
              </span>
              <span style={small}>{bar.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
