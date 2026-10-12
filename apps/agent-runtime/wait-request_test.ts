import { assertEquals } from "@std/assert";
import {
  createQuestionGroupInputSchema,
  type questionRead,
  type questionText,
} from "../../packages/protocol/lophn-agent/mod.ts";
import { settingsOptionAction } from "../../packages/lophn-agent/questions/mod.ts";
import type { z } from "zod";
import { questionWaitRequest } from "./wait-request.ts";

const GROUP = "qgr_01arz3ndektsv4rrffq69g5fav";
const FIRST = "qst_01arz3ndektsv4rrffq69g5fav";
const SECOND = "qst_01arz3ndektsv4rrffq69g5fb0";
const RUN = "run_01arz3ndektsv4rrffq69g5fav";
const SESSION = "ses_01arz3ndektsv4rrffq69g5fav";
const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const VER = "ver_01arz3ndektsv4rrffq69g5fav";
const HASH = "ab".repeat(32);

type Stored = z.output<typeof questionRead.output>["group"];
type Text = z.output<typeof questionText.output>;

// 만들 때 싣은 입력에서 저장된 모양(글은 blob hash)과 저장된 글을 만든다. 질문 tool이 만든
// 묶음을 되돌리는 길의 입력이다.
function storedOf(created: z.input<typeof createQuestionGroupInputSchema>) {
  const stored = {
    id: created.id,
    run: created.run,
    session: created.session,
    expires_at: created.expires_at,
    status: "pending",
    closed_reason: null,
    closed_reason_blob: null,
    created_seq: "1",
    closed_seq: null,
    questions: created.questions.map((question, index) => ({
      id: question.id,
      group: created.id,
      position: index + 1,
      prompt_blob: HASH,
      reason_blob: HASH,
      options: question.options.map(({ description: _, ...option }) => ({
        ...option,
        description_blob: HASH,
      })),
      recommendation: question.recommendation === null ? null : {
        option_key: question.recommendation.option_key,
        explanation_blob: HASH,
      },
      answer: null,
      applied: false,
    })),
  } as unknown as Stored;
  const text = {
    group: created.id,
    questions: created.questions.map((question) => ({
      question: question.id,
      prompt: question.prompt,
      reason: question.reason,
      options: question.options.map((option) => ({
        key: option.key,
        description: option.description,
      })),
      recommendation: question.recommendation,
      answer_text: null,
    })),
    closed_reason_text: null,
  } as unknown as Text;
  return { stored, text };
}

Deno.test("lophn-agent/harness/waiting-and-recovery#R1 [agent-I13]: 질문 tool이 만든 질문 묶음은 저장된 글과 선택지로 WaitRun 요청이 되어 만든 입력과 같다", () => {
  const created = {
    id: GROUP,
    run: RUN,
    session: SESSION,
    expires_at: null,
    questions: [
      {
        id: FIRST,
        prompt: "어느 쪽으로 정리할까요?",
        reason: "두 방향이 모두 가능합니다",
        options: [
          {
            key: "a",
            label: "A로",
            evidence: [{ document: DOC, version: VER, section: null }],
            adoption: null,
            action: null,
            description: "A 설명",
          },
          {
            key: "b",
            label: "B로",
            evidence: [],
            adoption: null,
            action: null,
            description: "B 설명",
          },
        ],
        recommendation: { option_key: "a", explanation: "A가 더 가깝습니다" },
      },
      {
        id: SECOND,
        prompt: "이름은 어떻게 할까요?",
        reason: "이름은 위 선택과 따로 정할 수 있습니다",
        options: [],
        recommendation: null,
      },
    ],
  };
  const { stored, text } = storedOf(created);
  const request = questionWaitRequest(stored, text);
  assertEquals(request.kind, "question");
  // 질문은 저장된 position 순서이고 질문마다 자기 글과 선택지를 가진다.
  assertEquals(request.input, created);
  assertEquals(
    createQuestionGroupInputSchema.safeParse(request.input).success,
    true,
  );
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R1 [agent-I13]: 고정 action이 있는 질문 하나짜리 묶음도 action을 그대로 싣는다", () => {
  const action = settingsOptionAction({
    question: FIRST,
    changes: [{
      layer: "common",
      key: "shell.reading_width",
      action: "set",
      value: 90,
    }],
    revision: 0,
    defaults_revision: "defaults-1",
  });
  const created = {
    id: GROUP,
    run: RUN,
    session: null,
    expires_at: "2026-01-01T01:00:00.000Z",
    questions: [{
      id: FIRST,
      prompt: "읽기 폭을 넓힐까요?",
      reason: "화면이 넓습니다",
      options: [{
        key: "wide",
        label: "넓게",
        evidence: [],
        adoption: null,
        action,
        description: "읽기 폭을 90으로 바꿉니다",
      }],
      recommendation: null,
    }],
  };
  const { stored, text } = storedOf(created);
  const request = questionWaitRequest(stored, text);
  assertEquals(request.input, created);
  assertEquals(
    createQuestionGroupInputSchema.safeParse(request.input).success,
    true,
  );
});
