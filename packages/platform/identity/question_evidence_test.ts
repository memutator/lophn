import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../base/mod.ts";
import type { OptionAction } from "../../contracts/lophn-agent/mod.ts";
import type { AuthenticatedContext } from "../../contracts/platform/mod.ts";
import {
  type ChosenQuestionOption,
  questionEvidenceUse,
  type QuestionOptionSource,
  verifyQuestionEvidence,
} from "./mod.ts";
import { code } from "./fixtures_test.ts";

const QST = "qst_01arz3ndektsv4rrffq69g5fav";
const DOC = "doc_01arz3ndektsv4rrffq69g5fav";

const action: OptionAction = {
  concern: "documents/versions",
  command: "restore_section",
  targets: [DOC],
  input: { kind: "inline", value: { section: "intro" } },
  input_hash: "ab".repeat(32),
  comparison: { version_seq: "7" },
  binding_hash: "cd".repeat(32),
};

function machine(): AuthenticatedContext {
  return {
    actor: "machine",
    principal: "task:apply",
    credential_ref: "ref",
    scope: { operations: ["questions/apply-option"], targets: {} },
    conditions: { task: "apply", process: "worker" },
  };
}

function chosen(
  fixed: OptionAction | null = action,
  reversible = true,
  key = "adopt",
): QuestionOptionSource {
  return () =>
    ok<ChosenQuestionOption>({ option: { key, action: fixed }, reversible });
}

async function verify(
  source: QuestionOptionSource,
  submitted: OptionAction = action,
  evidence: { question: string; option: string } = {
    question: QST,
    option: "adopt",
  },
  ctx: AuthenticatedContext = machine(),
) {
  const use = questionEvidenceUse();
  const result = await verifyQuestionEvidence(
    ctx,
    evidence,
    submitted,
    source,
    use,
  );
  return { result, use };
}

Deno.test("platform/identity#R14: 사람이 고른 고정 option의 되돌릴 수 있는 action만 한 번 user로 기록한다", async () => {
  const first = await verify(chosen());
  assert(first.result.ok);
  // 같은 질문 option의 두 번째 적용은 거절한다.
  const again = await verifyQuestionEvidence(
    machine(),
    { question: QST, option: "adopt" },
    action,
    chosen(),
    first.use,
  );
  assertEquals(code(again), "conflict");
  // commit 실패는 예약을 풀어 다시 적용할 수 있다.
  first.use.release(QST, "adopt");
  const retried = await verifyQuestionEvidence(
    machine(),
    { question: QST, option: "adopt" },
    action,
    chosen(),
    first.use,
  );
  assert(retried.ok);
  first.use.commit(QST, "adopt");
  assertEquals(
    code(
      await verifyQuestionEvidence(
        machine(),
        { question: QST, option: "adopt" },
        action,
        chosen(),
        first.use,
      ),
    ),
    "conflict",
  );
});

Deno.test("platform/identity#R14: 다른 option·바뀐 입력·CAS·되돌릴 수 없는 동작·자유 답은 거절한다", async () => {
  // 다른 option.
  assertEquals(
    code(
      (await verify(chosen(), action, { question: QST, option: "other" }))
        .result,
    ),
    "forbidden",
  );
  // 바뀐 입력.
  assertEquals(
    code(
      (await verify(chosen(), {
        ...action,
        input: { kind: "inline", value: { section: "other" } },
      })).result,
    ),
    "forbidden",
  );
  // 바뀐 CAS.
  assertEquals(
    code(
      (await verify(chosen(), { ...action, comparison: { version_seq: "8" } }))
        .result,
    ),
    "forbidden",
  );
  // 동작 전체가 하나라도 다르면 거절한다.
  assertEquals(
    code(
      (await verify(chosen(), { ...action, command: "delete_section" })).result,
    ),
    "forbidden",
  );
  // 되돌릴 수 없는 동작.
  assertEquals(code((await verify(chosen(action, false))).result), "forbidden");
  // 자유 답은 고정 action이 없다.
  assertEquals(code((await verify(chosen(null))).result), "forbidden");
  // 정본이 거절하면 그 오류를 그대로 전한다.
  const missing: QuestionOptionSource = () =>
    err({ code: "not_found", message: "질문이 없다" });
  assertEquals(code((await verify(missing)).result), "not_found");
});

Deno.test("platform/identity#R14: 일반 machine의 user 주장과 agent의 근거 제출은 거절한다", async () => {
  // actor를 user라고 적어도 자격은 machine이 아니다.
  const claimed = machine();
  claimed.actor = "user";
  assertEquals(
    code((await verify(chosen(), action, undefined as never, claimed)).result),
    "forbidden",
  );
  // agent credential도 질문 근거로 user 기록을 만들지 못한다.
  const agent = machine();
  agent.actor = "agent:asg_01arz3ndektsv4rrffq69g5fav";
  assertEquals(
    code(
      (await verify(
        chosen(),
        action,
        { question: QST, option: "adopt" },
        agent,
      )).result,
    ),
    "forbidden",
  );
  // 질문 ID만 적고 option이 없으면 근거가 아니다.
  assertEquals(
    code(
      (await verify(chosen(), action, { question: QST, option: "" })).result,
    ),
    "forbidden",
  );
});
