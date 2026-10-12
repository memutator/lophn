// Search 탭이 source에서 읽는 값 하나의 상태. key가 바뀌면 다시 읽고,
// reload는 같은 key를 다시 읽는다(앞서 읽은 값은 새 값이 올 때까지 보인다).
import { useCallback, useEffect, useState } from "react";

import type { ReadResult } from "./source.ts";

export type Slot<T> =
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | { readonly status: "loaded"; readonly value: T };

const LOADING = { status: "loading" } as const;

export function useRead<T>(
  key: string,
  load: () => Promise<ReadResult<T>>,
): { readonly slot: Slot<T>; readonly reload: () => void } {
  const [held, setHeld] = useState<{ key: string; slot: Slot<T> }>({
    key,
    slot: LOADING,
  });
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((count) => count + 1), []);

  useEffect(() => {
    let current = true;
    const settle = (slot: Slot<T>) => {
      if (current) setHeld({ key, slot });
    };
    load().then(
      (result) =>
        settle(
          result.ok
            ? { status: "loaded", value: result.value }
            : { status: "failed" },
        ),
      () => settle({ status: "failed" }),
    );
    return () => {
      current = false;
    };
  }, [key, attempt]);

  return { slot: held.key === key ? held.slot : LOADING, reload };
}
