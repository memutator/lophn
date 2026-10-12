// 계약 위반 toast(shell/workspace#R29). 알릴 뿐 입력 focus를 가져오지 않고 [View]는 그 context의
// Violations를 여는 일을 부른 쪽에 맡긴다. 구현은 ctx-I44.
// 문구 key는 packages/design/wording/en.ts에 이미 있다. 구현은 en.ts를 고치지 않고 아래 key만 t()로 쓴다:
//   contexts.title.toast-violations
//   common.button.view
import type { ReactNode } from "react";
import { type Clock, type Timer, Toast } from "@lophn/design/components";
import { t } from "@lophn/wording";

export interface ViolationToastProps {
  /** context 이름. "eval: 2 documents don't match the contract"의 앞부분. */
  readonly title: string;
  readonly count: number;
  readonly onView: () => void;
  /**
   * [Ask <agent 이름>]. 주면 [View] 앞에 단추가 선다(shell/desktop#R35). 누르면 부른 쪽이 위반된 context를
   * 첫 chip으로 붙인 Agent 탭을 연다. 아무것도 보내지 않는다.
   */
  readonly ask?: { readonly agentName: string; readonly onAsk: () => void };
  readonly onClose: () => void;
  /** 자동으로 닫히는 시간을 재는 timer·clock. 시험이 시간을 세우려고 주입한다. */
  readonly timer?: Timer & Clock;
}

export function ViolationToast(
  { title, count, onView, ask, onClose, timer }: ViolationToastProps,
): ReactNode {
  const view = { id: "view", label: t("common.button.view") };
  return (
    <Toast
      title={t("contexts.title.toast-violations", { title, count })}
      actions={ask === undefined ? [view] : [
        {
          id: "ask",
          label: t("common.button.ask-agent", { agent: ask.agentName }),
        },
        view,
      ]}
      onAction={(id) => id === "ask" ? ask?.onAsk() : onView()}
      onClose={onClose}
      timer={timer}
      clock={timer}
    />
  );
}
