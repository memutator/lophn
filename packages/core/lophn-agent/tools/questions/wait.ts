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
// 사람에게 가는 질문은 session마다 하나만 열린다. 한 응답의 `ask` 호출 여럿은 병렬로 오는데 화면은 session당
// 질문 하나(pending.question)만 쥐므로, 나머지는 줄을 서고 앞 질문이 풀리면 차례로 열린다. 열리지 않은 질문은
// 사람이 읽거나 답할 수 없고 QuestionAsked도 나가지 않는다.

type Entry = {
  group: Id<"qgr">;
  session: string;
  turn: string;
  toolCall: string;
  questions: AskInput["questions"];
  // 팀 자식의 질문이라 사람이 아니라 부모가 답한다.
  toParent: boolean;
  // 팀 자식의 질문은 늘 열려 있다. 사람의 질문은 session의 앞 질문이 풀린 뒤에 열린다.
  open: boolean;
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

  // unattended는 ask tool이 기다리지 않고 돌려주므로 기다림이 닫는 결과에는 없다.
  type Settled = Exclude<AskResult, { outcome: "unattended" }>;

  function announce(entry: Entry): void {
    entry.open = true;
    deps.bus.publish({
      session: entry.session,
      type: "QuestionAsked",
      at: deps.clock.now(),
      payload: {
        group: entry.group,
        turn: entry.turn,
        tool_call: entry.toolCall,
        to_parent: entry.toParent,
      },
    });
  }

  // 사람에게 열린 질문이 없으면 줄 선 첫 질문을 연다.
  function openNext(session: string): void {
    const mine = [...entries.values()].filter(
      (one) => one.session === session && !one.toParent,
    );
    if (mine.some((one) => one.open)) return;
    const next = mine[0];
    if (next !== undefined) announce(next);
  }

  function close(key: string, entry: Entry, result: Settled): void {
    entries.delete(key);
    // 열리지 않은 질문은 아무 화면도 몰라서 닫힘도 알리지 않는다.
    if (entry.open) {
      deps.bus.publish({
        session: entry.session,
        type: "QuestionResolved",
        at: deps.clock.now(),
        payload: { group: entry.group, outcome: result.outcome },
      });
    }
    entry.settle(result);
  }

  function settleSession(
    session: string,
    result: (entry: Entry) => Settled,
    turn?: string,
  ): void {
    for (const [key, entry] of [...entries]) {
      if (entry.session !== session) continue;
      if (turn !== undefined && entry.turn !== turn) continue;
      close(key, entry, result(entry));
    }
    openNext(session);
  }

  return {
    ask(
      call: { session: string; turn: string; tool_call: string },
      questions: AskInput["questions"],
      toParent: boolean,
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
          toolCall: call.tool_call,
          questions,
          toParent,
          open: false,
          settle: resolve,
        });
      }).finally(() => promises.delete(key));
      promises.set(key, promise);
      if (toParent) announce(entries.get(key)!);
      else openNext(call.session);
      return promise;
    },

    read(
      session: string,
      toolCall: string,
    ): Result<{
      group: Id<"qgr">;
      questions: AskInput["questions"];
    }> {
      const entry = entries.get(keyOf(session, toolCall));
      if (entry === undefined || !entry.open) {
        return err({ code: "not_found", message: "the question is not open" });
      }
      return ok({ group: entry.group, questions: entry.questions });
    },

    // 그 session의 답 없는 질문. snapshot이 읽는다.
    list(session: string): {
      group: Id<"qgr">;
      turn: Id<"trn">;
      tool_call: Id<"tcl">;
      to_parent: boolean;
    }[] {
      return [...entries.values()]
        .filter((one) => one.session === session && one.open)
        .map((one) => ({
          group: one.group,
          turn: one.turn as Id<"trn">,
          tool_call: one.toolCall as Id<"tcl">,
          to_parent: one.toParent,
        }));
    },

    // 사람의 답. 질문 순서대로 하나씩이다.
    answer(
      session: string,
      toolCall: string,
      answers: readonly AskAnswer[],
    ): Result<AskResult> {
      const key = keyOf(session, toolCall);
      const entry = entries.get(key);
      if (entry === undefined || !entry.open) {
        return err({ code: "not_found", message: "the question is not open" });
      }
      const fits =
        answers.length === entry.questions.length &&
        entry.questions.every(
          (one, at) => answers[at]!.question === one.question,
        );
      if (!fits) {
        return err({
          code: "invalid_input",
          message: "answer every question in order",
        });
      }
      const result: AskResult = { outcome: "submitted", answers: [...answers] };
      close(key, entry, result);
      openNext(entry.session);
      return ok(result);
    },

    // 부모가 call reply로 답했거나(parent_reply) 부모가 답 없이 끝났다(cancelled). 이미 풀렸으면 아무것도 하지 않는다.
    settleGroup(group: string, result: Settled): void {
      for (const [key, entry] of entries) {
        if (entry.group === group) {
          close(key, entry, result);
          return;
        }
      }
    },

    // 사람이 기다리는 중에 그 session에 메시지를 보냈다. 답인지는 LLM이 읽는다.
    humanMessage(session: string, message: string): void {
      settleSession(session, () => ({
        outcome: "human_message",
        message,
        answers: [],
      }));
    },

    // core가 내려간다. 기다리던 tool이 모두 cancelled를 받는다.
    cancelAll(): void {
      for (const session of new Set(
        [...entries.values()].map((e) => e.session),
      )) {
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
