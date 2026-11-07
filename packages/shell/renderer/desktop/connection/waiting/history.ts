// History(영구 기록) 읽기. 정본은 core의 `notices.list`다. 탭을 열 때와 거르기가 바뀔 때 첫 page를 읽고, [Load more]가 cursor로 잇는다.
// 새 영구 줄(NoticePosted)은 첫 page를 다시 읽고, 읽음(NoticeRead)은 있는 줄만 고친다.
import { useCallback, useEffect, useState } from "react";
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
import { useEventClient } from "../events/hooks.tsx";

const PAGE = 30;

/** 종류 거르기. all은 거르지 않고, app·program은 출처, 나머지는 program 종류 하나다. core `kind`가 하나만 받아 묶음은 출처까지다. */
export type TypeFilter = "all" | "app" | "program" | NoticeKind;

export interface HistoryFilter {
  readonly app: string | null;
  readonly project: string | null;
  readonly type: TypeFilter;
  readonly query: string;
}

export const NO_FILTER: HistoryFilter = {
  app: null,
  project: null,
  type: "all",
  query: "",
};

/** 거르기 선택지 순서. 사람이 찾는 것(release)을 앞에 둔다. */
export const TYPE_OPTIONS: readonly TypeFilter[] = [
  "all",
  "app",
  "program",
  ...PROGRAM_NOTICE_KINDS,
];

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

type State =
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | {
      readonly status: "ready";
      readonly rows: readonly Notice[];
      readonly next: string | null;
    };

export interface History {
  readonly state: State;
  readonly loadMore: () => void;
  readonly reload: () => void;
}

export function useHistory(filter: HistoryFilter): History {
  const client = useEventClient();
  const core = client.core;
  const [state, setState] = useState<State>({ status: "loading" });
  const [tick, setTick] = useState(0);
  const { app, project, type, query } = filter;

  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    void readPage(core, { app, project, type, query }, null).then((page) => {
      if (!live) return;
      setState(
        page === null
          ? { status: "failed" }
          : { status: "ready", rows: page.notices, next: page.next },
      );
    });
    return () => {
      live = false;
    };
  }, [core, app, project, type, query, tick]);

  useEffect(
    () =>
      client.subscribe({ types: ["NoticePosted", "NoticeRead"] }, (message) => {
        if (message.kind !== "event") return;
        const event = message.event;
        if (event.type === "NoticePosted") {
          if (event.payload.persistent) setTick((n) => n + 1);
        } else if (event.type === "NoticeRead") {
          const { id, read_at } = event.payload;
          setState((now) =>
            now.status === "ready"
              ? {
                  ...now,
                  rows: now.rows.map((row) =>
                    row.id === id ? { ...row, read_at } : row,
                  ),
                }
              : now,
          );
        }
      }),
    [client],
  );

  const loadMore = useCallback(() => {
    if (state.status !== "ready" || state.next === null) return;
    const cursor = state.next;
    void readPage(core, { app, project, type, query }, cursor).then((page) => {
      if (page === null) return;
      setState((now) => {
        // 그 사이 거르기가 바뀌어 첫 page로 돌아갔으면 이어 붙이지 않는다.
        if (now.status !== "ready" || now.next !== cursor) return now;
        const seen = new Set(now.rows.map((row) => row.id));
        return {
          status: "ready",
          rows: [...now.rows, ...page.notices.filter((r) => !seen.has(r.id))],
          next: page.next,
        };
      });
    });
  }, [core, app, project, type, query, state]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { state, loadMore, reload };
}
