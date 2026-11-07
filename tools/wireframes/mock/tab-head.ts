// gallery의 앱 화면은 <webview>가 아니라 빈 자리라 앱 page가 없다. 앱이 useTabHead로 머리 줄을 올린 것처럼
// 그 자리 element에 guest의 `app:tab-head` 메시지(sendToHost가 만드는 ipc-message)를 직접 낸다.
import { useEffect } from "react";

import { APP_TAB_HEAD_CHANNEL } from "../../../packages/shell/ipc/app-tab-head.ts";
import type { TabHead } from "../../../packages/shell/ipc/app-tab-head.ts";

export function useMockTabHead(
  element: HTMLElement | null,
  head: TabHead,
): void {
  useEffect(() => {
    if (element === null) return;
    element.dispatchEvent(
      Object.assign(new Event("ipc-message"), {
        channel: APP_TAB_HEAD_CHANNEL,
        args: [head],
      }),
    );
  }, [element, head]);
}
