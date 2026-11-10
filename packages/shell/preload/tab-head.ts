// 탭 머리 줄 bridge(`setTabHead`·`onTabHead`). 앱 preload와 artifact preload가 같이 쓴다. 이 통로는 page와
// 그것을 품은 shell renderer 사이만 오가고(ipc/app-tab-head.ts) main을 부르지 않아, artifact에 열어도 봉한 규칙이 그대로다.
import type {
  TabHead,
  TabHeadEvent,
} from "../../protocol/shell/app-bridge-types.ts";
import {
  APP_TAB_HEAD_CHANNEL,
  APP_TAB_HEAD_EVENT_CHANNEL,
} from "../ipc/app-tab-head.ts";

export interface TabHeadTransport {
  /** 이 view를 품은 shell renderer(`<webview>` element)로 보낸다. */
  sendToHost(channel: string, input: unknown): void;
  on(channel: string, listener: (payload: unknown) => void): void;
}

export interface TabHeadBridge {
  setTabHead(head: TabHead | null): void;
  onTabHead(listener: (event: TabHeadEvent) => void): () => void;
}

export function createTabHead(transport: TabHeadTransport): TabHeadBridge {
  // shell이 머리 줄을 그리는지는 page가 받기 시작하기 전에 올 수 있어 여기 쥐고 있다가 새 listener에 준다.
  let shown = false;
  const listeners = new Set<(event: TabHeadEvent) => void>();
  transport.on(APP_TAB_HEAD_EVENT_CHANNEL, (payload) => {
    const event = payload as TabHeadEvent;
    if (event?.type === "shown") shown = event.shown === true;
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // 한 listener의 오류가 다른 listener를 막지 않는다. 오류 자체는 main world가 본다.
      }
    }
  });
  try {
    transport.sendToHost(APP_TAB_HEAD_CHANNEL, { hello: true });
  } catch {
    // shell 밖이면 머리 줄이 없다.
  }
  return {
    setTabHead(head: TabHead | null): void {
      try {
        transport.sendToHost(APP_TAB_HEAD_CHANNEL, head ?? null);
      } catch {
        // 보낼 수 없는 값(함수 등)이면 머리 줄을 바꾸지 않는다.
      }
    },
    onTabHead(listener: (event: TabHeadEvent) => void): () => void {
      listeners.add(listener);
      listener({ type: "shown", shown });
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
