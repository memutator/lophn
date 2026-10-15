// Agent 탭이 core의 현재 기록을 읽어 맞추는 일. 열린 session의 agent event(useSessionEvents)를 받아 줄을 이어
// 붙이고, thread snapshot은 처음과 다시 붙을 때(와 turn이 끝났을 때)만 읽는다. 끊기면 마지막 내용과 확인 시각을 둔다.
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

// ---- event를 줄로 접는 규칙 ----

/** event만으로는 알 수 없는 것을 아는 대로 채운다. */
export interface FoldContext {
  /** 보낸 session의 role. 모르면 chip은 이름 없이 그려지고 누르면 읽는다. */
  readonly roleOf: (session: string) => AgentRole | null;
}

const running = (turn: TurnView | null) =>
  turn !== null && turn.phase !== "ended";

function has(view: ThreadView, id: string): boolean {
  return view.entries.some((entry) => entry.id === id) ||
    view.queued.some((queued) => queued.id === id);
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
  const phase = view.pending.approval !== null ||
      view.pending.questions !== null
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
 * - TurnStarted: 그 입력 메시지를 줄로 올리고 turn을 연다.
 * - TurnEnded: 응답 글(`messages`)과 꼬리를 붙인다. 실패하고 오류가 있으면 꼬리 대신 오류 줄이다.
 * - ToolCall*: tool 이름만 아는 줄. call과 ask는 전용 카드가 그리므로 줄을 만들지 않는다.
 * - Permission*·Question*: `pending`과 결과 줄. 질문 내용은 event에 없어 따로 읽는다.
 * 모자란 칸(편집 카드, call 블록, 답 내용)은 turn이 끝난 뒤 snapshot을 다시 읽어 채운다.
 */
export function foldEvent(
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
      };
      const next: ThreadView = {
        ...view,
        turn: started,
        queued: view.queued.filter((item) => item.id !== input_message),
        entries: queued === undefined ? view.entries : [
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
      return {
        ...next,
        entries: next.entries.map((entry) =>
          entry.kind === "message" && entry.id === input_message
            ? { ...entry, turn }
            : entry
        ),
      };
    }
    case "TurnEnded": {
      const { turn, outcome, messages, error } = event.payload;
      const startedAt = view.turn?.id === turn ? view.turn.startedAt : null;
      const durationMs = startedAt === null
        ? 0
        : Math.max(0, Date.parse(event.at) - Date.parse(startedAt));
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
      const tail: ThreadEntry = outcome.kind === "failed" && error !== null
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
          outcome: outcome.kind === "completed"
            ? "completed"
            : outcome.kind === "failed"
            ? "failed"
            : "stopped",
          durationMs,
        };
      return withEntries({
        ...view,
        turn: { id: turn, phase: "ended", startedAt },
        tasks: [],
        pending: { approval: null, questions: null },
      }, [...answers, tail]);
    }
    case "ToolCallStarted": {
      const { tool_call, tool } = event.payload;
      if (tool === "ask" || tool === "call") return view;
      return withEntries(view, [{
        kind: "tools",
        id: tool_call,
        at: event.at,
        tool: { id: tool_call, label: tool, lines: [] },
      }]);
    }
    case "PermissionRequested": {
      const { id, intent, choices } = event.payload.request;
      return settle({
        ...view,
        pending: { ...view.pending, approval: { id, intent, choices } },
      });
    }
    case "PermissionResolved": {
      const { request, outcome } = event.payload;
      const approval = view.pending.approval;
      if (approval?.id !== request) return view;
      return settle(withEntries({
        ...view,
        pending: { ...view.pending, approval: null },
      }, [{
        kind: "approval-result",
        id: request,
        at: event.at,
        result: {
          request,
          intent: approval.intent,
          outcome: outcome === "allow"
            ? "received"
            : outcome === "reject"
            ? "denied"
            : "cancelled",
          choice: null,
          reason: null,
        },
      }]));
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
      return settle(withEntries({
        ...view,
        pending: { ...view.pending, questions: null },
      }, [{
        kind: "questions",
        id: group,
        at: event.at,
        group,
        outcome,
        lines: (asked.questions ?? []).map((question) => ({
          header: question.header,
          answer: null,
        })),
      }]));
    }
    default:
      return view;
  }
}

export function foldEvents(
  view: ThreadView,
  events: readonly AgentEvent[],
  ctx: FoldContext,
): ThreadView {
  return events.reduce((next, event) => foldEvent(next, event, ctx), view);
}

// ---- hook ----

export type TabConnection = "loading" | "live" | "reconnecting";

/** useSessions의 상태를 목록의 점으로 옮긴다. */
function statusOf(known: KnownSession): SessionStatus {
  return known.state === "waiting"
    ? "waiting"
    : known.state === "running"
    ? "working"
    : "idle";
}

export interface AgentTabList {
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
    const token = sequence.current += 1;
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
}

/** 열린 session 하나의 화면 값. snapshot은 처음과 다시 붙을 때, turn이 끝났을 때 읽고 그 사이는 event를 접는다. */
export function useAgentTabData(
  source: AgentTabSource,
  session: string,
  now: () => number = Date.now,
): AgentTabData {
  const list = useAgentTabList(source);
  const live = useSessionEvents(session);
  const known = useSessions().sessions;
  const [base, setBase] = useState<
    { session: string; view: ThreadView; mark: number } | null
  >(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [threadFailed, setThreadFailed] = useState(false);
  const [gone, setGone] = useState(false);
  const [asked, setAsked] = useState<
    ReadonlyMap<string, readonly AskedQuestion[]>
  >(new Map());
  const sequence = useRef(0);
  // 읽기를 시작한 때 이미 쌓인 event는 그 snapshot이 담고 있다.
  const eventCount = useRef(0);
  eventCount.current = live.events.length;

  const readThread = useCallback(async () => {
    const token = sequence.current += 1;
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
  useEffect(() => source.changed?.(() => void readThread()), [
    source,
    readThread,
  ]);

  // 끊겼다 다시 붙으면 놓친 진행을 하나씩 다시 보이지 않고 현재 기록으로 맞춘다.
  const previous = useRef(live.status);
  useEffect(() => {
    if (previous.current === "reconnecting" && live.status === "live") {
      void readThread();
    }
    previous.current = live.status;
  }, [live.status, readThread]);

  // event가 싣지 못한 줄(편집 카드, call 블록, 답)은 turn이 끝났을 때 한 번 읽어 채운다.
  const ended = live.events.filter((event) => event.type === "TurnEnded")
    .length;
  const seenEnded = useRef(ended);
  useEffect(() => {
    if (ended > seenEnded.current) void readThread();
    seenEnded.current = ended;
  }, [ended, readThread]);

  const ctx = useMemo<FoldContext>(() => ({
    roleOf: (other) => {
      const role = known.find((one) => one.session === other)?.agent?.role;
      return role === undefined || role === "coding_agent" ? null : role;
    },
  }), [known]);

  const folded = useMemo(
    () =>
      base === null || base.session !== session
        ? null
        : foldEvents(base.view, live.events.slice(base.mark), ctx),
    [base, session, live.events, ctx],
  );

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
    const filled = questions?.questions === null
      ? asked.get(questions.toolCall)
      : undefined;
    return filled === undefined || questions === null ? folded : {
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
    connection: live.status,
    checkedAt,
    failed: list.failed || threadFailed,
    gone,
  };
}
