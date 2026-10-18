import type { Clock } from "../../../packages/base/mod.ts";
import {
  approvalsDecide,
  approvalsDecideTurn,
  approvalsPending,
} from "../../../packages/protocol/approvals/mod.ts";
import { sessionSnapshotsList } from "../../../packages/protocol/events/mod.ts";
import {
  askAnswer,
  askRead,
} from "../../../packages/protocol/lophn-agent/ask-tool.ts";
import type { Core } from "../../support/core/mod.ts";
import type { HumanRecord, HumanSpec } from "../types.ts";
import { choosePending, chooseTurn } from "./approve.ts";
import {
  answerQuestions,
  type EarlierAnswer,
  type HumanFetch,
} from "./answer.ts";
import { type HumanDefinition, loadHumanDefinition } from "./definition.ts";

export type HumanPort = Pick<Core, "tryCall">;

export type HumanDeps = {
  port: HumanPort;
  fetch: HumanFetch;
  apiKey: string;
  clock: Clock;
  spec: HumanSpec;
  definition?: HumanDefinition;
};

export type HumanRole = {
  tick(): Promise<{ acted: number }>;
  record(): HumanRecord;
};

// 이미 닫힌 것이다. 다시 시도하지 않는다.
const CLOSED = ["not_found", "conflict"];

// 사람 화면이 하듯 질문과 request 목록을 tick마다 새로 읽고 안 다룬 것에 답한다.
// 질문 내용(askRead)과 앞서 한 답만 모델에게 간다.
export function createHumanRole(deps: HumanDeps): HumanRole {
  const { port, clock, spec } = deps;
  const seenQuestions = new Set<string>();
  const seenRequests = new Set<string>();
  const earlier: EarlierAnswer[] = [];
  let definition = deps.definition;
  const record: HumanRecord = {
    definition: "",
    answers: [],
    decisions: [],
    cost_usd: 0,
  };
  const fill = (d: HumanDefinition) => {
    definition = d;
    record.definition = `human@${d.n}`;
  };
  if (definition) fill(definition);

  // tryCall이 던져도 tick은 던지지 않는다.
  const call: HumanPort["tryCall"] = async (route, input, compare) => {
    try {
      return await port.tryCall(route, input, compare);
    } catch (e) {
      return {
        ok: false,
        error: {
          code: "unavailable",
          message: e instanceof Error ? e.message : String(e),
        },
      } as never;
    }
  };

  async function tick(): Promise<{ acted: number }> {
    let acted = 0;
    // 정의 file을 못 읽는 것은 repo 결함이라 던진다.
    if (!definition) fill(await loadHumanDefinition());
    const def = definition!;
    const rec = record;
    const listed = await call(sessionSnapshotsList, {});
    if (!listed.ok) return { acted };
    const { snapshots } = listed.value;

    for (const snap of snapshots) {
      for (const q of snap.questions) {
        if (seenQuestions.has(q.tool_call)) continue;
        const target = { session: snap.session, tool_call: q.tool_call };
        const read = await call(askRead, target);
        if (!read.ok) {
          if (CLOSED.includes(read.error.code)) seenQuestions.add(q.tool_call);
          continue;
        }
        const { questions } = read.value;
        const result = await answerQuestions(
          { fetch: deps.fetch, apiKey: deps.apiKey, definition: def },
          { card: spec.card, earlier: [...earlier], questions },
        );
        const sent = await call(askAnswer, {
          ...target,
          answers: result.answers,
        });
        let error = result.error;
        if (!sent.ok) {
          const sendError = `${sent.error.code}: ${sent.error.message}`;
          error = error === null ? sendError : `${error}; ${sendError}`;
        }
        rec.answers.push({
          at: clock.now(),
          ...target,
          questions,
          answers: result.answers,
          error,
          model: def.model,
          cost_usd: result.cost_usd,
        });
        rec.cost_usd += result.cost_usd;
        if (sent.ok) {
          acted++;
          seenQuestions.add(q.tool_call);
          questions.forEach((question, i) =>
            earlier.push({
              question: question.question,
              answer: result.answers[i].answer,
            })
          );
        } else if (CLOSED.includes(sent.error.code)) {
          seenQuestions.add(q.tool_call);
        }
      }
    }

    for (const snap of snapshots) {
      for (const request of snap.permission_requests) {
        if (seenRequests.has(request.id)) continue;
        const { choice, rule } = chooseTurn(spec.approve, request);
        const res = await call(approvalsDecideTurn, {
          session: snap.session,
          request: request.id,
          choice,
        });
        rec.decisions.push({
          at: clock.now(),
          path: "turn",
          session: snap.session,
          request: request.id,
          kind: request.intent.kind,
          target: request.intent.target,
          choice: choice.kind,
          rule,
          error: res.ok ? null : `${res.error.code}: ${res.error.message}`,
        });
        if (res.ok) acted++;
        if (res.ok || CLOSED.includes(res.error.code)) {
          seenRequests.add(request.id);
        }
      }
    }

    // activation은 이 길로 온다. 아무도 기다리지 않아 session 상태에 안 드러난다.
    const pending = await call(approvalsPending, {});
    if (pending.ok) {
      for (const request of pending.value.requests) {
        if (seenRequests.has(request.id)) continue;
        const { choice, rule } = choosePending(spec.approve, request);
        const res = await call(approvalsDecide, {
          request: request.id,
          choice,
        });
        rec.decisions.push({
          at: clock.now(),
          path: "pending",
          session: null,
          request: request.id,
          kind: request.intent.kind,
          target: request.intent.target,
          choice: choice.kind,
          rule,
          error: res.ok ? null : `${res.error.code}: ${res.error.message}`,
        });
        if (res.ok) acted++;
        if (res.ok || CLOSED.includes(res.error.code)) {
          seenRequests.add(request.id);
        }
      }
    }
    return { acted };
  }

  return { tick, record: () => record };
}
