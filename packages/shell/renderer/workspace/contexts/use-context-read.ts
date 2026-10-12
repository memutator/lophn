// Context 탭 본문이 한 번 읽고, 작업대 watch가 알리는 stamp가 바뀌면 화면을 그대로 둔 채 다시 읽는다.
// 대상(source·context)이나 [Retry]가 바뀌면 loading부터 시작하고, stamp만
// 바뀌어 다시 읽다 실패하면 이미 보이는 값을 지키다 다음 stamp에서 다시 읽는다.
import { useEffect, useRef, useState } from "react";

import type { ContextListItem } from "./source.ts";

export type ContextRead<T> =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly value: T };

/**
 * context 목록 한 줄의 읽을 거리가 바뀌었는지 가르는 표. 상태·판·진행(draft·checking 판)이
 * 바뀌면 달라진다.
 */
export function contextStamp(item: ContextListItem): string {
  return JSON.stringify([
    item.status,
    item.revision,
    item.applied_bundle,
    item.draft_bundle,
    item.checking_bundle,
  ]);
}

/** load는 값을 돌려주고 읽지 못하면 null을 돌려준다. target이 같으면 같은 대상이다. */
export function useContextRead<T>(
  load: () => Promise<T | null>,
  target: readonly unknown[],
  stamp: string | undefined,
) {
  const [read, setRead] = useState<ContextRead<T>>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const last = useRef<readonly unknown[] | null>(null);
  useEffect(() => {
    const key = [...target, attempt];
    const quiet = last.current !== null &&
      key.length === last.current.length &&
      key.every((value, index) => value === last.current?.[index]);
    last.current = key;
    let live = true;
    if (!quiet) setRead({ state: "loading" });
    void load().then((value) => {
      if (!live) return;
      setRead((current) =>
        value !== null
          ? { state: "ready", value }
          : quiet && current.state === "ready"
          ? current
          : { state: "failed" }
      );
    });
    return () => {
      live = false;
    };
  }, [...target, attempt, stamp]);
  return { read, reload: () => setAttempt((count) => count + 1) };
}
