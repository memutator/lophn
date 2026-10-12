// Agent 화면이 core의 현재 기록을 읽어 맞추는 일. 끊기면 마지막 내용과 확인 시각을 둔다.
import { useCallback, useEffect, useRef, useState } from "react";

import type { ConnectionState } from "../desktop/connection/connection.ts";
import type {
  AgentFace,
  AgentNotice,
  AgentViewSource,
  SessionEntry,
  ThreadView,
} from "./agent-source.ts";
import { messagesOf } from "./agent-view-model.ts";
import { loadBodies } from "./bodies.ts";
import type { DraftStore } from "./drafts.ts";

export type Ticks = (listener: () => void) => () => void;

/** 기본 박자. 열린 화면만 3초마다 현재 기록을 읽는다. */
export const POLL_MS = 3000;

export const intervalTicks: Ticks = (listener) => {
  const id = setInterval(listener, POLL_MS);
  return () => clearInterval(id);
};

export interface Loaded {
  /** undefined는 아직 읽지 않았다. null은 이 agent가 없다. */
  readonly agent: AgentFace | null | undefined;
  readonly sessions: readonly SessionEntry[];
  readonly thread: ThreadView | null;
  /** `thread`가 어느 session의 것인지. null이면 새 session이라 줄이 없다. */
  readonly threadSession: string | null | undefined;
  readonly notices: readonly AgentNotice[];
  /** 마지막으로 현재 기록을 확인한 시각. */
  readonly checkedAt: number | null;
  /** 마지막 읽기가 실패했다. 이전 내용은 그대로 둔다. */
  readonly failed: boolean;
}

const EMPTY: Loaded = {
  agent: undefined,
  sessions: [],
  thread: null,
  threadSession: undefined,
  notices: [],
  checkedAt: null,
  failed: false,
};

export interface AgentDataInput {
  source: AgentViewSource;
  drafts: DraftStore;
  /** 보고 있는 session. null은 아직 만들지 않은 새 session이다. */
  session: string | null;
  ticks: Ticks;
  now: () => number;
  /** 보던 session이 없어졌다. */
  onGone: () => void;
}

export interface AgentData {
  loaded: Loaded;
  connection: ConnectionState;
  refresh: () => Promise<void>;
}

export function useAgentData(input: AgentDataInput): AgentData {
  const { source, drafts, session, ticks } = input;
  const [loaded, setLoaded] = useState<Loaded>(EMPTY);
  const [connection, setConnection] = useState<ConnectionState>({
    state: "starting",
    confirmedAt: null,
  });
  // 읽는 동안 prop이 바뀌어도 callback 모양이 바뀌지 않게 한다.
  const latest = useRef(input);
  latest.current = input;
  // 늦게 온 옛 읽기 결과가 새 결과를 덮지 않게 한다.
  const sequence = useRef(0);

  const refresh = useCallback(async () => {
    const token = sequence.current += 1;
    const target = latest.current.session;
    const { now, onGone } = latest.current;
    const [agent, sessions, thread, notices] = await Promise.all([
      source.agent(),
      source.sessions(),
      target === null
        ? Promise.resolve({ ok: true, value: null } as const)
        : source.thread(target),
      source.notices(target),
    ]);
    if (token !== sequence.current) return;
    if (!agent.ok && agent.code === "not_found") {
      setLoaded({ ...EMPTY, agent: null, checkedAt: now() });
      return;
    }
    if (!agent.ok || !sessions.ok) {
      setLoaded((state) => ({ ...state, failed: true }));
      return;
    }
    if (!thread.ok) {
      if (thread.code === "not_found") onGone();
      else setLoaded((state) => ({ ...state, failed: true }));
      return;
    }
    if (target !== null && thread.value !== null) {
      const messages = messagesOf(thread.value);
      // 본문은 따로 읽는다. 목록 확인을 본문 읽기가 막지 않는다.
      void loadBodies(source, drafts, messages);
      // 접수 확인 안 된 말이 기록에 있으면 그것이 접수의 증거다.
      const outgoing = drafts.draft(target).outgoing;
      if (
        outgoing !== null && outgoing.phase !== "sending" &&
        messages.some((message) => message.id === outgoing.id)
      ) {
        drafts.sent(target, outgoing);
      }
    }
    setLoaded((state) => ({
      agent: agent.value,
      sessions: sessions.value,
      thread: thread.value,
      threadSession: target,
      // 안내를 읽지 못한 것은 대화를 못 읽은 것이 아니다. 마지막으로 읽은 안내를 둔다.
      notices: notices.ok ? notices.value : state.notices,
      checkedAt: now(),
      failed: false,
    }));
  }, [source, drafts]);

  useEffect(() => {
    let previous: ConnectionState["state"] | null = null;
    return source.watch((state) => {
      setConnection(state);
      // 다시 붙으면 놓친 진행을 하나씩 다시 보이지 않고 현재 기록으로 맞춘다.
      if (state.state === "ready" && previous !== "ready") void refresh();
      previous = state.state;
    });
  }, [source, refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh, session]);

  useEffect(
    () =>
      ticks(() => {
        if (connection.state === "ready") void refresh();
      }),
    [ticks, refresh, connection.state],
  );

  return { loaded, connection, refresh };
}
