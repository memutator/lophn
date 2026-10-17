import { createContext, type ReactNode, useContext } from "react";

import type { DraftStore } from "./drafts.ts";

/** 창마다 하나. entry가 만들어 Agent 탭과 앱 공간의 Agent 칸이 같은 입력 메모리를 쓴다. */
interface ConversationDeps {
  readonly drafts: DraftStore;
  readonly now?: () => number;
}

const ConversationContext = createContext<ConversationDeps | null>(null);

export function ConversationProvider(
  { deps, children }: { deps: ConversationDeps; children: ReactNode },
) {
  return (
    <ConversationContext.Provider value={deps}>
      {children}
    </ConversationContext.Provider>
  );
}

/** 창의 대화 메모리. 없으면(통로 없는 테스트·화면) 쓰는 쪽이 자기 메모리를 쥔다. */
export function useConversation(): ConversationDeps | null {
  return useContext(ConversationContext);
}
