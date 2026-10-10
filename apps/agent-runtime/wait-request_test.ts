import { assertEquals } from "@std/assert";
import {
  createQuestionInputSchema,
  type questionRead,
  type questionText,
} from "../../packages/contracts/lophn-agent/mod.ts";
import type { z } from "zod";
import { questionWaitRequest } from "./wait-request.ts";

const QUESTION = "qst_01arz3ndektsv4rrffq69g5fav";
const RUN = "run_01arz3ndektsv4rrffq69g5fav";
const SESSION = "ses_01arz3ndektsv4rrffq69g5fav";
const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const VER = "ver_01arz3ndektsv4rrffq69g5fav";
const HASH = "ab".repeat(32);

Deno.test("lophn-agent/harness/waiting-and-recovery#R1: 질문 tool이 만든 질문은 저장된 글과 선택지로 WaitRun 요청이 되어 만든 입력과 같다", () => {
  const created = {
    id: QUESTION,
    run: RUN,
    session: SESSION,
    expires_at: null,
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
  };
  const stored = {
    id: QUESTION,
    run: RUN,
    session: SESSION,
    expires_at: null,
    prompt_blob: HASH,
    reason_blob: HASH,
    options: created.options.map(({ description: _, ...option }) => ({
      ...option,
      description_blob: HASH,
    })),
    recommendation: { option_key: "a", explanation_blob: HASH },
  } as unknown as z.output<typeof questionRead.output>["question"];
  const text = {
    question: QUESTION,
    prompt: created.prompt,
    reason: created.reason,
    options: created.options.map((option) => ({
      key: option.key,
      description: option.description,
    })),
    recommendation: created.recommendation,
  } as unknown as z.output<typeof questionText.output>;
  const request = questionWaitRequest(stored, text);
  assertEquals(request.kind, "question");
  assertEquals(request.input, created);
  assertEquals(
    createQuestionInputSchema.safeParse(request.input).success,
    true,
  );
});
