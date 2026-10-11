// 작업대가 context 목록을 읽어 두고 바뀐 것을 알린다. 위반이 늘어난 context는 toast로 알리고
// (shell/workspace#R29), [New context] 뒤에 생긴 만드는 중인 context는 그 탭을 남긴다(R30).
// 처음 읽은 값은 기준일 뿐이라 알리지 않는다. 읽기 실패는 이전 목록을 그대로 둔다.
import { useCallback, useEffect, useRef, useState } from "react";
import { systemTimer, type Timer } from "@lophn/design/components";

import type { ContextListItem, ContextsSource } from "./source.ts";

/** 목록을 다시 읽는 간격. */
export const CONTEXT_WATCH_MS = 30_000;

export interface ContextWatchEvents {
  /** 위반이 늘어난 context. count는 지금 어긋난 문서 수다. */
  onViolations(item: ContextListItem, count: number): void;
  /** 처음 보는 만드는 중인 context. */
  onDrafting(item: ContextListItem): void;
}

export interface ContextWatch {
  readonly list: readonly ContextListItem[];
  /** 지금 다시 읽는다. */
  refresh(): void;
}

const NONE: readonly ContextListItem[] = [];

export function useContextWatch(
  source: ContextsSource | undefined,
  project: string,
  events: ContextWatchEvents,
  timer: Timer = systemTimer,
): ContextWatch {
  const [list, setList] = useState<readonly ContextListItem[]>(NONE);
  const known = useRef<ReadonlyMap<string, ContextListItem> | null>(null);
  const latest = useRef(events);
  latest.current = events;
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((count) => count + 1), []);

  // 다른 통로나 프로젝트는 새 기준에서 시작한다. 같은 곳을 다시 읽을 때는 기준을 지킨다.
  useEffect(() => {
    known.current = null;
    setList(NONE);
  }, [source, project]);

  useEffect(() => {
    if (source === undefined) return;
    let live = true;
    let handle: unknown;
    const read = async () => {
      const result = await source.list(project).catch(() => null);
      if (!live) return;
      if (result?.ok) {
        const before = known.current;
        const items = result.value;
        known.current = new Map(items.map((item) => [item.id, item]));
        setList(items);
        if (before !== null) {
          for (const item of items) {
            const prev = before.get(item.id);
            if (prev === undefined) {
              if (item.status === "drafting") latest.current.onDrafting(item);
            } else if (item.violation_mark > prev.violation_mark) {
              latest.current.onViolations(item, item.violation_mark);
            }
          }
        }
      }
      if (live) handle = timer.set(() => void read(), CONTEXT_WATCH_MS);
    };
    void read();
    return () => {
      live = false;
      if (handle !== undefined) timer.clear(handle);
    };
  }, [source, project, timer, tick]);

  return { list, refresh };
}
