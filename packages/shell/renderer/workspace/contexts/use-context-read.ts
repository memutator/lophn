// Context 탭 머리가 열 때 한 번 읽는다. 열려 있는 동안 저절로 다시 읽지 않는다.
// 사람이 한 일(판 되돌리기) 뒤에는 `refresh`로 화면을 둔 채 다시 읽고, 읽지 못하면 이미 보이는 값을 지킨다.
// 대상이 바뀌거나 [Retry]를 누르면 loading부터 시작한다.
import { useEffect, useRef, useState } from "react";

export type ContextRead<T> =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly value: T };

/** load는 값을 돌려주고 읽지 못하면 null을 돌려준다. target이 같으면 같은 대상이다. */
export function useContextRead<T>(
  load: () => Promise<T | null>,
  target: readonly unknown[],
) {
  const [read, setRead] = useState<ContextRead<T>>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [refreshed, setRefreshed] = useState(0);
  const quiet = useRef(false);
  useEffect(() => {
    const keep = quiet.current;
    quiet.current = false;
    let live = true;
    if (!keep) setRead({ state: "loading" });
    void load().then((value) => {
      if (!live) return;
      setRead((current) =>
        value !== null
          ? { state: "ready", value }
          : keep && current.state === "ready"
          ? current
          : { state: "failed" }
      );
    });
    return () => {
      live = false;
    };
  }, [...target, attempt, refreshed]);
  return {
    read,
    reload: () => setAttempt((count) => count + 1),
    refresh: () => {
      quiet.current = true;
      setRefreshed((count) => count + 1);
    },
  };
}
