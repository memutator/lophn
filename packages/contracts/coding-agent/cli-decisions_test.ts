import { assertEquals } from "@std/assert";
import { approvalsGet, approvalsList } from "../platform/approvals.ts";
import { questionList, questionRead } from "../lophn-agent/mod.ts";
import {
  CLI_DECISION_COMMANDS,
  CLI_DECISION_NAMES,
  cliApprovalListSchema,
  cliApprovalOpenSchema,
  cliApprovalShowSchema,
  cliQuestionListSchema,
  cliQuestionOpenSchema,
  cliQuestionShowSchema,
  decisionLink,
} from "./cli-decisions.ts";
import { CLI_CORE_NAMES, cliCommonSchema } from "./cli-core.ts";

const QST = "qst_01arz3ndektsv4rrffq69g5fav";
const APR = "apr_01arz3ndektsv4rrffq69g5fav";

Deno.test("coding-agent/cli#R21: 결정 command는 질문과 approval의 list·show·open뿐이다", () => {
  assertEquals(CLI_DECISION_NAMES, [
    "question list",
    "question show",
    "question open",
    "approval list",
    "approval show",
    "approval open",
  ]);
  assertEquals(CLI_DECISION_COMMANDS.length, CLI_DECISION_NAMES.length);
  // core의 command 이름과 겹치지 않는다.
  for (const name of CLI_DECISION_NAMES) {
    assertEquals(CLI_CORE_NAMES.includes(name as never), false);
  }
  assertEquals(
    cliCommonSchema.safeParse({ json: true }).success,
    true,
  );
});

Deno.test("coding-agent/cli#R21: 질문·approval은 list·show·open이고 open은 링크만 낸다", () => {
  cliQuestionListSchema.parse({ command: "question list", status: "pending" });
  cliQuestionShowSchema.parse({ command: "question show", question: QST });
  cliApprovalListSchema.parse({
    command: "approval list",
    status: "pending",
    run: "run_01arz3ndektsv4rrffq69g5fav",
  });
  cliApprovalShowSchema.parse({ command: "approval show", approval: APR });

  cliQuestionOpenSchema.parse({
    command: "question open",
    question: QST,
    json: true,
  });
  cliApprovalOpenSchema.parse({ command: "approval open", approval: APR });
  assertEquals(decisionLink(QST), `lophn://things-to-confirm/${QST}`);
  assertEquals(decisionLink(APR), `lophn://things-to-confirm/${APR}`);

  // 답·허락·거절·승인 입력은 없다(approve·reject 별칭도 없다).
  for (
    const fields of [
      { answer: { kind: "option", option_key: "a", text_blob: null } },
      { binding_hash: "a".repeat(64) },
      { grant: true },
      { allow: true },
      { reject: true },
      { decision: "grant" },
      { approve: true },
    ]
  ) {
    assertEquals(
      cliQuestionOpenSchema.safeParse({
        command: "question open",
        question: QST,
        ...fields,
      }).success,
      false,
    );
    assertEquals(
      cliApprovalOpenSchema.safeParse({
        command: "approval open",
        approval: APR,
        ...fields,
      }).success,
      false,
    );
  }
  for (
    const command of [
      "question answer",
      "question defer",
      "question cancel",
      "approval grant",
      "approval reject",
      "approval cancel",
      "approval apply",
      "approval consume",
    ]
  ) {
    assertEquals(
      cliQuestionOpenSchema.safeParse({ command, question: QST }).success,
      false,
    );
    assertEquals(
      cliApprovalOpenSchema.safeParse({ command, approval: APR }).success,
      false,
    );
  }
  assertEquals(
    cliQuestionOpenSchema.safeParse({
      command: "question open",
      question: "qst_bad",
    })
      .success,
    false,
  );
});

Deno.test("coding-agent/cli#R21: command 입력은 owner route 입력을 그대로 쓰고 위치 인자를 만들지 않는다", () => {
  // CLI가 MCP가 고른 op 밖의 입력 field를 만들지 않는다(계획 Q39).
  const common = ["command", ...Object.keys(cliCommonSchema.shape)];
  const fields = (schema: { shape: Record<string, unknown> }) =>
    Object.keys(schema.shape).filter((field) => !common.includes(field)).sort();

  assertEquals(fields(cliQuestionListSchema), [
    "assignment",
    "cursor",
    "run",
    "status",
  ]);
  assertEquals(
    fields(cliQuestionListSchema),
    Object.keys(questionList.input.shape).sort(),
  );
  assertEquals(fields(cliQuestionShowSchema), ["question"]);
  assertEquals(
    fields(cliQuestionShowSchema),
    Object.keys(questionRead.input.shape).sort(),
  );
  assertEquals(fields(cliApprovalListSchema), ["limit", "run", "status"]);
  assertEquals(
    fields(cliApprovalListSchema),
    Object.keys(approvalsList.input.shape).sort(),
  );
  assertEquals(fields(cliApprovalShowSchema), ["approval"]);
  assertEquals(
    fields(cliApprovalShowSchema),
    Object.keys(approvalsGet.input.shape).sort(),
  );
  for (
    const schema of [
      cliQuestionListSchema,
      cliApprovalListSchema,
    ]
  ) {
    assertEquals(
      schema.safeParse({ command: "", depth: 2 }).success,
      false,
    );
  }
  // --app은 CLI 공통 선택값이라 tool filter가 아니다(architecture 5.4).
  cliApprovalListSchema.parse({
    command: "approval list",
    app: "app_01arz3ndektsv4rrffq69g5fav",
  });
});
