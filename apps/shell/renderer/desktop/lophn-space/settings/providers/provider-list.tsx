import type { ReactNode } from "react";

import type { ProviderSettingsSource } from "./settings-source.ts";

export interface ProviderListProps {
  source: ProviderSettingsSource;
}

// Settings › Providers(shell/desktop#R49). provider는 계정과 인증만 다룬다: model 고르기·기본값
// 칸이 없다. 위는 연결된 provider(이름, 로그인 방법, [Disconnect]; 펼치면 계정 목록과 위아래 순서·
// 사용 끄기)이고 아래는 Add a provider 목록(줄마다 [+ Connect])이다. [+ Connect]는 Connect dialog를
// 연다(connect-dialog.tsx). 기존 providers-panel.tsx(Connections 카드)는 이 화면으로 바뀌고 R task가 지운다.
// agent-I30
export function ProviderList(_props: ProviderListProps): ReactNode {
  throw new Error("not implemented: agent-I30");
}
