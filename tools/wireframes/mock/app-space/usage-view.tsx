// 구독 사용량 앱이 tray 화면에 그린 것의 고정 그림. 앱 view는 앱이 그리므로 lophn 화면이 아니다.
import type { CSSProperties } from "react";

const row: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: "var(--type-small-size)",
};

const bar = (percent: number): CSSProperties => ({
  height: "var(--space-3)",
  borderRadius: "var(--radius-full)",
  background: `linear-gradient(to right, var(--status-good-marker) ${percent}%, var(--color-surface-muted) ${percent}%)`,
});

export function UsageView() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-6)",
        width: "100%",
        padding: "var(--space-8)",
        color: "var(--color-text-primary)",
        background: "var(--color-surface-base)",
      }}
    >
      <strong>Usage</strong>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
        }}
      >
        <div style={row}>
          <span>This week</span>
          <span>62% left</span>
        </div>
        <div style={bar(62)} />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
        }}
      >
        <div style={row}>
          <span>Today</span>
          <span>81% left</span>
        </div>
        <div style={bar(81)} />
      </div>
      <span
        style={{
          color: "var(--color-text-muted)",
          fontSize: "var(--type-caption-size)",
        }}
      >
        Resets on Monday.
      </span>
    </div>
  );
}
