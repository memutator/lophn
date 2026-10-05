// 도크 테스트의 ConversationSource. 기록을 메모리에 두고 연결 상태와 보내기 답을 테스트가 정한다.
import type { ConnectionState } from "../../desktop/connection/connection.ts";
import type {
  Agent,
  ConversationSource,
  MessageRow,
  RunRow,
  SendInput,
  SessionRow,
  SourceResult,
  WorkPlace,
} from "../source.ts";

export const AGENT: Agent = {
  id: "asg_01h455vb4pex5v6nkc6gd5fdw1",
  state: "enabled",
  revision: 1,
};

export function sessionId(n: number): string {
  return `ses_01h455vb4pex5v6nkc6gd5fd${String(n).padStart(2, "0")}`;
}

export function messageId(n: number): string {
  return `msg_01h455vb4pex5v6nkc6gd5f${String(n).padStart(3, "0")}`;
}

export function runId(n: number): string {
  return `run_01h455vb4pex5v6nkc6gd5fd${String(n).padStart(2, "0")}`;
}

export function agentMessage(
  n: number,
  results: MessageRow["results"] = [],
): MessageRow {
  return {
    id: messageId(n),
    actor: "agent",
    body: String(n).padStart(64, "0"),
    run: null,
    mode: null,
    applied: false,
    results,
  };
}

export interface FakeState {
  agent: Agent | null;
  sessions: SessionRow[];
  messages: Record<string, MessageRow[]>;
  runs: RunRow[];
  titles: Record<string, string>;
  /** 다음 보내기 답. 비면 접수한다. */
  replies: SourceResult<void>[];
  /** 읽기를 실패시킨다(연결 끊김). */
  readsFail: boolean;
  /** 있으면 보내기 답을 이것이 풀릴 때까지 미룬다. */
  gate: Promise<void> | null;
  sent: SendInput[];
  opened: { id: string; workPlace: WorkPlace }[];
  stopped: string[];
  reads: number;
}

export function fakeSource(initial: Partial<FakeState> = {}) {
  const state: FakeState = {
    agent: AGENT,
    sessions: [{ id: sessionId(1), state: "open", stateSeq: "10" }],
    messages: {},
    runs: [],
    titles: {},
    replies: [],
    readsFail: false,
    gate: null,
    sent: [],
    opened: [],
    stopped: [],
    reads: 0,
    ...initial,
  };
  const listeners = new Set<(state: ConnectionState) => void>();
  let connection: ConnectionState = { state: "ready", confirmedAt: 1 };

  function read<T>(value: () => T): Promise<SourceResult<T>> {
    state.reads += 1;
    if (state.readsFail) {
      return Promise.resolve({ ok: false, code: "unavailable" });
    }
    return Promise.resolve({ ok: true, value: value() });
  }

  const source: ConversationSource = {
    watch(listener) {
      listeners.add(listener);
      listener(connection);
      return () => listeners.delete(listener);
    },
    agent: () => read(() => state.agent),
    sessions: () => read(() => [...state.sessions]),
    messages: (session) => read(() => [...(state.messages[session] ?? [])]),
    runs: () => read(() => [...state.runs]),
    openSession({ id, workPlace }) {
      state.opened.push({ id, workPlace });
      const session: SessionRow = { id, state: "open", stateSeq: "20" };
      state.sessions.push(session);
      return Promise.resolve({ ok: true, value: session });
    },
    async send(input) {
      state.sent.push(input);
      if (state.gate) await state.gate;
      const reply = state.replies.shift() ?? { ok: true, value: undefined };
      if (reply.ok) {
        const list = state.messages[input.session.id] ?? [];
        if (!list.some((message) => message.id === input.id)) {
          list.push({
            id: input.id,
            actor: "user",
            body: input.body,
            run: input.mode === "correction" ? input.run : runId(9),
            mode: input.mode,
            applied: false,
            results: [],
          });
        }
        state.messages[input.session.id] = list;
      }
      return reply;
    },
    stop(run) {
      state.stopped.push(run.id);
      state.runs = state.runs.map((item) =>
        item.id === run.id
          ? { ...item, state: "finished", outcome: "stopped" }
          : item
      );
      return Promise.resolve({ ok: true, value: undefined });
    },
    documentTitle: (document) =>
      Promise.resolve(
        state.titles[document] === undefined
          ? { ok: false, code: "not_found" }
          : { ok: true, value: state.titles[document]! },
      ),
  };

  return {
    source,
    state,
    connect(next: ConnectionState) {
      connection = next;
      for (const listener of listeners) listener(next);
    },
  };
}

/** 테스트가 직접 부르는 다시 읽기 박자. */
export function manualTicks() {
  const listeners = new Set<() => void>();
  return {
    ticks: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    tick() {
      for (const listener of listeners) listener();
    },
  };
}
