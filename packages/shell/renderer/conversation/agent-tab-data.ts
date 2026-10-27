// Agent 탭이 core의 현재 기록을 읽어 맞추는 일. 열린 session의 agent event(useSessionEvents)를 받아 줄을 이어
// 붙이고, thread snapshot은 처음과 다시 붙을 때, turn이 끝났을 때, live 글의 offset이 맞지 않았을 때(gap)만 읽는다.
// 끊기면 마지막 내용과 확인 시각을 둔다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AgentEvent } from "../../../protocol/events/mod.ts";
import {
  useSessionEvents,
  useSessions,
} from "../desktop/connection/events/hooks.tsx";
import type { SessionEntry as KnownSession } from "../desktop/connection/events/sessions-store.ts";
import type {
  AgentFace,
  AgentRole,
  AgentTabSource,
  AskedQuestion,
  Sender,
  SessionEntry,
  SessionStatus,
  ThreadEntry,
  ThreadMessage,
  ThreadView,
  TurnView,
} from "./agent-tab-source.ts";
import { turnEndTimes } from "./agent-tab-source.ts";
import type { ToolCallView } from "./activity/model.ts";
import { toolEntriesOf } from "./activity/tool-groups.ts";
import { foldDelta } from "./live-text.ts";

// ---- event를 줄로 접는 규칙 ----

/** event만으로는 알 수 없는 것을 아는 대로 채운다. */
interface FoldContext {
  /** 보낸 session의 role. 모르면 chip은 이름 없이 그려지고 누르면 읽는다. */
  readonly roleOf: (session: string) => AgentRole | null;
}

const running = (turn: TurnView | null) =>
  turn !== null && turn.phase !== "ended";

function has(view: ThreadView, id: string): boolean {
  return (
    view.entries.some((entry) => entry.id === id) ||
    view.queued.some((queued) => queued.id === id)
  );
}

function withEntries(
  view: ThreadView,
  more: readonly ThreadEntry[],
): ThreadView {
  const fresh = more.filter((entry) => !has(view, entry.id));
  return fresh.length === 0
    ? view
    : { ...view, entries: [...view.entries, ...fresh] };
}

/** 사람이 답할 것이 남았으면 waiting이다. */
function settle(view: ThreadView): ThreadView {
  if (view.turn === null || view.turn.phase === "ended") return view;
  const phase =
    view.pending.approval !== null || view.pending.questions !== null
      ? "waiting"
      : "working";
  return phase === view.turn.phase
    ? view
    : { ...view, turn: { ...view.turn, phase } };
}

function senderOf(
  from: Extract<AgentEvent, { type: "MessageReceived" }>["payload"]["from"],
  ctx: FoldContext,
): Sender | null {
  switch (from.kind) {
    case "human":
      return null;
    case "agent":
      return { kind: "agent", role: ctx.roleOf(from.session), name: null };
    case "coding_agent":
      return { kind: "coding", product: null };
    case "program":
      return { kind: "program", label: null };
  }
}

/**
 * event 하나를 줄에 접는다. 같은 event를 두 번 접어도 같은 결과다(id로 한 번만 든다).
 * - MessageReceived: 사람이 도는 중에 다음 turn으로 보낸 것은 `queued`에, 나머지는 줄에 든다.
 * - TurnStarted: 그 입력 메시지를 줄로 올리고 turn을 연다. 다른 turn의 live 글은 버린다.
 * - TurnResumed: 마지막 사람 기다림이 닫혀 다시 도는 순간이다. 그 turn의 elapsed를 event의 active와 at으로 맞춘다.
 * - TurnEnded: 응답 글(`messages`)과 꼬리를 붙이고 그 turn의 live 글을 버린다. 실패하고 오류가 있으면 꼬리
 *   대신 오류 줄이다.
 * - ModelOutputStreamed: 그 model 호출의 live 글을 delta로 잇는다. offset이 앞 글 길이를 넘으면 gap을 세운다.
 *   이미 저장된 model 호출이나 끝난 turn의 늦은 조각은 버린다.
 * - MessageRecorded: agent message 줄 하나를 더하고 그 model 호출의 live 글을 버린다. 줄의 `text`는 그때의
 *   live 글이라 본문을 읽기 전에 빈 자리가 없다.
 * - ToolCallStarted·ToolCallEnded: tool 줄은 snapshot과 같은 묶기 함수(`toolEntriesOf`)로 묶는다. ask·call·
 *   edit/write는 줄을 만들지 않는다. 그 turn의 live 글은 버린다(글이 있는 응답은 tool보다 먼저 저장되어
 *   `MessageRecorded`가 먼저 온다).
 * - TurnRequest*·Question*: `pending`과 결과 줄. harness 물음은 접지 않는다(coding 카드가 그린다). 질문 내용은
 *   event에 없어 따로 읽고, 허락 범위(once·always)도 event에 없어 결과 줄은 범위를 모른다.
 * 모자란 칸(편집 카드, call 블록, 답 내용)은 turn이 끝난 뒤 snapshot을 다시 읽어 채운다.
 */
function foldEvent(
  view: ThreadView,
  event: AgentEvent,
  ctx: FoldContext,
): ThreadView {
  switch (event.type) {
    case "MessageReceived": {
      const { message, body, from, call, reply_to, steer } = event.payload;
      if (has(view, message)) return view;
      const sender = senderOf(from, ctx);
      if (sender === null && !steer && running(view.turn)) {
        return {
          ...view,
          queued: [...view.queued, { id: message, at: event.at, text: body }],
        };
      }
      const entry: ThreadMessage = {
        kind: "message",
        id: message,
        at: event.at,
        actor: sender === null ? "user" : "received",
        sender,
        call,
        replyTo: reply_to,
        delivery: steer ? "steer" : "next_turn",
        turn: steer && running(view.turn) ? view.turn!.id : null,
        text: body,
      };
      return { ...view, entries: [...view.entries, entry] };
    }
    case "TurnStarted": {
      const { turn, input_message } = event.payload;
      const queued = view.queued.find((item) => item.id === input_message);
      const started: TurnView = {
        id: turn,
        phase: "working",
        startedAt: event.at,
        elapsed: { activeMs: 0, at: event.at },
      };
      const next: ThreadView = {
        ...view,
        turn: started,
        queued: view.queued.filter((item) => item.id !== input_message),
        entries:
          queued === undefined
            ? view.entries
            : [
                ...view.entries,
                {
                  kind: "message",
                  id: queued.id,
                  at: queued.at,
                  actor: "user",
                  sender: null,
                  call: null,
                  replyTo: null,
                  delivery: "next_turn",
                  turn,
                  text: queued.text,
                },
              ],
      };
      const stale =
        next.live !== null && next.live.turn !== turn
          ? next.live.modelCall
          : null;
      return {
        ...next,
        live: stale === null ? next.live : null,
        dropped:
          stale === null ? next.dropped : { ...next.dropped, modelCall: stale },
        entries: next.entries.map((entry) =>
          entry.kind === "message" && entry.id === input_message
            ? { ...entry, turn }
            : entry,
        ),
      };
    }
    case "ModelOutputStreamed": {
      const { turn, model_call: modelCall } = event.payload;
      // 저장됐거나 다음 호출로 바뀐 model 호출, 끝난 turn의 늦은 조각은 새 글이 아니다.
      if (view.dropped.modelCall === modelCall || view.dropped.turn === turn) {
        return view;
      }
      return {
        ...view,
        live: foldDelta(view.live, event.payload, event.at),
      };
    }
    case "MessageRecorded": {
      const { turn, message, model_call: modelCall } = event.payload;
      const live = view.live;
      return withEntries(
        {
          ...view,
          live: live?.modelCall === modelCall ? null : live,
          dropped: { ...view.dropped, modelCall },
        },
        [
          {
            kind: "message",
            id: message,
            at: event.at,
            actor: "agent",
            sender: null,
            call: null,
            replyTo: null,
            delivery: "next_turn",
            turn,
            text:
              live !== null && live.modelCall === modelCall && live.text !== ""
                ? live.text
                : null,
          },
        ],
      );
    }
    case "TurnResumed": {
      const { turn, active_ms } = event.payload;
      if (view.turn?.id !== turn) return view;
      return {
        ...view,
        turn: {
          ...view.turn,
          elapsed: { activeMs: active_ms, at: event.at },
        },
      };
    }
    case "TurnEnded": {
      const { turn, outcome, messages, error, active_ms } = event.payload;
      const startedAt = view.turn?.id === turn ? view.turn.startedAt : null;
      const times = turnEndTimes(startedAt, event.at, active_ms);
      const answers: ThreadEntry[] = messages.map((id) => ({
        kind: "message",
        id,
        at: event.at,
        actor: "agent",
        sender: null,
        call: null,
        replyTo: null,
        delivery: "next_turn",
        turn,
        text: null,
      }));
      const tail: ThreadEntry =
        outcome.kind === "failed" && error !== null
          ? {
              kind: "provider-error",
              id: `error-${turn}`,
              at: event.at,
              turn,
              code: error.code,
              message: error.message,
            }
          : {
              kind: "turn-end",
              id: `end-${turn}`,
              at: event.at,
              turn,
              outcome:
                outcome.kind === "completed"
                  ? "completed"
                  : outcome.kind === "failed"
                    ? "failed"
                    : "stopped",
              activeMs: times.activeMs,
              waitedMs: times.waitedMs,
            };
      return withEntries(
        {
          ...view,
          turn: { id: turn, phase: "ended", startedAt, elapsed: null },
          pending: { approval: null, questions: null },
          live: view.live?.turn === turn ? null : view.live,
          dropped: { ...view.dropped, turn },
        },
        [...answers, tail],
      );
    }
    case "ToolCallStarted": {
      const { tool_call: toolCall, tool, turn, display } = event.payload;
      const live =
        view.live !== null && view.live.turn === turn ? view.live : null;
      const cleared: ThreadView =
        live === null
          ? view
          : {
              ...view,
              live: null,
              dropped: { ...view.dropped, modelCall: live.modelCall },
            };
      if (
        tool === "ask" ||
        tool === "call" ||
        tool === "file.write" ||
        tool === "file.edit"
      )
        return cleared;
      // 같은 event를 두 번 접어도 같은 결과다.
      const known = cleared.entries.some(
        (entry) =>
          entry.kind === "tools" &&
          entry.calls.some((call) => call.id === toolCall),
      );
      if (known) return cleared;
      // 끝에 이어진 tools 줄에 이 call을 더해 다시 묶는다. 사이에 메시지가 있으면 거기서 묶음이 끊긴다.
      let from = cleared.entries.length;
      while (from > 0 && cleared.entries[from - 1]!.kind === "tools") from -= 1;
      const tail = cleared.entries.slice(from);
      const calls: ToolCallView[] = [
        ...tail.flatMap((entry) => (entry.kind === "tools" ? entry.calls : [])),
        {
          id: toolCall,
          tool,
          category: display.category,
          title: display.title,
          state: "running",
          startedAt: event.at,
          durationMs: null,
        },
      ];
      return {
        ...cleared,
        entries: [
          ...cleared.entries.slice(0, from),
          ...toolEntriesOf(calls, event.at),
        ],
      };
    }
    case "ToolCallEnded": {
      const { tool_call: toolCall, outcome } = event.payload;
      let found = false;
      const entries = view.entries.map((entry): ThreadEntry => {
        if (
          entry.kind !== "tools" ||
          !entry.calls.some((call) => call.id === toolCall)
        )
          return entry;
        found = true;
        return {
          ...entry,
          calls: entry.calls.map(
            (call): ToolCallView =>
              call.id !== toolCall
                ? call
                : {
                    ...call,
                    state: outcome,
                    durationMs:
                      call.startedAt === null
                        ? null
                        : Math.max(
                            0,
                            Date.parse(event.at) - Date.parse(call.startedAt),
                          ),
                  },
          ),
        };
      });
      return found ? { ...view, entries } : view;
    }
    case "TurnRequestOpened": {
      const { id, subject, always_patterns } = event.payload.request;
      if (subject.kind === "harness") return view;
      return settle({
        ...view,
        pending: {
          ...view.pending,
          approval: { id, subject, always_patterns },
        },
      });
    }
    case "TurnRequestClosed": {
      const { request, outcome } = event.payload;
      const approval = view.pending.approval;
      if (approval?.id !== request) return view;
      return settle(
        withEntries(
          {
            ...view,
            pending: { ...view.pending, approval: null },
          },
          [
            {
              kind: "approval-result",
              id: request,
              at: event.at,
              result: {
                request,
                subject: approval.subject,
                outcome:
                  outcome === "allow"
                    ? "allowed"
                    : outcome === "reject"
                      ? "denied"
                      : "cancelled",
                choice: null,
                reason: null,
              },
            },
          ],
        ),
      );
    }
    case "QuestionAsked": {
      const { group, tool_call } = event.payload;
      if (view.pending.questions?.group === group) return view;
      return settle({
        ...view,
        pending: {
          ...view.pending,
          questions: { group, toolCall: tool_call, questions: null },
        },
      });
    }
    case "QuestionResolved": {
      const { group, outcome } = event.payload;
      const asked = view.pending.questions;
      if (asked?.group !== group) return view;
      return settle(
        withEntries(
          {
            ...view,
            pending: { ...view.pending, questions: null },
          },
          [
            {
              kind: "questions",
              id: group,
              at: event.at,
              group,
              outcome,
              lines: (asked.questions ?? []).map((question) => ({
                header: question.header,
                answer: null,
              })),
            },
          ],
        ),
      );
    }
    default:
      return view;
  }
}

function foldEvents(
  view: ThreadView,
  events: readonly AgentEvent[],
  ctx: FoldContext,
): ThreadView {
  return events.reduce((next, event) => foldEvent(next, event, ctx), view);
}

// ---- hook ----

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
  /** event가 알리지 않는 변경(rewind 등) 뒤에 현재 기록을 다시 읽는다. */
  readonly reload: () => Promise<void>;
}

/** 열린 session 하나의 화면 값. snapshot은 처음과 다시 붙을 때, turn이 끝났을 때, live 글의 offset이 맞지 않았을 때(gap)만 읽고 그 사이는 event를 접는다. */
export function useAgentTabData(
  source: AgentTabSource,
  session: string,
  now: () => number = Date.now,
): AgentTabData {
  const list = useAgentTabList(source);
  const stream = useSessionEvents(session);
  const known = useSessions().sessions;
  const [base, setBase] = useState<{
    session: string;
    view: ThreadView;
    mark: number;
  } | null>(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [threadFailed, setThreadFailed] = useState(false);
  const [gone, setGone] = useState(false);
  const [asked, setAsked] = useState<
    ReadonlyMap<string, readonly AskedQuestion[]>
  >(new Map());
  const sequence = useRef(0);
  // 읽기를 시작한 때 이미 쌓인 event는 그 snapshot이 담고 있다.
  const eventCount = useRef(0);
  eventCount.current = stream.count;
  // 접은 결과와 접은 개수를 기억해 새 event만 접는다. delta가 초당 여럿 와도 앞 event를 다시 접지 않는다.
  const foldedRef = useRef<{
    base: ThreadView;
    ctx: FoldContext;
    upTo: number;
    view: ThreadView;
  } | null>(null);

  const readThread = useCallback(async () => {
    const token = (sequence.current += 1);
    const mark = eventCount.current;
    const result = await source.thread(session);
    if (token !== sequence.current) return;
    if (result.ok) {
      setBase({ session, view: result.value, mark });
      setCheckedAt(now());
      setThreadFailed(false);
      setGone(false);
    } else if (result.code === "not_found") setGone(true);
    else setThreadFailed(true);
  }, [source, session, now]);

  useEffect(() => {
    void readThread();
  }, [readThread]);
  useEffect(
    () => source.changed?.(() => void readThread()),
    [source, readThread],
  );

  // 끊겼다 다시 붙으면 놓친 진행을 하나씩 다시 보이지 않고 현재 기록으로 맞춘다.
  const previous = useRef(stream.status);
  useEffect(() => {
    if (previous.current === "reconnecting" && stream.status === "live") {
      void readThread();
    }
    previous.current = stream.status;
  }, [stream.status, readThread]);

  // event가 싣지 못한 줄(편집 카드, call 블록, 답)은 turn이 끝났을 때 한 번 읽어 채운다.
  const seen = useRef(0);
  useEffect(() => {
    if (
      stream.since(seen.current).some((event) => event.type === "TurnEnded")
    ) {
      void readThread();
    }
    seen.current = stream.count;
  }, [stream, readThread]);

  const ctx = useMemo<FoldContext>(
    () => ({
      roleOf: (other) => {
        const role = known.find((one) => one.session === other)?.agent?.role;
        return role === undefined || role === "coding_agent" ? null : role;
      },
    }),
    [known],
  );

  const folded = useMemo(() => {
    if (base === null || base.session !== session) return null;
    const previous = foldedRef.current;
    // base와 ctx가 그대로면 앞 view에 새 event만 접는다. 둘이 바뀌면 snapshot 뒤의 event를 다시 접는다.
    const view =
      previous !== null && previous.base === base.view && previous.ctx === ctx
        ? foldEvents(previous.view, stream.since(previous.upTo), ctx)
        : foldEvents(base.view, stream.since(base.mark), ctx);
    foldedRef.current = { base: base.view, ctx, upTo: stream.count, view };
    return view;
  }, [base, session, ctx, stream]);

  // offset이 맞지 않았다. 그 model 호출에서 한 번만 다시 읽는다. 그러고도 맞지 않으면 그 응답의
  // `MessageRecorded` 본문이 맞추므로 읽기를 되풀이하는 고리를 만들지 않는다.
  const gap = folded?.live?.gap === true ? folded.live.modelCall : null;
  useEffect(() => {
    if (gap !== null) void readThread();
  }, [gap, readThread]);

  // 질문 내용은 event에 없다. 대기 중인 묶음이 생기면 한 번 읽는다.
  const waiting = folded?.pending.questions ?? null;
  const waitingTool = waiting?.questions === null ? waiting.toolCall : null;
  useEffect(() => {
    if (waitingTool === null || asked.has(waitingTool)) return;
    void source.questions(session, waitingTool).then((result) => {
      if (result.ok) {
        setAsked((state) => new Map(state).set(waitingTool, result.value));
      }
    });
  }, [source, session, waitingTool, asked]);

  const thread = useMemo(() => {
    if (folded === null) return null;
    const questions = folded.pending.questions;
    const filled =
      questions?.questions === null ? asked.get(questions.toolCall) : undefined;
    return filled === undefined || questions === null
      ? folded
      : {
          ...folded,
          pending: {
            ...folded.pending,
            questions: { ...questions, questions: filled },
          },
        };
  }, [folded, asked]);

  return {
    ...list,
    thread,
    connection: stream.status,
    checkedAt,
    failed: list.failed || threadFailed,
    gone,
    reload: readThread,
  };
}
