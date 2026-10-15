// 결정한 직후 남는 줄. 목록에서 빠진 항목이 어떻게 됐는지 접수·적용·거절·cancelled로 구별해 보인다.
// 줄은 이 창의 panel을 열어 둔 동안만 남는다(store에 두지 않는다).
import { useCallback, useEffect, useRef, useState } from "react";
import type { WaitingEntry } from "../events/waiting-store.ts";
import { useEventClient, useWaitingRefresh } from "../events/hooks.tsx";
import { cardOf } from "./model.ts";
import type { SettledState } from "./decide.ts";

export interface SettledRow {
  readonly id: string;
  readonly title: string;
  readonly who: string;
  readonly state: SettledState;
  /** 거절 이유가 간 agent의 이름. */
  readonly agent?: string;
}

export interface Settled {
  readonly rows: readonly SettledRow[];
  readonly add: (entry: WaitingEntry, state: SettledState) => void;
  readonly clear: () => void;
}

/**
 * entries는 지금 목록이다. 항목이 PermissionResolved·QuestionResolved로 cancelled가 되면 줄로 남기고,
 * ApprovalDecided는 보류 request를 다시 읽어 목록에서 빼고, "접수" 줄을 적용 결과(applied·failed)로 바꾼다.
 */
export function useSettled(
  entries: readonly WaitingEntry[],
  initial: readonly SettledRow[] = [],
): Settled {
  const client = useEventClient();
  const refresh = useWaitingRefresh();
  const [rows, setRows] = useState(initial);
  // 사라진 뒤에도 줄을 만들 수 있게 본 항목을 기억한다.
  const known = useRef(new Map<string, WaitingEntry>());
  for (const entry of entries) known.current.set(entry.id, entry);
  // 결정 응답보다 ApprovalDecided가 먼저 오면 줄이 생길 때 이 결과로 바꾼다.
  const applied = useRef(new Map<string, SettledState>());

  const add = useCallback((entry: WaitingEntry, given: SettledState) => {
    const state = given === "accepted"
      ? applied.current.get(entry.id) ?? given
      : given;
    const view = cardOf(entry);
    const row: SettledRow = {
      id: entry.id,
      title: view.title,
      who: view.meta,
      state,
      agent: view.requester ?? undefined,
    };
    setRows((now) => [...now.filter((one) => one.id !== row.id), row]);
  }, []);
  const clear = useCallback(() => setRows([]), []);

  useEffect(() =>
    client.subscribe({
      types: ["PermissionResolved", "QuestionResolved", "ApprovalDecided"],
    }, (message) => {
      if (message.kind !== "event") return;
      const event = message.event;
      if (event.type === "ApprovalDecided") {
        const result = event.payload.applied;
        if (result) {
          applied.current.set(event.subject, result.state);
          setRows((now) =>
            now.map((row) =>
              row.id === event.subject && row.state === "accepted"
                ? { ...row, state: result.state }
                : row
            )
          );
        }
        void refresh();
        return;
      }
      const id = event.type === "PermissionResolved"
        ? event.payload.request
        : event.type === "QuestionResolved"
        ? event.payload.group
        : null;
      const cancelled = event.type === "PermissionResolved" ||
          event.type === "QuestionResolved"
        ? event.payload.outcome === "cancelled"
        : false;
      const entry = id === null ? undefined : known.current.get(id);
      if (cancelled && entry) add(entry, "cancelled");
    }), [client, refresh, add]);

  return { rows, add, clear };
}
