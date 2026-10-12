import type { ReactNode } from "react";
import {
  type Clock,
  type Timer,
  Toast,
  type ToastAction,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import type { AskRequest, AskView } from "../../workspace/ask-view.ts";

export interface AskAgentToastProps {
  /** notification id. [View]가 싣는다. */
  notification: string;
  /** 계기마다 정한 안내 문장. 호출한 쪽이 wording으로 만들어 준다. */
  title: string;
  /** null이면 [Ask] 단추가 없다. */
  ask: AskView | null;
  /** [Ask <agent 이름>]. 누르면 ask.request로 한 번 부른 뒤 닫는다. */
  onAsk: (request: AskRequest) => void;
  /** [View]. notification id를 싣고 한 번 부른 뒤 닫는다. 읽음 처리가 아니다. */
  onView: (notification: string) => void;
  /** [×]와 저절로 닫힘, 그리고 Ask·View 뒤. 읽음이 아니라 이 창에서 감출 뿐이다. */
  onClose: () => void;
  timer?: Timer;
  clock?: Clock;
}

// lophn이 가진 사건을 알리는 toast. 단추는 [Ask <agent 이름>] [View] 순서이고 [×]가
// 뒤에 온다. Ask는 알림 행이 실어 온 요청 값으로 callback을 부른다.
export function AskAgentToast(
  {
    notification,
    title,
    ask,
    onAsk,
    onView,
    onClose,
    timer,
    clock,
  }: AskAgentToastProps,
): ReactNode {
  const viewAction: ToastAction = {
    id: "view",
    label: t("common.button.view"),
  };
  const actions = ask === null ? [viewAction] as const : [
    {
      id: "ask",
      label: t("common.button.ask-agent", { agent: ask.agentName }),
    },
    viewAction,
  ] as const;
  return (
    <Toast
      title={title}
      actions={actions}
      onAction={(id) => {
        if (id === "ask" && ask !== null) onAsk(ask.request);
        if (id === "view") onView(notification);
        onClose();
      }}
      onClose={onClose}
      timer={timer}
      clock={clock}
    />
  );
}
