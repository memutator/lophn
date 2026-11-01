// 결정한 직후 남는 줄. 목록에서 빠진 항목이 어떻게 됐는지 허락·거절·cancelled로 구별해 보인다.
// 줄은 이 창의 panel을 열어 둔 동안만 남는다(store에 두지 않는다).
import { useCallback, useEffect, useRef, useState } from "react";
import type { WaitingEntry } from "../events/waiting-store.ts";
import { useEventClient } from "../events/hooks.tsx";
import { cardOf } from "./model.ts";
import { useInboxNames } from "./names.ts";
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

/** entries는 지금 목록이다. 항목이 닫힌 event가 cancelled면 줄로 남긴다(사람이 정한 것은 결정 응답이 줄을 더한다). */
export function useSettled(
  entries: readonly WaitingEntry[],
  initial: readonly SettledRow[] = [],
): Settled {
  const client = useEventClient();
  const [rows, setRows] = useState(initial);
  // 사라진 뒤에도 줄을 만들 수 있게 본 항목을 기억한다.
  const known = useRef(new Map<string, WaitingEntry>());
  for (const entry of entries) known.current.set(entry.id, entry);

  const names = useInboxNames();
  const add = useCallback(
    (entry: WaitingEntry, state: SettledState) => {
      const view = cardOf(entry, names);
      const row: SettledRow = {
        id: entry.id,
        title: view.title,
        who: view.meta,
        state,
        agent: view.requester ?? undefined,
      };
      setRows((now) => [...now.filter((one) => one.id !== row.id), row]);
    },
    [names],
  );
  const clear = useCallback(() => setRows([]), []);

  useEffect(
    () =>
      client.subscribe(
        {
          types: [
            "TurnRequestClosed",
            "QuestionResolved",
            "ActivationConsentClosed",
          ],
        },
        (message) => {
          if (message.kind !== "event") return;
          const event = message.event;
          let id: string | null = null;
          let cancelled = false;
          if (event.type === "TurnRequestClosed") {
            id = event.payload.request;
            cancelled = event.payload.outcome === "cancelled";
          } else if (event.type === "QuestionResolved") {
            id = event.payload.group;
            cancelled = event.payload.outcome === "cancelled";
          } else if (event.type === "ActivationConsentClosed") {
            id = event.payload.release;
            cancelled = event.payload.outcome === "cancelled";
          }
          const entry = id === null ? undefined : known.current.get(id);
          if (cancelled && entry) add(entry, "cancelled");
        },
      ),
    [client, add],
  );

  return { rows, add, clear };
}
