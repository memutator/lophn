// History(영구 기록) 읽기. 정본은 기계마다의 core `notices.list`다. 이 컴퓨터와 연결된 다른 컴퓨터에서 각각 첫 page를 읽어
// 시각순으로 합치고, [Show more]는 비어 가는 기계의 cursor만 이어 읽어 순서를 지킨다.
// 새 영구 줄(NoticePosted)과 (다시) 붙음(ready)은 첫 page를 다시 읽고, 읽음(NoticeRead)은 있는 줄만 고친다.
import { type DateRange, parseDay, resolveRange } from "@lophn/ui/input";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type Notice,
  type NoticeKind,
  noticeMarkRead,
  noticesList,
  PROGRAM_NOTICE_KINDS,
} from "../../../../../protocol/apps/notice.ts";
import { commandCall } from "../../../command-call.ts";
import { newId } from "../../../prefixed-id.ts";
import type { CoreSource } from "../connection.ts";
import type { EventClient } from "../events/client.ts";
import { useEventClient } from "../events/hooks.tsx";
import { inboxKey } from "../events/waiting-store.ts";

const PAGE = 30;

/** 종류 거르기. all은 거르지 않고, app·program은 출처, 나머지는 program 종류 하나다. core `kind`가 하나만 받아 묶음은 출처까지다. */
export type TypeFilter = "all" | "app" | "program" | NoticeKind;

export interface HistoryFilter {
  readonly app: string | null;
  readonly project: string | null;
  readonly type: TypeFilter;
  readonly query: string;
  // null은 기간을 거르지 않는다.
  readonly range: DateRange | null;
}

export const NO_FILTER: HistoryFilter = {
  app: null,
  project: null,
  type: "all",
  query: "",
  range: null,
};

/** 거르기 선택지 순서(전체 말고). 사람이 찾는 것(release)을 앞에 둔다. */
export const TYPE_OPTIONS: readonly Exclude<TypeFilter, "all">[] = [
  "app",
  "program",
  ...PROGRAM_NOTICE_KINDS,
];

export interface HistorySource {
  readonly machine: string | null;
  readonly name: string | undefined;
  readonly core: CoreSource;
  readonly client: EventClient;
}

export type HistoryNotice = Notice & {
  readonly machine: string | null;
  readonly key: string;
  readonly machineName: string | undefined;
};

export interface SourceCursor {
  readonly machine: string | null;
  readonly name: string | undefined;
  readonly buffered: readonly HistoryNotice[];
  /** null이면 이 기계는 끝까지 읽었다. */
  readonly next: string | null;
}

// 기간은 사람이 있는 곳의 달력 날짜라 그 지역 자정에서 다음 날 자정 앞까지(until 미포함)로 푼다.
function periodOf(range: DateRange | null): { since?: string; until?: string } {
  if (range === null) return {};
  const { from, to } = resolveRange(range, new Date());
  const start = parseDay(from);
  const end = parseDay(to);
  if (start === undefined || end === undefined) return {};
  return {
    since: start.toISOString(),
    until: new Date(
      end.getFullYear(),
      end.getMonth(),
      end.getDate() + 1,
    ).toISOString(),
  };
}

function inputOf(filter: HistoryFilter, cursor: string | null) {
  return {
    persistent: true,
    ...(filter.app === null ? {} : { app: filter.app }),
    ...(filter.project === null ? {} : { project: filter.project }),
    ...(filter.type === "app" || filter.type === "program"
      ? { source: filter.type }
      : filter.type === "all"
        ? {}
        : { kind: filter.type }),
    ...(filter.query.trim() === "" ? {} : { query: filter.query.trim() }),
    ...periodOf(filter.range),
    ...(cursor === null ? {} : { cursor }),
    limit: PAGE,
  };
}

async function readPage(
  core: CoreSource,
  filter: HistoryFilter,
  cursor: string | null,
): Promise<{ notices: Notice[]; next: string | null } | null> {
  const reply = await core
    .call({
      kind: "read",
      resource: noticesList.resource,
      method: noticesList.method,
      body: inputOf(filter, cursor),
    })
    .catch(() => null);
  if (!reply?.ok) return null;
  const parsed = noticesList.output.safeParse(reply.value);
  return parsed.success
    ? { notices: parsed.data.notices, next: parsed.data.next_cursor }
    : null;
}

/** 줄 여럿을 읽음으로 바꾼다. 줄은 NoticeRead가 고친다. */
export async function markNoticesRead(
  core: CoreSource,
  ids: readonly string[],
): Promise<boolean> {
  if (ids.length === 0) return true;
  const reply = await core
    .call(
      commandCall(noticeMarkRead, {
        input: { ids: [...ids] },
        compare: {},
        key: newId("nmr"),
      }),
    )
    .catch(() => null);
  return reply?.ok === true;
}

/** 최근 것이 먼저다(`created_at desc, id desc`). 같은 값이면 기계 키로 순서를 고정한다. */
export function compareHistoryNotice(
  a: HistoryNotice,
  b: HistoryNotice,
): number {
  const ta = Date.parse(a.created_at);
  const tb = Date.parse(b.created_at);
  if (!Number.isNaN(ta) && !Number.isNaN(tb) && tb !== ta) return tb - ta;
  if (a.created_at !== b.created_at) {
    return b.created_at > a.created_at ? 1 : -1;
  }
  if (a.id !== b.id) return b.id > a.id ? 1 : -1;
  const ma = a.machine ?? "";
  const mb = b.machine ?? "";
  return ma < mb ? -1 : ma > mb ? 1 : 0;
}

export function tagHistoryNotice(
  source: Pick<HistorySource, "machine" | "name">,
  notice: Notice,
): HistoryNotice {
  return {
    ...notice,
    machine: source.machine,
    key: inboxKey(source.machine, notice.id),
    machineName: source.name,
  };
}

/** 한 기계의 대기 줄에 다음 page를 겹치지 않게 이어 붙이고 최근 순을 맞춘다. */
export function mergeBuffered(
  existing: readonly HistoryNotice[],
  incoming: readonly HistoryNotice[],
): HistoryNotice[] {
  const seen = new Set(existing.map((row) => row.key));
  const merged = [...existing];
  for (const row of incoming) {
    if (!seen.has(row.key)) {
      seen.add(row.key);
      merged.push(row);
    }
  }
  return merged.sort(compareHistoryNotice);
}

/**
 * 기계별 대기 줄에서 최대 `limit`건을 시각순으로 뽑는다. 더 읽을 page(`next !== null`)가 남은 기계의 대기 줄이 바닥나면
 * 거기서 멈춰, 아직 안 읽은 그 기계의 새 줄보다 다른 기계의 옛 줄이 먼저 나오지 않게 한다.
 */
export function drainHistoryPage(
  cursors: readonly SourceCursor[],
  existingKeys: ReadonlySet<string>,
  limit = PAGE,
): {
  readonly emitted: HistoryNotice[];
  readonly cursors: SourceCursor[];
  readonly hasMore: boolean;
} {
  const queues = cursors.map((cursor) => ({
    ...cursor,
    buffered: [...cursor.buffered],
  }));
  const seen = new Set(existingKeys);
  const emitted: HistoryNotice[] = [];

  while (emitted.length < limit) {
    let best = -1;
    for (let i = 0; i < queues.length; i++) {
      const head = queues[i]!.buffered[0];
      if (head === undefined) continue;
      if (
        best === -1 ||
        compareHistoryNotice(head, queues[best]!.buffered[0]!) < 0
      ) {
        best = i;
      }
    }
    if (best === -1) break;
    const picked = queues[best]!.buffered.shift()!;
    if (!seen.has(picked.key)) {
      seen.add(picked.key);
      emitted.push(picked);
    }
    if (queues[best]!.buffered.length === 0 && queues[best]!.next !== null) {
      break;
    }
  }

  const hasMore = queues.some(
    (queue) => queue.buffered.length > 0 || queue.next !== null,
  );
  return { emitted, cursors: queues, hasMore };
}

type InternalState =
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | {
      readonly status: "ready";
      readonly generation: number;
      readonly rows: readonly HistoryNotice[];
      readonly cursors: readonly SourceCursor[];
      readonly hasMore: boolean;
      readonly loadingMore: boolean;
    };

export type HistoryState =
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | {
      readonly status: "ready";
      readonly rows: readonly HistoryNotice[];
      readonly hasMore: boolean;
      readonly loadingMore: boolean;
    };

export interface History {
  readonly state: HistoryState;
  readonly sources: readonly HistorySource[];
  coreOf(machine: string | null): CoreSource;
  readonly loadMore: () => void;
  readonly reload: () => void;
}

// desktop은 여러 컴퓨터의 sources를 넘기고, 폰·gallery는 범위의 기계 하나를 쓴다.
export function useHistory(
  filter: HistoryFilter,
  explicitSources?: readonly HistorySource[],
): History {
  const scopeClient = useEventClient();
  const fallbackSources = useMemo(
    (): readonly HistorySource[] => [
      {
        machine: null,
        name: undefined,
        core: scopeClient.core,
        client: scopeClient,
      },
    ],
    [scopeClient],
  );
  const sources = explicitSources ?? fallbackSources;
  const [state, setState] = useState<InternalState>({ status: "loading" });
  const [tick, setTick] = useState(0);
  const genRef = useRef(0);
  const { app, project, type, query, range } = filter;

  // 첫 읽기는 구독의 첫 ready(mount 때 온다)가 연다. 그 뒤로는 거르기나 연결된 기계 목록이 바뀌거나 tick이 오를 때 읽는다.
  useEffect(() => {
    if (tick === 0) return;
    let live = true;
    const generation = ++genRef.current;
    const currentFilter: HistoryFilter = { app, project, type, query, range };
    setState({ status: "loading" });
    void Promise.all(
      sources.map(async (source) => ({
        source,
        page: await readPage(source.core, currentFilter, null),
      })),
    ).then((results) => {
      if (!live) return;
      const okResults = results.filter(
        (
          entry,
        ): entry is {
          source: HistorySource;
          page: NonNullable<Awaited<ReturnType<typeof readPage>>>;
        } => entry.page !== null,
      );
      if (okResults.length === 0) {
        setState({ status: "failed" });
        return;
      }
      const initialCursors: SourceCursor[] = okResults.map(
        ({ source, page }) => ({
          machine: source.machine,
          name: source.name,
          buffered: mergeBuffered(
            [],
            page.notices.map((notice) => tagHistoryNotice(source, notice)),
          ),
          next: page.next,
        }),
      );
      const drained = drainHistoryPage(initialCursors, new Set(), PAGE);
      setState({
        status: "ready",
        generation,
        rows: drained.emitted,
        cursors: drained.cursors,
        hasMore: drained.hasMore,
        loadingMore: false,
      });
    });
    return () => {
      live = false;
    };
  }, [sources, app, project, type, query, range, tick]);

  useEffect(() => {
    const stops = sources.map((source) =>
      source.client.subscribe(
        { types: ["NoticePosted", "NoticeRead"] },
        (message) => {
          // 다시 붙었다. 끊긴 동안 놓친 줄이 있을 수 있어 첫 page부터 다시 읽는다.
          if (message.kind === "ready") setTick((n) => n + 1);
          if (message.kind !== "event") return;
          const event = message.event;
          if (event.type === "NoticePosted") {
            if (event.payload.persistent) setTick((n) => n + 1);
          } else if (event.type === "NoticeRead") {
            const { id, read_at } = event.payload;
            const key = inboxKey(source.machine, id);
            setState((now) =>
              now.status === "ready"
                ? {
                    ...now,
                    rows: now.rows.map((row) =>
                      row.key === key ? { ...row, read_at } : row,
                    ),
                    cursors: now.cursors.map((cursor) =>
                      cursor.machine === source.machine
                        ? {
                            ...cursor,
                            buffered: cursor.buffered.map((row) =>
                              row.key === key ? { ...row, read_at } : row,
                            ),
                          }
                        : cursor,
                    ),
                  }
                : now,
            );
          }
        },
      ),
    );
    return () => stops.forEach((stop) => stop());
  }, [sources]);

  const loadMore = useCallback(() => {
    if (state.status !== "ready" || !state.hasMore || state.loadingMore) return;
    const { generation, cursors } = state;
    const toFetch = cursors.filter(
      (cursor) => cursor.buffered.length < PAGE && cursor.next !== null,
    );
    if (toFetch.length === 0) {
      // 남은 줄이 모두 대기 줄에 있어 추가 읽기 없이 바로 꺼낸다.
      setState((now) => {
        if (now.status !== "ready" || now.generation !== generation) return now;
        const drained = drainHistoryPage(
          now.cursors,
          new Set(now.rows.map((row) => row.key)),
          PAGE,
        );
        return {
          ...now,
          rows: [...now.rows, ...drained.emitted],
          cursors: drained.cursors,
          hasMore: drained.hasMore,
          loadingMore: false,
        };
      });
      return;
    }

    setState((now) =>
      now.status === "ready" && now.generation === generation
        ? { ...now, loadingMore: true }
        : now,
    );

    const currentFilter: HistoryFilter = { app, project, type, query, range };
    const sourceMap = new Map(sources.map((s) => [s.machine, s]));
    void Promise.all(
      toFetch.map(async (cursor) => {
        const source = sourceMap.get(cursor.machine);
        if (source === undefined || cursor.next === null) {
          return { machine: cursor.machine, source, page: null };
        }
        return {
          machine: cursor.machine,
          source,
          page: await readPage(source.core, currentFilter, cursor.next),
        };
      }),
    ).then((fetched) => {
      const byMachine = new Map(fetched.map((entry) => [entry.machine, entry]));
      setState((now) => {
        // 그 사이 거르기가 바뀌어 첫 page로 돌아갔으면 이어 붙이지 않는다.
        if (now.status !== "ready" || now.generation !== generation) return now;
        let blockedEmpty = false;
        const refilled: SourceCursor[] = now.cursors.map((cursor) => {
          const entry = byMachine.get(cursor.machine);
          if (entry === undefined) return cursor;
          if (entry.page === null || entry.source === undefined) {
            if (cursor.buffered.length === 0 && cursor.next !== null) {
              blockedEmpty = true;
            }
            return cursor;
          }
          const incoming = entry.page.notices.map((notice) =>
            tagHistoryNotice(entry.source!, notice),
          );
          return {
            ...cursor,
            buffered: mergeBuffered(cursor.buffered, incoming),
            next: entry.page.next,
          };
        });
        if (blockedEmpty) {
          // 비어 있던 기계의 다음 page를 못 읽었으면 순서가 뒤집히지 않게 다시 누를 수 있게만 풀어 둔다.
          return { ...now, cursors: refilled, loadingMore: false };
        }
        const drained = drainHistoryPage(
          refilled,
          new Set(now.rows.map((row) => row.key)),
          PAGE,
        );
        return {
          ...now,
          rows: [...now.rows, ...drained.emitted],
          cursors: drained.cursors,
          hasMore: drained.hasMore,
          loadingMore: false,
        };
      });
    });
  }, [sources, app, project, type, query, range, state]);

  const coreOf = useCallback(
    (machine: string | null): CoreSource =>
      (sources.find((source) => source.machine === machine) ?? sources[0]!)
        .core,
    [sources],
  );

  const reload = useCallback(() => setTick((n) => n + 1), []);

  const publicState: HistoryState =
    state.status === "ready"
      ? {
          status: "ready",
          rows: state.rows,
          hasMore: state.hasMore,
          loadingMore: state.loadingMore,
        }
      : state;

  return { state: publicState, sources, coreOf, loadMore, reload };
}
