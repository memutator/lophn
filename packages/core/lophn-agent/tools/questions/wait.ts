import { err, ok, type Result } from "../../../../base/mod.ts";
import type { Clock, IdSource } from "../../../../base/mod.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import type {
  AskAnswer,
  AskInput,
  AskResult,
} from "../../../../protocol/lophn-agent/ask-tool.ts";
import type { Bus } from "../../../events/ports.ts";

// `ask`가 올린 질문 묶음의 기다림이다. 메모리에만 두고 꺼졌다 켜지면 비어 있다(turn이 interrupted로 닫힌다).
// 사람이 답하거나 그 session에 메시지를 보내거나 turn이 끝나면 기다리던 tool이 결과를 받는다.

type Entry = {
  group: Id<"qgr">;
  session: string;
  turn: string;
  questions: AskInput["questions"];
  settle(result: AskResult): void;
};

type QuestionWaitsDeps = {
  bus: Pick<Bus, "publish">;
  clock: Clock;
  ids: IdSource;
};

export function createQuestionWaits(deps: QuestionWaitsDeps) {
  // key는 session과 ask tool call이다. 같은 tool call의 재전송은 같은 기다림을 쓴다.
  const entries = new Map<string, Entry>();
  const promises = new Map<string, Promise<AskResult>>();
  const keyOf = (session: string, toolCall: string) => `${session}/${toolCall}`;

  function close(key: string, entry: Entry, result: AskResult): void {
    entries.delete(key);
    deps.bus.publish({
      session: entry.session,
      type: "QuestionResolved",
      at: deps.clock.now(),
      payload: { group: entry.group, outcome: result.outcome },
    });
    entry.settle(result);
  }

  function settleSession(
    session: string,
    result: (entry: Entry) => AskResult,
    turn?: string,
  ): void {
    for (const [key, entry] of [...entries]) {
      if (entry.session !== session) continue;
      if (turn !== undefined && entry.turn !== turn) continue;
      close(key, entry, result(entry));
    }
  }

  return {
    ask(
      call: { session: string; turn: string; tool_call: string },
      questions: AskInput["questions"],
    ): Promise<AskResult> {
      const key = keyOf(call.session, call.tool_call);
      const waiting = promises.get(key);
      if (waiting !== undefined) return waiting;
      const group = deps.ids.newId("qgr") as Id<"qgr">;
      const promise = new Promise<AskResult>((resolve) => {
        entries.set(key, {
          group,
          session: call.session,
          turn: call.turn,
          questions,
          settle: resolve,
        });
      }).finally(() => promises.delete(key));
      promises.set(key, promise);
      deps.bus.publish({
        session: call.session,
        type: "QuestionAsked",
        at: deps.clock.now(),
        payload: { group, turn: call.turn, tool_call: call.tool_call },
      });
      return promise;
    },

    read(session: string, toolCall: string): Result<{
      group: Id<"qgr">;
      questions: AskInput["questions"];
    }> {
      const entry = entries.get(keyOf(session, toolCall));
      if (entry === undefined) {
        return err({ code: "not_found", message: "the question is not open" });
      }
      return ok({ group: entry.group, questions: entry.questions });
    },

    // 사람의 답. 질문 순서대로 하나씩이다.
    answer(
      session: string,
      toolCall: string,
      answers: readonly AskAnswer[],
    ): Result<AskResult> {
      const key = keyOf(session, toolCall);
      const entry = entries.get(key);
      if (entry === undefined) {
        return err({ code: "not_found", message: "the question is not open" });
      }
      const fits = answers.length === entry.questions.length &&
        entry.questions.every((one, at) =>
          answers[at]!.question === one.question
        );
      if (!fits) {
        return err({
          code: "invalid_input",
          message: "answer every question in order",
        });
      }
      const result: AskResult = { outcome: "submitted", answers: [...answers] };
      close(key, entry, result);
      return ok(result);
    },

    // 사람이 기다리는 중에 그 session에 메시지를 보냈다. 답인지는 LLM이 읽는다.
    humanMessage(session: string, message: string): void {
      settleSession(
        session,
        () => ({ outcome: "human_message", message, answers: [] }),
      );
    },

    // core가 내려간다. 기다리던 tool이 모두 cancelled를 받는다.
    cancelAll(): void {
      for (
        const session of new Set([...entries.values()].map((e) => e.session))
      ) {
        settleSession(session, () => ({ outcome: "cancelled", answers: [] }));
      }
    },

    // turn이 끝났거나 session이 닫혔다. turn을 주면 그 turn의 것만 푼다.
    cancel(session: string, turn?: string): void {
      settleSession(
        session,
        () => ({ outcome: "cancelled", answers: [] }),
        turn,
      );
    },
  };
}

