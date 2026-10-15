// 탭 안 알림. 탭 본문 맨 위에 붙어 스크롤해도 위쪽에 남는 toast다. 색 다른 띠나 상자를 두지 않는다.
import { Toast } from "@lophn/design/components";

import c from "./contexts.module.css";

// 시간이 가지 않는 timer를 주어 화면에 남은 채로 보인다. ×로 닫는다.
const NO_TIMER = { set: () => 0, clear: () => {} };

export function TabToast(
  { title, body, onClose }: {
    title: string;
    body?: string;
    onClose: () => void;
  },
) {
  return (
    <div className={c.tabToast}>
      <Toast title={title} body={body} onClose={onClose} timer={NO_TIMER} />
    </div>
  );
}
