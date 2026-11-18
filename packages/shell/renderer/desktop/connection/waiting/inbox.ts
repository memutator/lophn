// 한 창의 Inbox. 모든 기계의 대기 목록(`stores.waiting`)을 한 목록으로 합쳐 Inbox overlay·탭·배지가 쓴다. 항목은 그 기계의 값 그대로이고
// 기계 이름과 key(`inboxKey`)만 붙는다. 결정은 항목의 기계 core로 간다(`coreOf`). hub가 없는 화면(gallery의 단독 page)은 범위의 기계
// 하나다.
import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";

import type { Notice } from "../../../../../protocol/apps/notice.ts";
import type { CoreSource } from "../connection.ts";
import type { EventClient } from "../events/client.ts";
import {
  useDismissUnseen,
  useEventClient,
  useSessions,
  useWaiting,
} from "../events/hooks.tsx";
import type { SessionEntry } from "../events/sessions-store.ts";
import {
  inboxKey,
  type WaitingEntry,
  type WaitingState,
} from "../events/waiting-store.ts";
import { useMachinesView } from "../../machines/context.tsx";
import type { OnMachine } from "../../machines/data.ts";
import { type MachineRef, useMachineHub } from "../../machines/scope.tsx";

/** 한 기계의 Inbox 재료. `name`은 이 컴퓨터가 아닌 기계의 꼬리표이고, `live`가 아니면 마지막으로 본 값이다. */
export interface InboxSource {
  readonly machine: MachineRef;
  readonly name: string | undefined;
  readonly live: boolean;
  readonly waiting: WaitingState;
  readonly sessions: readonly SessionEntry[];
  readonly client: EventClient;
  readonly core: CoreSource;
  /** 못 본 끝을 그 기계에서 지운다. */
  readonly dismiss: (session: string) => void;
}

interface Tag {
  readonly key: string;
  readonly machineName: string | undefined;
}

export type InboxEntry = OnMachine<WaitingEntry> &
  Tag & {
    /** 꺼진 기계의 항목은 마지막으로 본 채 남고 결정 단추가 없다. */
    readonly offline: boolean;
  };
export type InboxNotice = OnMachine<Notice> & Tag;

export interface Inbox {
  readonly sources: readonly InboxSource[];
  readonly entries: readonly InboxEntry[];
  /** 휘발 알림. */
  readonly notices: readonly InboxNotice[];
  /** 안 읽은 영구 기록 수. History 탭은 이 컴퓨터의 것만 보여 이 컴퓨터의 수다. */
  readonly historyUnread: number;
  /** 끝난 탭 수(배지). 줄은 `useFinished`가 짓는다. */
  readonly finishedCount: number;
  coreOf(machine: MachineRef): CoreSource;
  sourceOf(machine: MachineRef): InboxSource | undefined;
}

function buildInbox(sources: readonly InboxSource[]): Inbox {
  const entries = sources.flatMap((source) =>
    source.waiting.entries.map(
      (entry): InboxEntry => ({
        ...entry,
        machine: source.machine,
        key: inboxKey(source.machine, entry.id),
        machineName: source.name,
        offline: !source.live,
      }),
    ),
  );
  const notices = sources.flatMap((source) =>
    source.waiting.notices.map(
      (notice): InboxNotice => ({
        ...notice,
        machine: source.machine,
        key: inboxKey(source.machine, notice.id),
        machineName: source.name,
      }),
    ),
  );
  const here = sources.find((source) => source.machine === null);
  const sourceOf = (machine: MachineRef) =>
    sources.find((source) => source.machine === machine);
  return {
    sources,
    entries,
    notices,
    historyUnread: here?.waiting.historyUnread ?? 0,
    finishedCount: sources.reduce(
      (sum, source) =>
        sum +
        source.waiting.finished.length +
        source.sessions.filter((entry) => entry.unseen).length,
      0,
    ),
    coreOf: (machine) => (sourceOf(machine) ?? sources[0]!).core,
    sourceOf,
  };
}

// hub가 없는 화면: 범위의 기계 하나.
function useScopeSources(): readonly InboxSource[] {
  const waiting = useWaiting();
  const { sessions } = useSessions();
  const client = useEventClient();
  const dismiss = useDismissUnseen();
  return useMemo(
    () => [
      {
        machine: null,
        name: undefined,
        live: true,
        waiting,
        sessions,
        client,
        core: client.core,
        dismiss,
      },
    ],
    [waiting, sessions, client, dismiss],
  );
}

interface Row {
  readonly machine: MachineRef;
  readonly name: string | undefined;
  readonly live: boolean;
}

// hub의 기계마다 store를 읽는다. store는 마운트한 동안 돌려야 하므로 구독할 때 같이 시작한다(여러 곳이 시작해도 한 번만 돈다).
// 합친 값은 안의 값이 모두 그대로이면 같은 값이다: 읽는 화면이 구독을 다시 걸지 않게.
function useHubSources(
  hub: ReturnType<typeof useMachineHub>,
): readonly InboxSource[] {
  const view = useMachinesView();
  const rowKey = JSON.stringify(
    (view?.machines ?? [])
      .filter((one) => one.status !== "removed")
      .map((one) => [one.id, one.name, one.status === "connected"]),
  );
  const hasHub = hub !== null;
  const rows = useMemo(
    (): readonly Row[] =>
      hasHub
        ? [
            { machine: null, name: undefined, live: true },
            ...(JSON.parse(rowKey) as [string, string, boolean][]).map(
              ([machine, name, live]) => ({ machine, name, live }),
            ),
          ]
        : [],
    [hasHub, rowKey],
  );
  const datas = useMemo(
    () => (hub === null ? [] : rows.map((row) => hub.get(row.machine))),
    [hub, rows],
  );
  const subscribe = useCallback(
    (listener: () => void) => {
      const stops = datas.flatMap((data) => [
        data.stores.waiting.subscribe(listener),
        data.stores.sessions.subscribe(listener),
        data.stores.start(),
      ]);
      return () => stops.forEach((stop) => stop());
    },
    [datas],
  );
  const cache = useRef<{
    inputs: readonly unknown[];
    value: readonly InboxSource[];
  } | null>(null);
  const getSnapshot = useCallback(() => {
    const inputs = [
      rows,
      ...datas.flatMap((data) => [
        data.stores.waiting.get(),
        data.stores.sessions.get(),
      ]),
    ];
    const last = cache.current;
    if (
      last !== null &&
      last.inputs.length === inputs.length &&
      last.inputs.every((one, at) => one === inputs[at])
    ) {
      return last.value;
    }
    const value = rows.map(
      (row, at): InboxSource => ({
        ...row,
        waiting: inputs[1 + at * 2] as WaitingState,
        sessions: (inputs[2 + at * 2] as { sessions: readonly SessionEntry[] })
          .sessions,
        client: datas[at]!.events,
        core: datas[at]!.core,
        dismiss: datas[at]!.stores.unseen.dismiss,
      }),
    );
    cache.current = { inputs, value };
    return value;
  }, [rows, datas]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** 모든 기계의 Inbox. 한 창에 같은 값이다. */
export function useInbox(): Inbox {
  const hub = useMachineHub();
  const scope = useScopeSources();
  const hubbed = useHubSources(hub);
  const sources = hub === null ? scope : hubbed;
  return useMemo(() => buildInbox(sources), [sources]);
}
