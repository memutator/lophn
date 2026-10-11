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
import type { CoreSource } from "../desktop/connection/connection.ts";
import type { ContextLinks } from "./result-links.tsx";
import type { ConversationSource, WorkPlace } from "./source.ts";

/** 창마다 하나. entry가 만들어 모든 공간이 같은 대화 메모리를 쓴다. */
export interface ConversationDeps {
  readonly source: ConversationSource;
  readonly drafts: DraftStore;
  readonly ticks?: Ticks;
  readonly now?: () => number;
  /** 첫 공간이 도크를 연 채로 시작한다. headless 확인(`#conversation`)만 준다. */
  readonly startOpen?: boolean;
  /**
   * main의 core 통로. provider 계정 상태(desktop#R7의 provider 끊김)를 도크가 읽는다.
   * 없으면(통로 없는 테스트·창) provider 끊김 줄을 두지 않는다.
   */
  readonly core?: CoreSource;
  /** 설정의 연결 자리로 간다. provider 끊김 줄의 행동이 쓴다. */
  readonly onSettings?: () => void;
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
  /** 대화 속 context 이름 링크가 그 context의 탭을 여는 길. */
  contexts?: ContextLinks;
  /** 창의 대화 통로 대신 쓸 통로. 다른 역할과 말할 때 쓴다. */
  source?: ConversationSource;
}

/** 공간의 본문 오른쪽에 도크를 둔다. 닫혀 있으면 아무것도 그리지 않는다. */
export function DockSlot(
  { placement, workPlace, onClose, onOpenResult, contexts, source }:
    DockSlotProps,
) {
  const deps = useConversation();
  if (deps === null || placement === "hidden") return null;
  return (
    <Dock
      source={source ?? deps.source}
      drafts={deps.drafts}
      ticks={deps.ticks}
      now={deps.now}
      placement={placement}
      workPlace={workPlace}
      onClose={onClose}
      onOpenResult={onOpenResult}
      contexts={contexts}
      {...(deps.core === undefined ? {} : { core: deps.core })}
      {...(deps.onSettings === undefined
        ? {}
        : { onSettings: deps.onSettings })}
    />
  );
}
