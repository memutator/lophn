import type { ReactNode } from "react";
import type { Clock, Timer } from "@lophn/design/components";

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

// lophn이 가진 사건을 알리는 toast(shell/desktop#R35). 단추는 [Ask <agent 이름>] [View] 순서이고 [×]가
// 뒤에 온다. Ask는 알림 행이 실어 온 요청 값으로 callback을 부른다.
// agent-I32
export function AskAgentToast(_props: AskAgentToastProps): ReactNode {
  throw new Error("not implemented: agent-I32");
}
