import type { ReactNode } from "react";
import { Button } from "@lophn/design/components";
import { t } from "@lophn/wording";

import type { AskRequest, AskView } from "./ask-view.ts";

export interface NoticeAskProps {
  /** null이면 단추가 없다(부를 agent가 없는 계기). */
  ask: AskView | null;
  /** 사람이 눌렀을 때만 ask.request를 싣고 부른다. 보내는 일은 하지 않는다. */
  onAsk: (request: AskRequest) => void;
}

// NoticeCard의 actions 자리에 놓는 [Ask <agent 이름>] 단추(shell/desktop#R35). ask가 있을 때만
// 단추를 그리고 아니면 아무것도 그리지 않는다. 단추는 `data-action="ask-agent"`다.
export function NoticeAsk({ ask, onAsk }: NoticeAskProps): ReactNode {
  if (ask === null) return null;
  return (
    <Button
      size="sm"
      data-action="ask-agent"
      onClick={() => onAsk(ask.request)}
    >
      {t("common.button.ask-agent", { agent: ask.agentName })}
    </Button>
  );
}
