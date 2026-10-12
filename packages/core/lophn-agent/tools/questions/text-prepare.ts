// 질문 글의 core 쪽 길(lophn-agent/questions, plan Q38). 호출자(shell·runtime)는 blob을
// 준비하지 않고 글 값을 요청에 싣는다. core가 command 앞에서 글을 redaction해(자유 답은
// secret 판정까지) UTF-8 bytes로 blob을 준비하고, command가 같은 transaction에서 영구
// 참조를 등록한다. 읽기(ReadQuestionText)는 packages/core/lophn-agent/register.ts가 message 읽기와
// 같은 환경으로 붙인다.
import { ok, type Result } from "../../../../base/mod.ts";
import {
  answerQuestionGroup,
  cancelQuestionGroup,
  createQuestionGroup,
  QUESTION_TEXT_PURPOSE,
  questionTextBytes,
  questionTextSchema,
  waitRun,
} from "../../../../protocol/lophn-agent/mod.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import {
  type CommandEnvelope,
  type Writer,
} from "../../../storage/ledger/mod.ts";
import {
  createKnownSecretRegistry,
  createRedactionEngine,
  type RedactionInput,
  type RedactionResult,
} from "../../../../base/redaction/mod.ts";
import { screenAnswerText } from "./mod.ts";
import { createProductRedactor } from "../../../projects/outline-and-search/redactor.ts";
import { prepareBytes, rejected } from "../../session/message-body.ts";
import type { BodyPrepare } from "../../session/message-body.ts";

const redactText = createProductRedactor();
const SOURCE = {
  concern: "lophn-agent/questions",
  revision: "1",
  scope: "question-text",
};

type Slot = {
  // 자유 답은 secret 판정을 거쳐 막는다(R11). 나머지 글은 secret 부분을 가린다.
  answer: boolean;
  read(): unknown;
  write(text: string): void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function slotsOf(command: string, input: Record<string, unknown>): Slot[] {
  const slot = (
    owner: Record<string, unknown>,
    key: string,
    answer = false,
  ): Slot => ({
    answer,
    read: () => owner[key],
    write: (text) => {
      owner[key] = text;
    },
  });
  if (command === answerQuestionGroup.name) {
    // 묶음의 답은 질문마다 하나이고, 자유 답만 글을 싣는다.
    const answers = input["answers"];
    const slots: Slot[] = [];
    if (Array.isArray(answers)) {
      for (const entry of answers) {
        const answer = isRecord(entry) ? entry["answer"] : undefined;
        if (isRecord(answer) && answer["kind"] === "text") {
          slots.push(slot(answer, "text", true));
        }
      }
    }
    return slots;
  }
  if (command === cancelQuestionGroup.name) {
    return [slot(input, "closed_reason_text")];
  }
  const slots: Slot[] = [];
  const questions = input["questions"];
  if (!Array.isArray(questions)) return slots;
  for (const question of questions) {
    if (!isRecord(question)) continue;
    slots.push(slot(question, "prompt"), slot(question, "reason"));
    const options = question["options"];
    if (Array.isArray(options)) {
      for (const option of options) {
        if (isRecord(option)) slots.push(slot(option, "description"));
      }
    }
    const recommendation = question["recommendation"];
    if (isRecord(recommendation)) {
      slots.push(slot(recommendation, "explanation"));
    }
  }
  return slots;
}

// 사람 기다림(WaitRun)의 질문 제출은 질문 묶음 생성 입력을 그대로 싣는다. 글 자리는 같고 한
// 단계 안(`request.input`)에 있다. approval 제출이나 모양이 틀린 요청은 건드리지 않고 지나간다.
function waitQuestionInput(
  input: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const request = input["request"];
  if (!isRecord(request) || request["kind"] !== "question") return undefined;
  const created = request["input"];
  return isRecord(created) ? created : undefined;
}

// 글을 싣는 command의 앞 단계. 글은 redaction을 거친 값으로 바뀌어 writer에 가고, 그
// 바이트는 보낸 자격의 이름으로 준비되어 있다. 다른 command는 그대로 지나간다. 모양이
// 틀린 요청은 건드리지 않고 지나가 command의 schema 검사가 거절한다.
export function createQuestionTextPreparer(deps: {
  // 준비 통로. I/O worker가 뜨기 전에는 없다(unavailable).
  relay(): BodyPrepare | undefined;
  // 자유 답의 secret 판정기. 없으면 실제 redaction 엔진이다. 테스트가 대신한다.
  redact?: (input: RedactionInput, body: string) => Promise<RedactionResult>;
}): (
  ctx: AuthenticatedContext,
  envelope: CommandEnvelope,
) => Promise<Result<CommandEnvelope>> {
  const engine = createRedactionEngine({
    registry: createKnownSecretRegistry(),
  });
  const judge = deps.redact ??
    ((input: RedactionInput, body: string) => engine.redact(input, body));
  return async (ctx, envelope) => {
    const waiting = envelope.command === waitRun.name;
    if (
      !waiting &&
      envelope.command !== createQuestionGroup.name &&
      envelope.command !== answerQuestionGroup.name &&
      envelope.command !== cancelQuestionGroup.name
    ) return ok(envelope);
    if (!isRecord(envelope.input)) return ok(envelope);
    const input = structuredClone(envelope.input);
    const target = waiting ? waitQuestionInput(input) : input;
    if (target === undefined) return ok(envelope);
    const slots = slotsOf(
      waiting ? createQuestionGroup.name : envelope.command,
      target,
    ).filter((slot) => typeof slot.read() === "string");
    if (slots.length === 0) return ok(envelope);
    const texts: string[] = [];
    for (const slot of slots) {
      const text = slot.read() as string;
      let safe: string;
      if (slot.answer) {
        const screened = await screenAnswerText(text, judge);
        if (screened.status === "blank") {
          return rejected("invalid_input", "an empty answer is not an answer");
        }
        if (screened.status === "secure_input") {
          return rejected(
            "invalid_input",
            "this answer looks like a secret; use the protected input",
          );
        }
        if (screened.status === "unavailable") {
          return rejected("unavailable", "answer screening did not finish");
        }
        safe = screened.text;
      } else {
        const redacted = redactText(SOURCE, "text/plain", text);
        if (redacted === null) {
          return rejected("unavailable", "question redaction did not finish");
        }
        safe = redacted;
      }
      // redaction 뒤 글이 다시 계약 안인지 본다. 대체 문구가 길어 상한을 넘을 수 있다.
      if (!questionTextSchema.safeParse(safe).success) {
        return rejected("invalid_input", "question text is not valid");
      }
      slot.write(safe);
      texts.push(safe);
    }
    const relay = deps.relay();
    if (relay === undefined) {
      return rejected("unavailable", "blob preparation is not available");
    }
    for (const text of new Set(texts)) {
      const prepared = await prepareBytes(
        relay,
        ctx,
        QUESTION_TEXT_PURPOSE,
        questionTextBytes(text),
        "question text",
      );
      if (!prepared.ok) return prepared;
    }
    return ok({ ...envelope, input });
  };
}

// writer.command 앞에 글 준비를 끼운다. 나머지 Writer 동작은 그대로다.
export function withQuestionText(
  writer: Writer,
  prepare: ReturnType<typeof createQuestionTextPreparer>,
): Writer {
  return {
    ...writer,
    async command(ctx, envelope) {
      const ready = await prepare(ctx, envelope);
      if (!ready.ok) return ready;
      return await writer.command(ctx, ready.value);
    },
  };
}
