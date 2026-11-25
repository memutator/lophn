// 터미널 탭이 core의 `terminals/*` route와 터미널 event를 부르는 길. 기계 묶음마다 하나다. 입력·다시 시작은 여기 없다: 이 컴퓨터는
// 그 창의 focus를 본 shell main이 capability를 실어 부르고, 다른 기계는 그 기계의 core로 간다(`TerminalApi`, `machine-deps.ts`).
import type { z } from "zod";

import type { Route } from "../../../protocol/base/route.ts";
import { codingSessionsForget } from "../../../protocol/coding-agent/relay.ts";
import {
  type TerminalAgentSession,
  type TerminalFailure,
  type TerminalOutput,
  type TerminalRuntime,
  terminalFailureSchema,
  terminalsClose,
  terminalsList,
  terminalsName,
  terminalsOpen,
  terminalsRenameSaved,
  terminalsResize,
  terminalsSavedSessions,
  terminalsSnapshot,
  terminalsWatch,
} from "../../../protocol/coding-agent/terminals.ts";
import type { CoreSource } from "../desktop/connection/connection.ts";
import type {
  EventClient,
  EventMessage,
} from "../desktop/connection/events/client.ts";

/** route의 답. 거절은 오류 code와 터미널을 열지 못한 이유(`details.reason`, 없으면 null)다. */
export type TerminalReply<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly code: string;
      readonly reason: TerminalFailure | null;
    };

export type TerminalOpenInput = z.input<(typeof terminalsOpen)["input"]>;
type RenameSaved = z.input<(typeof terminalsRenameSaved)["input"]>;

export interface TerminalCore {
  /** 창의 event 연결. 터미널 event와 coding session 목록을 이 연결로 받는다. */
  readonly events: EventClient;
  open(
    input: TerminalOpenInput,
  ): Promise<TerminalReply<{ terminal: string; runtime: TerminalRuntime }>>;
  close(
    terminal: string,
    generation: number,
  ): Promise<TerminalReply<TerminalRuntime>>;
  resize(
    terminal: string,
    generation: number,
    columns: number,
    rows: number,
  ): Promise<TerminalReply<TerminalRuntime>>;
  snapshot(
    terminal: string,
    afterSeq: number,
  ): Promise<
    TerminalReply<{ runtime: TerminalRuntime; output: TerminalOutput[] }>
  >;
  /** 이 창의 출력 lease를 잡거나 놓는다. 잡은 동안 10초마다 다시 부른다(`TerminalDisplays`). */
  watch(terminal: string, on: boolean): Promise<TerminalReply<unknown>>;
  /** 탭 줄에 보이는 이름. 알림 제목과 다른 창이 쓴다. */
  name(terminal: string, name: string): Promise<TerminalReply<unknown>>;
  /** 지금 core가 가진 터미널. 못 읽으면 null이다. */
  list(): Promise<TerminalRuntime[] | null>;
  savedSessions(project: string): Promise<TerminalAgentSession[] | null>;
  renameSaved(input: RenameSaved): Promise<TerminalAgentSession[] | null>;
  /** 사람이 Recent에서 지운 coding session을 저장 목록에서 빼고(tombstone) 연결된 팀원 session도 보관한다. CLI 원본 대화는 그대로다. */
  forgetSaved(input: {
    project: string;
    harness: string;
    cli_session: string;
  }): Promise<void>;
  /** `TerminalOutputAppended`·`TerminalRuntimeChanged`와 연결의 ready·끊김. 해지를 돌려준다. */
  subscribe(listener: (message: EventMessage) => void): () => void;
}

// 창마다 다른 lease key. core는 (principal, watcher)로 lease를 나눠, 같은 사람의 두 창이 서로의 lease를 놓지 않는다.
function newWatcher(): string {
  return `window-${crypto.randomUUID()}`;
}

/** 그 core의 route 하나를 부르고 답을 `TerminalReply`로 바꾼다. 던지면 unavailable이다. */
export function terminalCaller(core: CoreSource) {
  return async function call<T>(
    route: Route,
    body: unknown,
  ): Promise<TerminalReply<T>> {
    try {
      const reply = await core.call({
        kind: route.kind,
        resource: route.resource,
        method: route.method,
        body,
      });
      if (reply.ok) return { ok: true, value: reply.value as T };
      const reason = terminalFailureSchema.safeParse(
        reply.error?.details?.reason,
      );
      return {
        ok: false,
        code: reply.error?.code ?? "unavailable",
        reason: reason.success ? reason.data : null,
      };
    } catch {
      return { ok: false, code: "unavailable", reason: null };
    }
  };
}

export function createTerminalCore(
  core: CoreSource,
  events: EventClient,
  watcher: string = newWatcher(),
): TerminalCore {
  const call = terminalCaller(core);
  const runtimeOf = async (
    sent: Promise<TerminalReply<{ runtime: TerminalRuntime }>>,
  ): Promise<TerminalReply<TerminalRuntime>> => {
    const reply = await sent;
    return reply.ok ? { ok: true, value: reply.value.runtime } : reply;
  };
  return {
    events,
    open: (input) => call(terminalsOpen as Route, input),
    close: (terminal, generation) =>
      runtimeOf(call(terminalsClose as Route, { terminal, generation })),
    resize: (terminal, generation, columns, rows) =>
      runtimeOf(
        call(terminalsResize as Route, {
          terminal,
          generation,
          columns,
          rows,
        }),
      ),
    snapshot: (terminal, afterSeq) =>
      call(terminalsSnapshot as Route, { terminal, after_seq: afterSeq }),
    watch: (terminal, on) =>
      call(terminalsWatch as Route, { terminal, watcher, on }),
    name: (terminal, name) =>
      call(terminalsName as Route, { terminal, name: name.slice(0, 200) }),
    async list() {
      const reply = await call<{ terminals: TerminalRuntime[] }>(
        terminalsList as Route,
        {},
      );
      return reply.ok ? reply.value.terminals : null;
    },
    async savedSessions(project) {
      const reply = await call<{ sessions: TerminalAgentSession[] }>(
        terminalsSavedSessions as Route,
        { project },
      );
      return reply.ok ? reply.value.sessions : null;
    },
    async renameSaved(input) {
      const reply = await call<{ sessions: TerminalAgentSession[] }>(
        terminalsRenameSaved as Route,
        input,
      );
      return reply.ok ? reply.value.sessions : null;
    },
    async forgetSaved(input) {
      await call<{ archived: number }>(codingSessionsForget as Route, input);
    },
    subscribe: (listener) =>
      events.subscribe(
        { types: ["TerminalOutputAppended", "TerminalRuntimeChanged"] },
        listener,
      ),
  };
}
