import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../../../base/mod.ts";
import {
  checkGroupOpen,
  collectGroupAnswers,
  deferGroup,
  GROUP_MAX_QUESTIONS,
  GROUP_MIN_QUESTIONS,
  type GroupAnswerInput,
  type GroupQuestionShape,
  type GroupState,
  validateNewGroup,
} from "./group.ts";

// 질문 묶음의 순수 검사. 시각은 인자로 주입하고 ID·저장소·blob·confirmation은 쓰지 않는다.
// 실제 core 위의 command(저장·event·재개)는 agent-I13이 본다.

const FIXED_ACTION = {
  concern: "documents/versions",
  command: "move_document",
};

function code(result: Result<unknown>): string {
  return result.ok ? "ok" : result.error.code;
}

// 선택지 key 목록으로 질문을 만든다. "act:"로 시작하는 key는 고정 action이 있는 선택지다.
function question(
  id: string,
  keys: readonly string[],
  recommendation: string | null = null,
): GroupQuestionShape {
  return {
    id,
    options: keys.map((key) => ({
      key,
      action: key.startsWith("act:") ? FIXED_ACTION : null,
    })),
    recommendation: recommendation === null
      ? null
      : { option_key: recommendation },
  };
}

const A = question("qst_a", ["x", "y"]);
const B = question("qst_b", ["p", "q", "r"]);
const C = question("qst_c", []);
const D = question("qst_d", ["m"]);
const E = question("qst_e", ["n"]);

function group(
  questions: readonly GroupQuestionShape[],
  change: Partial<GroupState> = {},
): GroupState {
  return {
    status: "pending",
    created_seq: "4",
    expires_at: null,
    questions,
    ...change,
  };
}

function option(question: string, option_key: string): GroupAnswerInput {
  return { question, answer: { kind: "option", option_key } };
}

function text(question: string, value: string): GroupAnswerInput {
  return { question, answer: { kind: "text", text: value } };
}

Deno.test("lophn-agent/questions#R1 [agent-I7]: 묶음은 질문 1개부터 4개까지다", () => {
  assertEquals(GROUP_MIN_QUESTIONS, 1);
  assertEquals(GROUP_MAX_QUESTIONS, 4);
  assertEquals(code(validateNewGroup([A])), "ok");
  assertEquals(code(validateNewGroup([A, B])), "ok");
  assertEquals(code(validateNewGroup([A, B, C])), "ok");
  assertEquals(code(validateNewGroup([A, B, C, D])), "ok");
  assertEquals(code(validateNewGroup([])), "invalid_input");
  assertEquals(code(validateNewGroup([A, B, C, D, E])), "invalid_input");
});

Deno.test("lophn-agent/questions#R1 [agent-I7]: 질문 ID와 질문 안 선택지 key는 겹치지 않는다", () => {
  assertEquals(
    code(validateNewGroup([A, { ...B, id: A.id }])),
    "invalid_input",
  );
  assertEquals(
    code(validateNewGroup([question("qst_a", ["x", "x"])])),
    "invalid_input",
  );
  // 다른 질문의 선택지 key와 같은 것은 괜찮다.
  assertEquals(
    code(
      validateNewGroup([question("qst_a", ["x"]), question("qst_b", ["x"])]),
    ),
    "ok",
  );
});

Deno.test("lophn-agent/questions#R3 [agent-I7]: 추천은 실제 선택지를 가리키고 선택지 7개도 묶음에 들어간다", () => {
  const seven = question(
    "qst_a",
    ["a", "b", "c", "d", "e", "f", "g"],
    "d",
  );
  assertEquals(code(validateNewGroup([seven])), "ok");
  // 없는 선택지를 추천할 수 없다.
  assertEquals(
    code(validateNewGroup([question("qst_a", ["x"], "missing")])),
    "invalid_input",
  );
  // 선택지가 없는 질문은 추천 선택지도 없다.
  assertEquals(
    code(validateNewGroup([question("qst_a", [], "x")])),
    "invalid_input",
  );
  assertEquals(
    code(
      validateNewGroup([{
        id: "qst_a",
        options: [],
        recommendation: { option_key: null },
      }]),
    ),
    "ok",
  );
});

Deno.test("lophn-agent/questions#R13 [agent-I7]: 고정 action이 있는 선택지를 가진 질문은 질문 1개짜리 묶음으로만 낸다", () => {
  const fixed = question("qst_f", ["act:move", "explain"]);
  assertEquals(code(validateNewGroup([fixed])), "ok");
  assertEquals(code(validateNewGroup([fixed, A])), "invalid_input");
  assertEquals(code(validateNewGroup([A, fixed])), "invalid_input");
  assertEquals(code(validateNewGroup([A, B, C, fixed])), "invalid_input");
  // 다른 질문의 선택지에 action이 없으면 여럿을 묶어도 된다.
  assertEquals(code(validateNewGroup([A, B])), "ok");
});

Deno.test("lophn-agent/questions#R4 [agent-I7]: 묶음의 답은 모든 질문에 하나씩 있어야 하고 질문 순서대로 정리된다", () => {
  const g = group([A, B, C]);
  const answers = [
    text("qst_c", "free"),
    option("qst_b", "q"),
    option("qst_a", "x"),
  ];
  const result = collectGroupAnswers(g, answers);
  assert(result.ok);
  // 낸 순서가 아니라 묶음의 position 순서다.
  assertEquals(result.value, [
    option("qst_a", "x"),
    option("qst_b", "q"),
    text("qst_c", "free"),
  ]);
  // 질문 하나짜리 묶음도 같다.
  const single = collectGroupAnswers(group([A]), [option("qst_a", "y")]);
  assert(single.ok);
  assertEquals(single.value, [option("qst_a", "y")]);
});

Deno.test("lophn-agent/questions#R4 [agent-I7]: 일부만 답한 묶음·없는 질문·중복 답은 invalid_input이다", () => {
  const g = group([A, B, C]);
  const full = [option("qst_a", "x"), option("qst_b", "p"), text("qst_c", "t")];
  assertEquals(code(collectGroupAnswers(g, full)), "ok");
  // 일부만.
  assertEquals(code(collectGroupAnswers(g, full.slice(0, 2))), "invalid_input");
  assertEquals(code(collectGroupAnswers(g, [])), "invalid_input");
  // 묶음에 없는 질문.
  assertEquals(
    code(collectGroupAnswers(g, [...full, option("qst_z", "x")])),
    "invalid_input",
  );
  assertEquals(
    code(collectGroupAnswers(g, [full[0], full[1], option("qst_z", "x")])),
    "invalid_input",
  );
  // 같은 질문을 두 번.
  assertEquals(
    code(collectGroupAnswers(g, [...full, option("qst_a", "y")])),
    "invalid_input",
  );
  assertEquals(
    code(collectGroupAnswers(g, [full[0], full[0], full[2]])),
    "invalid_input",
  );
});

Deno.test("lophn-agent/questions#R3 [agent-I7]: 선택지 답은 그 질문의 선택지 key여야 한다", () => {
  const g = group([A, B]);
  assertEquals(
    code(collectGroupAnswers(g, [option("qst_a", "x"), option("qst_b", "p")])),
    "ok",
  );
  // 다른 질문의 key, 없는 key, 빈 key.
  assertEquals(
    code(collectGroupAnswers(g, [option("qst_a", "p"), option("qst_b", "p")])),
    "invalid_input",
  );
  assertEquals(
    code(
      collectGroupAnswers(g, [option("qst_a", "nope"), option("qst_b", "p")]),
    ),
    "invalid_input",
  );
  assertEquals(
    code(collectGroupAnswers(g, [option("qst_a", ""), option("qst_b", "p")])),
    "invalid_input",
  );
  // 선택지가 없는 질문에 선택지 답을 낼 수 없다.
  assertEquals(
    code(collectGroupAnswers(group([C]), [option("qst_c", "x")])),
    "invalid_input",
  );
});

Deno.test("lophn-agent/questions#R3 [agent-I7]: Other 자유 입력은 선택지가 있어도 없어도 받고 빈 글만 거절한다", () => {
  // 선택지가 있는 질문에도 별도 자유 입력을 받는다.
  const g = group([A, C]);
  const free = collectGroupAnswers(g, [
    text("qst_a", "Something else entirely."),
    text("qst_c", "Free."),
  ]);
  assert(free.ok);
  assertEquals(free.value, [
    text("qst_a", "Something else entirely."),
    text("qst_c", "Free."),
  ]);
  // 글은 받은 그대로다(앞뒤 공백·줄바꿈을 바꾸지 않는다).
  const raw = collectGroupAnswers(group([C]), [
    text("qst_c", "  two\nlines  "),
  ]);
  assert(raw.ok);
  assertEquals(raw.value, [text("qst_c", "  two\nlines  ")]);
  // 빈 답·공백뿐인 답은 답이 아니다.
  for (const blank of ["", " ", "\n\t "]) {
    assertEquals(
      code(collectGroupAnswers(group([C]), [text("qst_c", blank)])),
      "invalid_input",
    );
  }
  // 한 질문이 빈 글이면 묶음 전체가 거절이다.
  assertEquals(
    code(collectGroupAnswers(g, [text("qst_a", "ok"), text("qst_c", " ")])),
    "invalid_input",
  );
});

Deno.test("lophn-agent/questions#R3 [agent-I7]: 추천 표시는 답이 아니라서 빠진 답을 채우지 않는다", () => {
  const recommended = question("qst_a", ["x", "y"], "y");
  const g = group([recommended, B]);
  // 추천이 있어도 그 질문에 답이 없으면 빠진 것이다.
  assertEquals(
    code(collectGroupAnswers(g, [option("qst_b", "p")])),
    "invalid_input",
  );
  // 추천과 다른 답을 내면 낸 답이 그대로 남는다.
  const other = collectGroupAnswers(g, [
    option("qst_a", "x"),
    option("qst_b", "p"),
  ]);
  assert(other.ok);
  assertEquals(other.value[0], option("qst_a", "x"));
  // 추천 선택지를 직접 고른 답만 선택지 답이다.
  const same = collectGroupAnswers(g, [
    option("qst_a", "y"),
    option("qst_b", "p"),
  ]);
  assert(same.ok);
  assertEquals(same.value[0], option("qst_a", "y"));
});

Deno.test("lophn-agent/questions#R13 [agent-I7]: 고정 action이 있는 선택지를 고른 답은 이 경로로 받지 않는다(forbidden)", () => {
  const fixed = question("qst_f", ["act:move", "explain"]);
  const g = group([fixed]);
  assertEquals(
    code(collectGroupAnswers(g, [option("qst_f", "act:move")])),
    "forbidden",
  );
  // action이 없는 선택지와 자유 답은 같은 질문에서도 받는다.
  assertEquals(
    code(collectGroupAnswers(g, [option("qst_f", "explain")])),
    "ok",
  );
  assertEquals(
    code(collectGroupAnswers(g, [text("qst_f", "Move it somewhere else.")])),
    "ok",
  );
});

Deno.test("lophn-agent/questions#R15 [agent-I7]: 자유 답은 글 그대로이고 동작이나 선택지로 해석하지 않는다", () => {
  const fixed = question("qst_f", ["act:move", "explain"]);
  const result = collectGroupAnswers(group([fixed]), [
    text("qst_f", "act:move"),
  ]);
  assert(result.ok);
  // key와 같은 글을 냈어도 선택지 답이 되지 않는다.
  assertEquals(result.value, [text("qst_f", "act:move")]);
});

Deno.test("lophn-agent/questions#R7 [agent-I7]: 기한이 없으면 계속 열려 있고 기한 1ms 전까지 받고 경계 시각부터 거절한다", () => {
  const open = (expires_at: string | null, now: string) =>
    code(checkGroupOpen({ status: "pending", expires_at }, now));
  assertEquals(open(null, "2026-10-12T00:00:00.000Z"), "ok");
  assertEquals(open(null, "2099-01-01T00:00:00.000Z"), "ok");
  const deadline = "2026-10-12T12:00:00.000Z";
  assertEquals(open(deadline, "2026-10-12T11:59:59.000Z"), "ok");
  assertEquals(open(deadline, "2026-10-12T11:59:59.999Z"), "ok");
  assertEquals(open(deadline, deadline), "conflict");
  assertEquals(open(deadline, "2026-10-12T12:00:00.001Z"), "conflict");
});

Deno.test("lophn-agent/questions#R9 [agent-I7]: 끝난 묶음의 늦은 답이나 중복 답은 conflict이다", () => {
  for (const status of ["answered", "expired", "cancelled"] as const) {
    assertEquals(
      code(
        checkGroupOpen(
          { status, expires_at: null },
          "2026-10-12T00:00:00.000Z",
        ),
      ),
      "conflict",
    );
  }
  assertEquals(
    code(
      checkGroupOpen(
        { status: "pending", expires_at: null },
        "2026-10-12T00:00:00.000Z",
      ),
    ),
    "ok",
  );
});

Deno.test("lophn-agent/questions#R6 [agent-I7]: Skip은 묶음 전체를 답 없이 미룬다", () => {
  const g = group([A, B], { created_seq: "4" });
  const result = deferGroup(g, "4", "2026-10-12T00:00:00.000Z");
  assert(result.ok);
  assertEquals(result.value, {
    status: "cancelled",
    closed_reason: "deferred",
    answers: null,
  });
  // 기한이 있어도 경계 전이면 미룰 수 있다.
  const timed = group([A], {
    expires_at: "2026-10-12T12:00:00.000Z",
  });
  assertEquals(code(deferGroup(timed, "4", "2026-10-12T11:59:59.999Z")), "ok");
});

Deno.test("lophn-agent/questions#R8 [agent-I7]: Skip은 사람이 본 내용과 다르거나 이미 끝난 묶음에는 conflict이고 무응답은 답이 아니다", () => {
  const now = "2026-10-12T00:00:00.000Z";
  // 다른 created_seq: 사람이 본 묶음이 아니다.
  assertEquals(code(deferGroup(group([A]), "5", now)), "conflict");
  // 이미 답했거나 끝난 묶음.
  for (const status of ["answered", "expired", "cancelled"] as const) {
    assertEquals(
      code(deferGroup(group([A], { status }), "4", now)),
      "conflict",
    );
  }
  // 기한이 지난 묶음.
  assertEquals(
    code(
      deferGroup(
        group([A], { expires_at: "2026-10-11T00:00:00.000Z" }),
        "4",
        now,
      ),
    ),
    "conflict",
  );
  // Skip의 결과에는 어떤 질문의 답도 없다(채택·동작 적용의 근거가 되지 않는다).
  const skipped = deferGroup(group([A, B]), "4", now);
  assert(skipped.ok);
  assertEquals(skipped.value.answers, null);
  assertEquals(skipped.value.closed_reason, "deferred");
});
