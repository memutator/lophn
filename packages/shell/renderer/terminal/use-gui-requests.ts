// 이 탭의 터미널에 GUI가 열렸다는 main의 push를 듣는다(browser bridge의 `use-bridge-open-requests.ts`와 같은 꼴). 이 탭의
// terminal_ref가 아니면 못 본 척하고(ack하지 않아 그 탭을 가진 다른 창이 받는다), 맞으면 탭을 GUI view로 바꾼 뒤에만 ack한다.
// ack가 1.5초 안에 없으면 main이 handle을 닫는다.
import { useEffect, useRef } from "react";

import type {
  HarnessGuiTabApi,
  HarnessGuiTabOpened,
  HarnessGuiTabView,
} from "../../ipc/harness-gui.ts";

export function useGuiRequests(
  api: HarnessGuiTabApi | null,
  terminalRef: string | null,
  on: {
    opened(open: HarnessGuiTabOpened): void;
    view(change: HarnessGuiTabView): void;
  },
): void {
  const latest = useRef(on);
  latest.current = on;
  useEffect(() => {
    if (api === null || terminalRef === null) return;
    const offOpened = api.onOpened((open) => {
      if (open.terminal_ref !== terminalRef) return;
      latest.current.opened(open);
      void api.ackOpened(open.request);
    });
    const offView = api.onView((change) => {
      if (change.terminal_ref === terminalRef) latest.current.view(change);
    });
    return () => {
      offOpened();
      offView();
    };
  }, [api, terminalRef]);
}
