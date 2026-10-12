// 결정 창이 확정되지 않고 끝났다는 알림을 기다리는 쪽 탭에 전한다. 알림은 main이 창을 연 쪽에만
// 보내고 windowId와 끝난 종류만 있다. 허락은 알리지 않으므로 허락 뒤의 대기는 실제 상태가
// 바뀔 때 풀린다.

export type DecisionEnded = {
  readonly windowId: string;
  readonly ended: string;
};

/** preload의 끝남 구독. 없는 창에서는 undefined다. */
export type SubscribeEnded = (
  listener: (ended: DecisionEnded) => void,
) => () => void;

export function windowEnded(): SubscribeEnded | undefined {
  const shell = (globalThis as {
    lophnShell?: { onConfirmationEnded?: SubscribeEnded };
  }).lophnShell;
  return typeof shell?.onConfirmationEnded === "function"
    ? (listener) => shell.onConfirmationEnded!(listener)
    : undefined;
}

/** 열린 결정 창 하나가 끝나면 한 번만 부른다. 구독은 첫 대기 때 한 번 시작한다. */
export function decisionEnds(subscribe: SubscribeEnded | undefined) {
  const waiting = new Map<string, () => void>();
  let started = false;
  return {
    watch(windowId: string, onEnded: (() => void) | undefined): void {
      if (subscribe === undefined || onEnded === undefined) return;
      waiting.set(windowId, onEnded);
      if (started) return;
      started = true;
      subscribe((event) => {
        const done = waiting.get(event.windowId);
        if (done === undefined) return;
        waiting.delete(event.windowId);
        done();
      });
    },
  };
}
