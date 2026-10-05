import { createContext, type ReactNode, useContext } from "react";
import {
  conversationIcons,
  IconButton,
  Tooltip,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import { Dock, type Ticks } from "./dock.tsx";
import type { DraftStore } from "./drafts.ts";
import type { DockPlacement } from "./model.ts";
import type { ConversationSource, WorkPlace } from "./source.ts";

/** 창마다 하나. entry가 만들어 모든 공간이 같은 대화 메모리를 쓴다. */
export interface ConversationDeps {
  readonly source: ConversationSource;
  readonly drafts: DraftStore;
  readonly ticks?: Ticks;
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

/** 대화 통로. 없으면(통로 없는 테스트·화면) 도크와 토글을 두지 않는다. */
export function useConversation(): ConversationDeps | null {
  return useContext(ConversationContext);
}

// 상단 바 오른쪽의 도크 토글. 어느 공간에서든 같은 자리다(shell/desktop#R1, ui-ux 5절).
export function DockToggle(
  { open, onToggle }: { open: boolean; onToggle: () => void },
) {
  const label = open
    ? t("conversation.button.close")
    : t("conversation.button.open");
  return (
    <Tooltip content={label}>
      <IconButton
        icon={conversationIcons.dock}
        label={label}
        variant="secondary"
        size="md"
        aria-pressed={open}
        data-dock-toggle=""
        onClick={onToggle}
      />
    </Tooltip>
  );
}

export interface DockSlotProps {
  placement: DockPlacement;
  workPlace: WorkPlace;
  onClose: () => void;
  onOpenResult?: (document: string, version: string | null) => void;
}

/** 공간의 본문 오른쪽에 도크를 둔다. 닫혀 있으면 아무것도 그리지 않는다. */
export function DockSlot(
  { placement, workPlace, onClose, onOpenResult }: DockSlotProps,
) {
  const deps = useConversation();
  if (deps === null || placement === "hidden") return null;
  return (
    <Dock
      source={deps.source}
      drafts={deps.drafts}
      ticks={deps.ticks}
      now={deps.now}
      placement={placement}
      workPlace={workPlace}
      onClose={onClose}
      onOpenResult={onOpenResult}
    />
  );
}
