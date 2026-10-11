// 계약 위반 toast(shell/workspace#R29). 알릴 뿐 입력 focus를 가져오지 않고 [View]는 그 context의
// Violations를 여는 일을 부른 쪽에 맡긴다. 구현은 ctx-I44.
// 문구 key는 packages/design/wording/en.ts에 이미 있다. 구현은 en.ts를 고치지 않고 아래 key만 t()로 쓴다:
//   contexts.title.toast-violations
//   common.button.view
import type { ReactNode } from "react";
import type { Clock, Timer } from "@lophn/design/components";

export interface ViolationToastProps {
  /** context 이름. "eval: 2 documents don't match the contract"의 앞부분. */
  readonly title: string;
  readonly count: number;
  readonly onView: () => void;
  readonly onClose: () => void;
  /** 자동으로 닫히는 시간을 재는 timer·clock. 시험이 시간을 세우려고 주입한다. */
  readonly timer?: Timer & Clock;
}

export function ViolationToast(_props: ViolationToastProps): ReactNode {
  return null;
}
