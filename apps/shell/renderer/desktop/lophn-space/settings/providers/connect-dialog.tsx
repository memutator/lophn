import type { ReactNode } from "react";

import type {
  ProviderDefinitionRow,
  ProviderSettingsSource,
} from "./settings-source.ts";

export interface ConnectDialogProps {
  source: ProviderSettingsSource;
  /** 연결할 정의. null이면 닫혀 있다. */
  definition: ProviderDefinitionRow | null;
  onClose: () => void;
  /** 연결을 시작했거나 Custom provider를 등록한 뒤 부른다. 목록이 다시 읽는다. */
  onConnected: () => void;
}

// Connect dialog(shell/desktop#R49). 내장 정의는 "Connect <이름>" 제목 아래 그 정의가 지원하는 로그인
// 방법을 고르게 하고(model 단계는 없다), custom 정의는 "Custom provider" 제목의 form(Provider ID,
// Display name, Base URL, "Add an API key (optional)")과 [Cancel] [Connect]를 보인다.
// API key 값은 이 form이 받지 않는다. 고르면 보호 창이 열린다(platform/secrets#R2).
// agent-I30
export function ConnectDialog(_props: ConnectDialogProps): ReactNode {
  throw new Error("not implemented: agent-I30");
}
