// thread bookmark를 main의 파일에서 읽고 쓰는 길. preload가 `lophnThreadBookmarks`를 열어 두지 않은 곳(gallery,
// dev-mock)에서는 null이라 bookmark 단추가 없다. 저장은 main 파일 하나뿐이다.
import { useCallback, useEffect, useMemo, useState } from "react";

import type { ThreadBookmarksApi } from "../../../ipc/thread-bookmarks.ts";

export interface Bookmarks {
  /** bookmark된 message key. */
  readonly keys: ReadonlySet<string>;
  toggle(message: string): void;
}

function threadBookmarksApi(): ThreadBookmarksApi | null {
  return (
    (globalThis as { lophnThreadBookmarks?: ThreadBookmarksApi })
      .lophnThreadBookmarks ?? null
  );
}

/** session key의 bookmark. key를 모르거나 통로가 없으면 null이다. */
export function useThreadBookmarks(session: string | null): Bookmarks | null {
  const api = threadBookmarksApi();
  const [keys, setKeys] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    setKeys(new Set());
    if (api === null || session === null) return;
    let alive = true;
    const read = () =>
      api.list({ session }).then(
        (list) => {
          if (alive) setKeys(new Set(list));
        },
        () => {},
      );
    void read();
    const off = api.onChanged((changed) => {
      if (changed === session) void read();
    });
    return () => {
      alive = false;
      off();
    };
  }, [api, session]);

  const toggle = useCallback(
    (message: string) => {
      if (api === null || session === null) return;
      const on = !keys.has(message);
      const flip = () =>
        setKeys((current) => {
          const next = new Set(current);
          if (next.has(message)) next.delete(message);
          else next.add(message);
          return next;
        });
      // 바로 화면 값을 바꾸고 저장이 거절되면 되돌린다.
      flip();
      api.set({ session, message, on }).catch(flip);
    },
    [api, session, keys],
  );

  return useMemo(
    () => (api === null || session === null ? null : { keys, toggle }),
    [api, session, keys, toggle],
  );
}
