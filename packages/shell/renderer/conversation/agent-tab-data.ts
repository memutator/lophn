// Agent 탭이 core의 현재 기록을 읽어 맞추는 일. ACP snapshot(`AcpState`)을 처음과 다시 붙을 때, `reread`가 설 때만
// 읽고 그 사이는 열린 session의 `AcpUpdated` 갱신을 `reduceAcp`로 접는다. 접은 상태를 줄로 늘어놓는 일은
// `thread-layout.ts`다. 끊기면 마지막 내용과 확인 시각을 둔다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type AcpState,
  type AcpUpdate,
  reduceAcp,
} from "../../../protocol/acp/mod.ts";
import {
  useAcpUpdates,
  useSessions,
} from "../desktop/connection/events/hooks.tsx";
import type { SessionEntry as KnownSession } from "../desktop/connection/events/sessions-store.ts";
import type {
  AgentFace,
  AgentTabSource,
  SessionEntry,
  SessionStatus,
  ThreadView,
} from "./agent-tab-source.ts";
import { createLayoutCache, layoutOf } from "./thread-layout.ts";

type TabConnection = "loading" | "live" | "reconnecting";

/** useSessions의 상태를 목록의 점으로 옮긴다. */
function statusOf(known: KnownSession): SessionStatus {
  return known.state === "waiting"
    ? "waiting"
    : known.state === "running"
      ? "working"
      : "idle";
}

interface AgentTabList {
  /** undefined는 아직 읽지 않았다. null은 이 agent가 없다. */
  readonly agent: AgentFace | null | undefined;
  readonly sessions: readonly SessionEntry[];
  /** 마지막 읽기가 실패했다. 이전 내용은 그대로 둔다. */
  readonly failed: boolean;
  /** 이름을 바꾸는 등 event가 없는 변경 뒤에 다시 읽는다. */
  readonly refresh: () => Promise<void>;
}

/** 열린 session이 없는 화면(새 대화)이 쓴다. session 목록은 session 상태 store가 바뀔 때 다시 읽는다. */
export function useAgentTabList(source: AgentTabSource): AgentTabList {
  const known = useSessions().sessions;
  const [read, setRead] = useState<{
    agent: AgentFace | null | undefined;
    sessions: readonly SessionEntry[];
    failed: boolean;
  }>({ agent: undefined, sessions: [], failed: false });
  const sequence = useRef(0);

  const refresh = useCallback(async () => {
    const token = (sequence.current += 1);
    const [agent, sessions] = await Promise.all([
      source.agent(),
      source.sessions(),
    ]);
    if (token !== sequence.current) return;
    if (!agent.ok && agent.code === "not_found") {
      setRead({ agent: null, sessions: [], failed: false });
    } else if (!agent.ok || !sessions.ok) {
      setRead((state) => ({ ...state, failed: true }));
    } else {
      setRead({ agent: agent.value, sessions: sessions.value, failed: false });
    }
  }, [source]);

  // 새 session이 생기거나 끝나면 목록도 바뀐다.
  const membership = known.map((one) => `${one.session}:${one.ended}`).join();
  useEffect(() => {
    void refresh();
  }, [refresh, membership]);
  useEffect(() => source.changed?.(() => void refresh()), [source, refresh]);

  const sessions = useMemo(() => {
    const byId = new Map(known.map((one) => [one.session, one]));
    return read.sessions.map((entry) => {
      const one = byId.get(entry.id);
      return one === undefined ? entry : { ...entry, status: statusOf(one) };
    });
  }, [read.sessions, known]);

  return { agent: read.agent, sessions, failed: read.failed, refresh };
}

export interface AgentTabData extends AgentTabList {
  /** null은 아직 읽지 않았다. */
  readonly thread: ThreadView | null;
  readonly connection: TabConnection;
  /** 마지막으로 현재 기록을 확인한 시각. */
  readonly checkedAt: number | null;
  /** 보던 session이 없어졌다. */
  readonly gone: boolean;
  /** 갱신이 알리지 않는 변경(rewind 등) 뒤에 현재 기록을 다시 읽는다. */
  readonly reload: () => Promise<void>;
}

/** 열린 session 하나의 화면 값. snapshot은 처음과 다시 붙을 때, `reread`가 설 때만 읽고 그 사이는 갱신을 접는다. */
export function useAgentTabData(
  source: AgentTabSource,
  session: string,
  now: () => number = Date.now,
): AgentTabData {
  const list = useAgentTabList(source);
  const stream = useAcpUpdates(session);
  const [base, setBase] = useState<{
    session: string;
    state: AcpState;
    mark: number;
  } | null>(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [threadFailed, setThreadFailed] = useState(false);
  const [gone, setGone] = useState(false);
  const sequence = useRef(0);
  // 읽기를 시작한 때 이미 쌓인 갱신은 그 snapshot이 담고 있다.
  const updateCount = useRef(0);
  updateCount.current = stream.count;
  // 접은 결과와 접은 개수를 기억해 새 갱신만 접는다. delta가 초당 여럿 와도 앞 갱신을 다시 접지 않는다.
  const foldedRef = useRef<{
    base: AcpState;
    upTo: number;
    state: AcpState;
  } | null>(null);
  const layoutCache = useRef(createLayoutCache());

  const readAcp = useCallback(async () => {
    const token = (sequence.current += 1);
    const mark = updateCount.current;
    const result = await source.acp(session);
    if (token !== sequence.current) return;
    if (result.ok) {
      setBase({ session, state: result.value, mark });
      setCheckedAt(now());
      setThreadFailed(false);
      setGone(false);
    } else if (result.code === "not_found") setGone(true);
    else setThreadFailed(true);
  }, [source, session, now]);

  useEffect(() => {
    void readAcp();
  }, [readAcp]);
  useEffect(() => source.changed?.(() => void readAcp()), [source, readAcp]);

  // 끊겼다 다시 붙으면 놓친 갱신을 하나씩 다시 보이지 않고 현재 기록으로 맞춘다.
  const previous = useRef(stream.status);
  useEffect(() => {
    if (previous.current === "reconnecting" && stream.status === "live") {
      void readAcp();
    }
    previous.current = stream.status;
  }, [stream.status, readAcp]);

  // 조건이 다시 걸려(다른 구독자가 생기거나 사라져도 걸린다) ready가 또 오면 그 사이 놓친 갱신이 있을 수 있다.
  // 끊김으로 나타나지 않으니 맞춘 횟수가 늘 때마다 현재 기록으로 다시 맞춘다. 처음 맞춤은 위의 첫 읽기가 맡는다.
  const syncedBefore = useRef(stream.synced);
  useEffect(() => {
    if (stream.synced > syncedBefore.current && syncedBefore.current > 0) {
      void readAcp();
    }
    syncedBefore.current = stream.synced;
  }, [stream.synced, readAcp]);

  const folded = useMemo(() => {
    if (base === null || base.session !== session) return null;
    const known = foldedRef.current;
    const fold = (state: AcpState, updates: readonly AcpUpdate[]) =>
      updates.reduce(reduceAcp, state);
    const state =
      known !== null && known.base === base.state
        ? fold(known.state, stream.since(known.upTo))
        : fold(base.state, stream.since(base.mark));
    foldedRef.current = { base: base.state, upTo: stream.count, state };
    return state;
  }, [base, session, stream]);

  // 순번이 빠졌거나 글의 offset이 맞지 않았다. 현재 기록으로 맞춘다. 읽고도 같은 까닭으로 서 있으면 값이 그대로라
  // 다시 읽지 않으므로 읽기를 되풀이하는 고리를 만들지 않는다(글 조각의 어긋남은 `message_recorded`가 맞춘다).
  const reread = folded?.reread === true;
  useEffect(() => {
    if (reread) void readAcp();
  }, [reread, readAcp]);

  const thread = useMemo<ThreadView | null>(
    () => (folded === null ? null : layoutOf(folded, layoutCache.current)),
    [folded],
  );

  return {
    ...list,
    thread,
    connection: stream.status,
    checkedAt,
    failed: list.failed || threadFailed,
    gone,
    reload: readAcp,
  };
}
