import type { Clock, IdSource } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { AgentEvent, BusEvent } from "../../../protocol/events/mod.ts";
import type { SessionSnapshot } from "../../../protocol/events/snapshot.ts";
import { recordMessage, stopTurn } from "../../../protocol/lophn-agent/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import type { ModelOutputMessage } from "../../../protocol/supervision/mod.ts";
import type { KnownSecretMatch, Writer } from "../../storage/ledger/mod.ts";
import type { ModelOutputDelta } from "../providers/work.ts";
import type { AgentEventSink, LoopDeps } from "./ports.ts";
import { redactSettled } from "./runtime-redaction.ts";

// 쓰는 중인 model 글의 두 자리다. child는 attempt 하나에서 받은 날 delta를 짧게 묶어 감독 pipe로 보내고
// (`createLiveOutput`), core는 그 날 글을 session마다 쌓아 redaction해 `ModelOutputStreamed`로 내고
// snapshot의 `writing`을 든다(`createLiveTurns`). redaction은 core만 한다: child가 붙잡을 자리를 물을 수
// 있으면 글을 골라 secret 값을 알아낼 수 있다. Retry로 바뀐 attempt의 글은 버리고, 멈춘 답은 core의 writer
// 앞 처리기가 사람이 본 데까지 저장한다(`withLiveTurns`).

// child가 날 글을 묶어 보내는 간격이다.
export const LIVE_BATCH_MS = 50;

type Kind = "text" | "reasoning";

// kind마다 앞 message에 이어 보낸다. 두 kind의 순서는 화면의 offset과 상관없이 정해 두기만 하면 된다.
const KINDS: readonly Kind[] = ["reasoning", "text"];

// 한 model 호출(attempt)의 날 글을 묶어 보내는 child 쪽 통로다. attempt가 끝나면(`stop`) 보내지 않은
// 조각을 버리고, 닫힌 뒤의 delta는 버린다.
export function createLiveOutput(deps: {
  session: Id<"ses">;
  turn: Id<"trn">;
  modelCall: Id<"mcl">;
  send: AgentEventSink["output"];
  wait: LoopDeps["wait"];
}): { push(delta: ModelOutputDelta): void; stop(): void } {
  const pending: Record<Kind, string> = { text: "", reasoning: "" };
  const control = new AbortController();
  let scheduled = false;
  let closed = false;

  function flush(): void {
    scheduled = false;
    for (const kind of KINDS) {
      const text = pending[kind];
      if (text === "") continue;
      pending[kind] = "";
      deps.send({
        session: deps.session,
        turn: deps.turn,
        model_call: deps.modelCall,
        kind,
        text,
      });
    }
  }

  return {
    push(delta) {
      // 상한(1자 이상)이 빈 조각을 받지 않는다.
      if (closed || delta.text === "") return;
      pending[delta.kind] += delta.text;
      if (scheduled) return;
      scheduled = true;
      void deps.wait(LIVE_BATCH_MS, control.signal).then((how) => {
        if (closed || how === "aborted") {
          scheduled = false;
          return;
        }
        flush();
      });
    },
    stop() {
      closed = true;
      control.abort();
      pending.text = "";
      pending.reasoning = "";
    },
  };
}

export type Writing = NonNullable<SessionSnapshot["writing"]>;

type Attempt = {
  turn: string;
  modelCall: string;
  // 아직 redaction하지 않은 날 글이다. batch마다 이 전체에 redaction을 건다(서로 다른 두 batch에 걸친
  // secret도 지워지게).
  raw: Record<Kind, string>;
  // 앞서 낸 글(redaction을 거친 것)이다. kind마다 길이가 그 뒤 delta의 offset이다.
  writing: Writing | null;
  // redaction이 앞서 낸 글과 어긋난 kind는 이 attempt에서 더 내지 않는다.
  stuck: Record<Kind, boolean>;
};

// core 쪽 session마다 도는 model 호출 하나의 날 글과 낸 글을 든다. 한 곳에 두어야 retry·저장·멈춤에서
// 둘이 같이 비워진다.
export function createLiveTurns(deps: {
  known(): KnownSecretMatch | undefined;
  publish(event: AgentEvent): void;
  clock: Clock;
}) {
  const attempts = new Map<string, Attempt>();
  // 저장했거나 다음 것으로 바뀐 model 호출이다. 그 호출의 늦은 조각은 버린다(session마다 마지막 하나씩).
  const stale = new Map<string, string>();
  // 끝난 turn이다. 글을 한 조각도 못 낸 채 끝났어도 그 turn의 늦은 조각은 버린다.
  const ended = new Map<string, string>();

  function drop(session: string): void {
    const attempt = attempts.get(session);
    if (attempt === undefined) return;
    attempts.delete(session);
    stale.set(session, attempt.modelCall);
  }

  return {
    output(batch: Omit<ModelOutputMessage, "type">): void {
      const { session, turn, model_call: modelCall, kind, text } = batch;
      // 저장했거나 다음 것으로 바뀐 호출의 늦은 조각이다. 새 attempt와 헷갈리지 않게 먼저 본다.
      if (stale.get(session) === modelCall || ended.get(session) === turn) {
        return;
      }
      let found = attempts.get(session);
      // 다른 turn의 조각은 끝났거나 늦은 것이고, 다른 model 호출의 조각은 retry다. 둘 다 앞 글을 버린다.
      if (
        found !== undefined &&
        (found.turn !== turn || found.modelCall !== modelCall)
      ) {
        drop(session);
        found = undefined;
      }
      let attempt: Attempt;
      if (found === undefined) {
        attempt = {
          turn,
          modelCall,
          raw: { text: "", reasoning: "" },
          writing: null,
          stuck: { text: false, reasoning: false },
        };
        attempts.set(session, attempt);
      } else {
        attempt = found;
      }
      if (attempt.stuck[kind]) return;
      attempt.raw[kind] += text;
      const redacted = redactSettled(attempt.raw[kind], deps.known());
      // 알려진 값을 다 모르면 원문을 내지 않는다(fail-closed). 다음 조각에서 다시 전체를 건다.
      if (redacted === null) return;
      const shown = attempt.writing?.[kind] ?? "";
      // 앞서 낸 자리를 redaction이 바꿨으면 이 kind는 더 내지 않는다. 화면이 이미 본 글을 되돌리지 않는다.
      if (!redacted.startsWith(shown)) {
        attempt.stuck[kind] = true;
        return;
      }
      if (redacted.length === shown.length) return;
      const writing: Writing = {
        turn: attempt.turn,
        model_call: attempt.modelCall,
        text: attempt.writing?.text ?? "",
        reasoning: attempt.writing?.reasoning ?? "",
      };
      writing[kind] = redacted;
      attempt.writing = writing;
      deps.publish({
        session,
        type: "ModelOutputStreamed",
        at: deps.clock.now(),
        payload: {
          turn: attempt.turn,
          model_call: attempt.modelCall,
          kind,
          offset: shown.length,
          text: redacted.slice(shown.length),
        },
      } as AgentEvent);
    },
    apply(event: BusEvent): void {
      if (event.type === "MessageRecorded") {
        const attempt = attempts.get(event.session);
        if (attempt === undefined) {
          stale.set(event.session, event.payload.model_call);
        } else if (attempt.modelCall === event.payload.model_call) {
          drop(event.session);
        }
        return;
      }
      if (event.type === "ToolCallStarted") {
        if (attempts.get(event.session)?.turn === event.payload.turn) {
          drop(event.session);
        }
        return;
      }
      if (event.type === "TurnStarted") {
        const attempt = attempts.get(event.session);
        if (attempt !== undefined && attempt.turn !== event.payload.turn) {
          drop(event.session);
        }
        return;
      }
      if (event.type === "TurnEnded") {
        ended.set(event.session, event.payload.turn);
        if (attempts.get(event.session)?.turn === event.payload.turn) {
          drop(event.session);
        }
      }
    },
    writing(session: string): Writing | null {
      return attempts.get(session)?.writing ?? null;
    },
    byTurn(turn: string): { session: string; writing: Writing } | null {
      for (const [session, attempt] of attempts) {
        if (attempt.turn === turn && attempt.writing !== null) {
          return { session, writing: attempt.writing };
        }
      }
      return null;
    },
  };
}

export type LiveTurns = ReturnType<typeof createLiveTurns>;

// 한 model 호출의 agent message id다. core의 멈춤 처리와 child가 같은 응답을 저장해도 같은 id라 두 번째는
// message의 같은 id 규칙에 걸린다.
export function messageIdOf(modelCall: string): Id<"msg"> {
  return `msg_${modelCall.slice("mcl_".length)}` as Id<"msg">;
}

// core의 writer 앞 처리기다. `StopTurn` 앞에서 그 turn의 쓰는 중인 글을 machine 자격의 `RecordMessage`로 남긴다.
// 저장하는 글은 core가 들고 있는 `writing` 그대로, 곧 사람이 본 글이다. 저장이 실패해도 멈춤은 그대로 간다.
// `deps.writer()`는 접힌 writer 전체라 `RecordMessage`가 본문 준비를 지난다.
export function withLiveTurns(
  inner: Writer,
  deps: {
    live: LiveTurns;
    context: AuthenticatedContext;
    writer(): Writer;
    ids: IdSource;
    clock: Clock;
    publish(event: AgentEvent): void;
  },
): Writer {
  return {
    ...inner,
    async command(ctx, envelope) {
      if (envelope.command !== stopTurn.name) {
        return await inner.command(ctx, envelope);
      }
      const input = envelope.input as { turn?: unknown };
      if (typeof input.turn !== "string") {
        return await inner.command(ctx, envelope);
      }
      const turn = input.turn;
      const found = deps.live.byTurn(turn);
      if (found !== null) {
        const { writing } = found;
        const parts: unknown[] = [];
        if (writing.reasoning.trim() !== "") {
          parts.push({
            kind: "reasoning",
            text: writing.reasoning,
            duration_ms: null,
          });
        }
        if (writing.text.trim() !== "") {
          parts.push({ kind: "text", text: writing.text });
        }
        if (parts.length > 0) {
          const message = messageIdOf(writing.model_call);
          const recorded = await deps.writer().command(deps.context, {
            command: recordMessage.name,
            input: {
              id: message,
              session: found.session,
              turn,
              content: { schema_version: 1, parts },
            },
            idempotency_key: deps.ids.newId("idk"),
            compare: {},
            prepared: [],
          });
          if (recorded.ok) {
            const event = {
              session: found.session,
              type: "MessageRecorded",
              at: deps.clock.now(),
              payload: { turn, message, model_call: writing.model_call },
            } as AgentEvent;
            deps.publish(event);
            // Bus 구독으로 다시 와도 같은 결과다.
            deps.live.apply(event);
          }
        }
      }
      return await inner.command(ctx, envelope);
    },
  };
}
