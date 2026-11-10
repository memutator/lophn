import { useEffect, useRef } from "react";

// 앱 view preload bridge `lophnApp.events`의 SDK 쪽 사본(protocol/shell/app-bridge-types.ts).
export interface EventBridge {
  subscribe(
    source: string,
    event: string,
    listener: (payload: unknown) => void,
  ): () => void;
}

/**
 * 앱 event를 받는다. `source`는 event를 낸 앱의 slug이거나 lophn이 내는 event의 `"lophn"`이다. 이 화면의 앱이 선언의
 * `subscriptions`에 같은 (source, event)를 적어야 온다. 화면이 mount된 동안만 받고 놓친 event는 다시 오지 않으므로,
 * 처음 값은 발행 앱의 read command로 읽는다(화면은 operation만 부르니 앱이 그 값을 operation으로도 내놓는다).
 * listener는 부를 때의 가장 최근 것을 쓰므로 그릴 때마다 새로 넘겨도 된다. 앱 view 밖이면 아무 일도 없다.
 */
export function useEvent<Payload = unknown>(
  source: string,
  event: string,
  listener: (payload: Payload) => void,
): void {
  const latest = useRef(listener);
  latest.current = listener;
  useEffect(() => {
    const bridge = (globalThis as { lophnApp?: { events?: EventBridge } })
      .lophnApp?.events;
    if (bridge === undefined) return;
    return bridge.subscribe(source, event, (payload) =>
      latest.current(payload as Payload),
    );
  }, [source, event]);
}
