// 질문 묶음의 고정 action 선택지. 정본은 questions/read {group}(상태·질문의 선택지 action)와
// questions/text {group}(질문·선택지 설명 글)다. 고정 action은 질문 하나짜리 묶음에만 있다
// (lophn-agent/questions#R13). 고르기 전에 concern·command·대상·정확한 입력·비교 기준을 그대로
// 보인다. 답은 AnswerQuestionAction이고 실제 적용은 lophn이 그 증거로 따로 한다.
import type { LiveHandle } from "../handle.ts";
import {
  bindingOf,
  failed,
  type KindCore,
  type Read,
  readFailure,
  record,
  sendCommand,
  type Sent,
  text,
} from "./core.ts";

/** contracts QUESTION_ANSWER_DECISION(= command 이름). */
export const ANSWER_ACTION = "AnswerQuestionAction";

// contracts answerQuestionAction.binding과 같다. 대상은 첫 칸인 묶음이다.
const BINDING = ["group", "created_seq", "answer", "binding_hash"] as const;

export async function readOptionAction(
  core: KindCore,
  group: string,
  optionKey: string,
): Promise<Read> {
  const got = await core.internal("read", "questions", "read", { group });
  if (!got.ok) return readFailure(got);
  const found = record(record(got.value).group);
  if (found.status !== "pending") {
    return failed("conflict", "이미 끝난 질문이다");
  }
  // 고정 action 선택지는 질문 하나짜리 묶음에만 있다. 둘 이상이면 무엇을 확정하는지 흐려진다.
  const questions = Array.isArray(found.questions) ? found.questions : [];
  if (questions.length !== 1) {
    return failed("not_found", "질문 하나짜리 묶음이 아니다");
  }
  const only = record(questions[0]);
  const options = Array.isArray(only.options) ? only.options : [];
  const option = record(
    options.find((item) => record(item).key === optionKey),
  );
  const action = record(option.action);
  if (option.key !== optionKey || option.action === null || !action.command) {
    return failed("not_found", "고정 동작이 있는 선택지가 아니다");
  }
  const read = await core.internal("read", "questions", "text", { group });
  if (!read.ok) return readFailure(read);
  const words = record(
    (Array.isArray(record(read.value).questions)
      ? record(read.value).questions as unknown[]
      : []).map(record).find((item) => item.question === only.id),
  );
  const described = (Array.isArray(words.options) ? words.options : [])
    .map(record).find((item) => item.key === optionKey);
  const createdSeq = String(found.created_seq);
  const bindingHash = String(action.binding_hash);
  const bound = bindingOf(BINDING, {
    group,
    created_seq: createdSeq,
    answer: { kind: "option", option_key: optionKey },
    binding_hash: bindingHash,
  });
  const recommendation = record(only.recommendation);
  return {
    ok: true,
    value: {
      targetRef: bound.target,
      content: bound.content,
      allowed: [ANSWER_ACTION],
      expiresAt: text(found.expires_at),
      secondConfirm: false,
      request: {
        kind: "question_option_action",
        group,
        question: text(only.id) ?? "",
        option_key: optionKey,
        created_seq: createdSeq,
        binding_hash: bindingHash,
      },
      view: {
        kind: "option_action",
        prompt: text(words.prompt),
        reason: text(words.reason),
        label: text(option.label),
        description: text(described?.description),
        recommended: recommendation.option_key === optionKey,
        concern: text(action.concern),
        command: text(action.command),
        targets: Array.isArray(action.targets) ? action.targets : [],
        input: record(action.input),
        comparison: record(action.comparison),
        expires_at: text(found.expires_at),
      },
    },
  };
}

/** 답은 결정 접수다. 고정 action은 lophn이 이 답의 증거로 따로 적용한다. */
export async function submitOptionAction(
  core: KindCore,
  input: {
    handle: LiveHandle;
    group: string;
    question: string;
    optionKey: string;
    createdSeq: string;
    bindingHash: string;
  },
): Promise<Sent> {
  const sent = await sendCommand(core, "questions", "answer-action", {
    input: {
      group: input.group,
      created_seq: input.createdSeq,
      answer: { kind: "option", option_key: input.optionKey },
      binding_hash: input.bindingHash,
      evidence: { question: input.question, option: input.optionKey },
    },
    idempotency_key: `confirmation:${input.handle.ref}`,
    compare: { created_seq: input.createdSeq },
    prepared: [],
    confirmation: input.handle.ref,
  });
  if (!sent.ok) return sent;
  return {
    ok: true,
    value: {
      receipt: { kind: "entity", id: input.group },
      result: "accepted",
    },
  };
}
