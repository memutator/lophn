// 결정한 직후 남는 줄. 목록에서 빠진 항목이 어떻게 됐는지 허락·거절·cancelled로 구별해 보인다.
// 줄은 이 창의 panel을 열어 둔 동안만 남는다(store에 두지 않는다).
import { useCallback, useEffect, useRef, useState } from "react";
import { inboxKey } from "../events/waiting-store.ts";
import type { SettledRow, SettledState } from "./decide.ts";
import type { Inbox, InboxEntry } from "./inbox.ts";
import { cardOf } from "./model.ts";
import { useInboxNamesOf } from "./names.ts";

export type { SettledRow };

export interface Settled {
  readonly rows: readonly SettledRow[];
  readonly add: (entry: InboxEntry, state: SettledState) => void;
  readonly clear: () => void;
}

/** 기계마다 항목이 닫힌 event가 cancelled면 줄로 남긴다(사람이 정한 것은 결정 응답이 줄을 더한다). */
export function useSettled(
  inbox: Inbox,
  initial: readonly SettledRow[] = [],
): Settled {
  const [rows, setRows] = useState(initial);
  // 사라진 뒤에도 줄을 만들 수 있게 본 항목을 기억한다.
  const known = useRef(new Map<string, InboxEntry>());
  for (const entry of inbox.entries) known.current.set(entry.key, entry);
  const sources = useRef(inbox.sources);
  sources.current = inbox.sources;
  const machineKey = inbox.sources.map((source) => source.machine ?? "").join();

  const namesOf = useInboxNamesOf();
  const add = useCallback(
    (entry: InboxEntry, state: SettledState) => {
      const view = cardOf(entry, namesOf(entry.machine));
      const row: SettledRow = {
        id: entry.key,
        title: view.title,
        who: view.meta,
        state,
        agent: view.requester ?? undefined,
      };
      setRows((now) => [...now.filter((one) => one.id !== row.id), row]);
    },
    [namesOf],
  );
  const clear = useCallback(() => setRows([]), []);

  useEffect(() => {
    const stops = sources.current.map((source) =>
      source.client.subscribe(
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
          const entry =
            id === null
              ? undefined
              : known.current.get(inboxKey(source.machine, id));
          if (cancelled && entry) add(entry, "cancelled");
        },
      ),
    );
    return () => stops.forEach((stop) => stop());
  }, [machineKey, add]);

  return { rows, add, clear };
}
