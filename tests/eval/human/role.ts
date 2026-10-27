import type { Clock } from "../../../packages/base/mod.ts";
import {
  activationConsent,
  activationConsents,
} from "../../../packages/protocol/apps/mod.ts";
import { turnRequestDecide } from "../../../packages/protocol/approvals/mod.ts";
import { sessionSnapshotsList } from "../../../packages/protocol/events/mod.ts";
import {
  askAnswer,
  type AskQuestion,
  askRead,
} from "../../../packages/protocol/lophn-agent/ask-tool.ts";
import type { Core } from "../../support/core/mod.ts";
import type { HumanRecord, HumanSpec } from "../types.ts";
import { chooseConsent, chooseTurn } from "./approve.ts";
import { buildAnswers, type EarlierAnswer } from "./answers.ts";
import { type HumanDefinition, loadHumanDefinition } from "./definition.ts";
import {
  questionKey,
  readGivenAnswer,
  removeGivenAnswer,
  writeQuestion,
} from "./pending.ts";

export type HumanPort = Pick<Core, "tryCall">;

export type HumanDeps = {
  port: HumanPort;
  clock: Clock;
  spec: HumanSpec;
  evalDir: string;
  run: string;
  trial: number;
  log: (line: string) => void;
  definition?: HumanDefinition;
};

export type HumanRole = {
  tick(): Promise<{ acted: number }>;
  record(): HumanRecord;
  waiting(): string[]; // 답을 기다리는 질문 key
};

// 이미 닫힌 것이다. 다시 시도하지 않는다.
const CLOSED = ["not_found", "conflict"];

// 대기가 이어지는 동안 이 간격으로 한 번 다시 알린다.
const REMIND_MS = 60_000;

// 사람 화면이 하듯 질문과 request 목록을 tick마다 새로 읽는다. 질문은 대기 file이 되고 돌리는 agent의 답이 오면 askAnswer로 넣는다.
export function createHumanRole(deps: HumanDeps): HumanRole {
  const { port, clock, spec } = deps;
  const seenQuestions = new Set<string>();
  const written = new Set<string>();
  const seenRequests = new Set<string>();
  const seenConsents = new Set<string>();
  const earlier: EarlierAnswer[] = [];
  const pendingQuestions = new Map<string, AskQuestion[]>();
  let lastRemind = 0;
  let definition = deps.definition;
  const record: HumanRecord = {
    definition: "",
    answers: [],
    decisions: [],
  };
  const fill = (d: HumanDefinition) => {
    definition = d;
    record.definition = `human@${d.n}`;
  };
  if (definition) fill(definition);

  const waiting = () =>
    [...written].filter((key) => !seenQuestions.has(key)).sort();

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
    const rec = record;
    const listed = await call(sessionSnapshotsList, {});
    if (!listed.ok) return { acted };
    const { snapshots } = listed.value;

    for (const snap of snapshots) {
      for (const q of snap.questions) {
        const key = questionKey(deps.trial, q.tool_call);
        if (seenQuestions.has(key)) continue;
        const target = { session: snap.session, tool_call: q.tool_call };
        let questions = pendingQuestions.get(key);
        if (questions === undefined) {
          const read = await call(askRead, target);
          if (!read.ok) {
            if (CLOSED.includes(read.error.code)) seenQuestions.add(key);
            continue;
          }
          questions = read.value.questions;
          await writeQuestion(deps.evalDir, {
            key,
            run: deps.run,
            trial: deps.trial,
            ...target,
            asked_at: clock.now(),
            card: spec.card,
            earlier: earlier.map((e) => ({ ...e })),
            questions,
          });
          pendingQuestions.set(key, questions);
          written.add(key);
          lastRemind = clock.nowMs();
          deps.log(`답 대기 ${deps.run} ${key}`);
        }
        const given = await readGivenAnswer(deps.evalDir, deps.run, key);
        if (given === null) continue;
        const answers = buildAnswers(questions, given.selected);
        const sent = await call(askAnswer, { ...target, answers });
        const error = sent.ok
          ? null
          : `${sent.error.code}: ${sent.error.message}`;
        rec.answers.push({
          at: clock.now(),
          ...target,
          questions,
          answers,
          error,
          model: given.model,
        });
        if (sent.ok) {
          acted++;
          seenQuestions.add(key);
          questions.forEach((question, i) =>
            earlier.push({
              question: question.question,
              answer: answers[i].answer,
            }),
          );
        } else if (CLOSED.includes(sent.error.code)) {
          seenQuestions.add(key);
        } else {
          // 같은 답을 매 tick 되풀이하지 않는다. agent가 다시 답한다.
          await removeGivenAnswer(deps.evalDir, deps.run, key);
          deps.log(`답 거절 ${deps.run} ${key}: ${error}`);
        }
      }
    }
    const waits = waiting();
    if (waits.length > 0 && clock.nowMs() - lastRemind >= REMIND_MS) {
      lastRemind = clock.nowMs();
      deps.log(`답 대기 ${waits.length}개: ${deps.run} ${waits.join(" ")}`);
    }

    for (const snap of snapshots) {
      for (const request of snap.turn_requests) {
        if (seenRequests.has(request.id)) continue;
        const { choice, rule } = chooseTurn(spec.approve, request);
        const res = await call(turnRequestDecide, {
          session: snap.session,
          request: request.id,
          choice,
        });
        rec.decisions.push({
          at: clock.now(),
          path: "turn",
          session: snap.session,
          request: request.id,
          subject: request.subject,
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

    // activation 동의는 session에 안 드러난다: App Engineer turn은 waiting_consent를 받고 바로 끝난다.
    // 같은 release를 다시 물으면 requested_at이 바뀌므로 열쇠에 넣어 새 줄로 다시 답한다.
    const consents = await call(activationConsents, {});
    if (consents.ok) {
      for (const consent of consents.value.consents) {
        const key = `${consent.release}@${consent.requested_at}`;
        if (seenConsents.has(key)) continue;
        const { choice, rule } = chooseConsent(spec.approve);
        const res = await call(
          activationConsent,
          { release: consent.release, choice },
          { requested_at: consent.requested_at },
        );
        rec.decisions.push({
          at: clock.now(),
          path: "consent",
          app: consent.app,
          release: consent.release,
          comparison: consent.comparison,
          choice,
          rule,
          error: res.ok ? null : `${res.error.code}: ${res.error.message}`,
        });
        if (res.ok) acted++;
        if (res.ok || CLOSED.includes(res.error.code)) {
          seenConsents.add(key);
        }
      }
    }
    return { acted };
  }

  return { tick, record: () => record, waiting };
}
