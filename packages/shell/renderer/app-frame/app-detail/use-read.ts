// 탭 하나가 core를 읽는 공통 hook. 처음 읽기가 실패하면 failed이고, 읽은 뒤 다시 읽기가 실패하면
// 마지막으로 확인한 값과 그 시각을 남긴다(연결 끊김 패턴: 빈 결과나 최신 값으로 보이지 않는다).
import { useCallback, useEffect, useRef, useState } from "react";

import type { SourceResult } from "./source.ts";

export type Loaded<T> =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | {
    readonly state: "ready";
    readonly value: T;
    /** 마지막 읽기가 실패했으면 그 값을 확인한 시각이다. */
    readonly staleSince: Date | null;
  };

export interface ReadHandle<T> {
  readonly loaded: Loaded<T>;
  reload(): void;
}

/**
 * load를 부르고 결과를 돌려준다. pollMs가 있으면 그 간격으로 다시 읽는다(적용·회수처럼 사람이
 * 기다리는 일이 끝났는지 보려는 때만 준다).
 */
export function useRead<T>(
  load: () => Promise<SourceResult<T>>,
  deps: readonly unknown[],
  options: { pollMs?: number; now?: () => Date } = {},
): ReadHandle<T> {
  const [loaded, setLoaded] = useState<Loaded<T>>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const last = useRef<{ value: T; at: Date } | null>(null);
  const loader = useRef(load);
  loader.current = load;
  const now = options.now ?? (() => new Date());

  useEffect(() => {
    let live = true;
    const read = () =>
      void loader.current().then((result) => {
        if (!live) return;
        if (result.ok) {
          last.current = { value: result.value, at: now() };
          setLoaded({ state: "ready", value: result.value, staleSince: null });
        } else if (last.current !== null) {
          setLoaded({
            state: "ready",
            value: last.current.value,
            staleSince: last.current.at,
          });
        } else {
          setLoaded({ state: "failed" });
        }
      });
    read();
    const timer = options.pollMs === undefined
      ? undefined
      : setInterval(read, options.pollMs);
    return () => {
      live = false;
      if (timer !== undefined) clearInterval(timer);
    };
    // deps는 호출자가 정한다.
  }, [...deps, attempt, options.pollMs]);

  const reload = useCallback(() => setAttempt((count) => count + 1), []);
  return { loaded, reload };
}
