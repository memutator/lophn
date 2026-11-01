// 시작 실패. 높은 schema, hash가 다른 이력, 손상 원본 세 경우를 한 창에 나란히 놓는다. 각 경우의 본문은 renderer의
// StartFailureScreen이다. 셋 모두 원본을 그대로 두고 시작하지 않았다는 안내와 update 안내를 준다.
import type { CSSProperties } from "react";

import { GateFrame } from "../../../../../packages/shell/renderer/desktop/places/home-gate.tsx";
import { schemaFailure } from "../../../../../packages/shell/renderer/desktop/places/start-failure/model.ts";
import { StartFailureScreen } from "../../../../../packages/shell/renderer/desktop/places/start-failure/start-failure.tsx";

const FAILURES: CSSProperties = {
  display: "grid",
  flex: 1,
  alignItems: "start",
  gridTemplateColumns: "repeat(3, minmax(var(--space-0), 1fr))",
  gap: "var(--space-6)",
  padding: "var(--space-8) var(--layout-pane-padding-wide)",
  overflow: "auto",
};

const FAILURE_CASE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-4)",
  minWidth: "var(--space-0)",
};

const CAPTION: CSSProperties = {
  color: "var(--color-text-muted)",
  fontSize: "var(--type-caption-size)",
  lineHeight: "var(--type-caption-line)",
};

const FAILURE_FRAME: CSSProperties = {
  display: "flex",
  flex: "none",
  minHeight: 420,
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "var(--space-5)",
  padding: "var(--space-9) var(--space-7)",
  border: "var(--border-width) solid var(--color-border-base)",
  borderRadius: "var(--radius-md)",
  textAlign: "center",
};

const CASES = [
  { caption: "Data from a newer version", reason: "newer_schema" },
  { caption: "History does not match", reason: "history_mismatch" },
  { caption: "Damaged data", reason: "damaged_original" },
] as const;

export function StartFailures() {
  return (
    <GateFrame platform="linux">
      <div style={FAILURES}>
        {CASES.map((one) => (
          <section key={one.caption} style={FAILURE_CASE}>
            <span style={CAPTION}>{one.caption}</span>
            <div style={FAILURE_FRAME}>
              <StartFailureScreen
                failure={schemaFailure(one.reason)}
                onRetry={() => {}}
              />
            </div>
          </section>
        ))}
      </div>
    </GateFrame>
  );
}
