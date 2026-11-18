// desktop 창만 가진 대화의 조각. mermaid diagram과 앱 카드(webview)는 큰 library와 desktop 통로를 끌고, 링크 열기와 provider key
// 입력은 preload 통로다. Agent 화면은 host가 준 것만 쓰고 이 file을 import하지 않는다. 없는 창에서
// diagram은 code로, 앱 카드는 안내 한 줄로, 링크는 Markdown 기본으로 남고 provider key 단추는 없다.
import { type ComponentType, createContext, useContext } from "react";

import type { OpenExternalApi } from "../../ipc/open-external.ts";
import type { BodyPart } from "./agent-tab-source.ts";

export interface DesktopParts {
  /** mermaid fence의 diagram. */
  readonly Diagram: ComponentType<{ code: string }>;
  /** 답 안의 앱 카드 하나. `index`는 그 메시지 본문 안의 자리다. */
  readonly AppCard: ComponentType<{
    message: string;
    index: number;
    part: Extract<BodyPart, { kind: "app_card" }>;
  }>;
  /** 링크를 창 밖 browser로 여는 길. 통로가 없는 창(gallery)이면 undefined다. */
  linkOpener(): OpenExternalApi["openExternal"] | undefined;
  /** API key로 연결된 provider의 key를 보호 입력 창으로 받는다. `machine`은 대화가 선 범위의 기계다(null이면 이 컴퓨터). */
  enterProviderKey(
    provider: { id: string; name: string },
    machine: string | null,
  ): void;
}

const DesktopPartsContext = createContext<DesktopParts | null>(null);

export const DesktopPartsProvider = DesktopPartsContext.Provider;

/** Agent 화면 밖(gallery의 본문 조각)이면 null이다. */
export function useDesktopParts(): DesktopParts | null {
  return useContext(DesktopPartsContext);
}
