// 다른 기계(Home server)로 값을 보내는 보호 입력 창. 화면은 renderer의 SecretInput이고 값이 갈 기계 이름이 제목 아래 한 줄이다.
import type { CSSProperties } from "react";

import { SecretInput } from "../../../../../packages/shell/renderer/secret-input/secret-input.tsx";

const STAGE: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "var(--color-surface-floor)",
  fontFamily: "var(--font-sans)",
};

// shell main이 따로 띄우는 작은 창 하나의 틀.
const WINDOW: CSSProperties = {
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  width: "var(--dialog-width-default)",
  maxWidth: "100%",
  border: "var(--border-width) solid var(--color-border-strong)",
  borderRadius: "var(--radius-lg)",
  background: "var(--color-surface-base)",
  color: "var(--color-text-primary)",
  boxShadow: "var(--shadow-dialog)",
  fontSize: "var(--type-body-size)",
  lineHeight: "var(--type-body-line)",
  overflow: "hidden",
};

export const MachineSecretInputScene = () => (
  <div style={STAGE}>
    <div style={WINDOW}>
      <SecretInput
        purpose="provider"
        subject="OpenAI"
        name=""
        configured={false}
        machine="Home server"
      />
    </div>
  </div>
);
