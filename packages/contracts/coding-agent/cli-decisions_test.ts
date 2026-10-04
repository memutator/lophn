import { assertEquals } from "@std/assert";
import {
  contextGet,
  contextList,
  contextRelated,
  outlineContext,
  termList,
} from "../documents/mod.ts";
import { doc, version } from "../documents/document-fixtures.ts";
import { approvalsGet, approvalsList } from "../platform/approvals.ts";
import { questionList, questionRead } from "../lophn-agent/mod.ts";
import {
  CLI_DECISION_COMMANDS,
  CLI_DECISION_NAMES,
  cliApprovalListSchema,
  cliApprovalOpenSchema,
  cliApprovalShowSchema,
  cliContextGlossarySchema,
  cliContextItemsSchema,
  cliContextListSchema,
  cliContextOfSchema,
  cliContextShowSchema,
  cliQuestionListSchema,
  cliQuestionOpenSchema,
  cliQuestionShowSchema,
  decisionLink,
} from "./cli-decisions.ts";
import { CLI_CORE_NAMES, cliCommonSchema } from "./cli-core.ts";

const CTX = "ctx_01arz3ndektsv4rrffq69g5fav";
const TRM = "trm_01arz3ndektsv4rrffq69g5fav";
const QST = "qst_01arz3ndektsv4rrffq69g5fav";
const APR = "apr_01arz3ndektsv4rrffq69g5fav";

const proposeChange = {
  kind: "set_item" as const,
  context: CTX,
  item: {
    target: { kind: "document" as const, document: doc, section: null },
    perspective: "watch" as const,
    reason: "판단 뒤 확인 대상",
  },
};

Deno.test("coding-agent/cli#R18, coding-agent/cli#R19: context command는 읽기 여섯과 propose뿐이다", () => {
  assertEquals(CLI_DECISION_NAMES, [
    "context list",
    "context show",
    "context items",
    "context glossary",
    "context of",
    "context propose",
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

  cliContextListSchema.parse({ command: "context list", status: "archived" });
  cliContextShowSchema.parse({ command: "context show", context: CTX });
  cliContextItemsSchema.parse({
    command: "context items",
    context: CTX,
    perspective: "basis",
    json: true,
  });
  cliContextGlossarySchema.parse({
    command: "context glossary",
    context: CTX,
    limit: 30,
  });
  cliContextOfSchema.parse({
    command: "context of",
    target: { kind: "document", document: doc, section: null },
  });
  assertEquals(
    cliContextListSchema.safeParse({ command: "context list", depth: 2 })
      .success,
    false,
  );

  const propose = CLI_DECISION_COMMANDS[5];
  propose.parse({
    command: "context propose",
    change: proposeChange,
    reason: "근거 문서가 새로 저장됐다",
    idempotency_key: "propose-1",
  });
  propose.parse({
    command: "context propose",
    change: { kind: "term_update", term: TRM, definition: "확정 시각" },
    reason: "용어 정의를 고친다",
  });
  propose.parse({
    command: "context propose",
    change: {
      kind: "term_propose",
      id: TRM,
      context: CTX,
      name: "기한",
      evidence: [
        { document: doc, version, section: null, start_line: 4, end_line: 8 },
      ],
    },
    reason: "새 용어를 제안한다",
  });
  // 폴더·미추적 파일 항목, 빈 이유, create·set_item 같은 생성·편집 command는 없다.
  assertEquals(
    propose.safeParse({
      command: "context propose",
      change: {
        kind: "set_item",
        context: CTX,
        item: {
          target: { kind: "folder", path: "/work/docs" },
          perspective: "basis",
          reason: "폴더",
        },
      },
      reason: "폴더를 넣는다",
    }).success,
    false,
  );
  assertEquals(
    propose.safeParse({
      command: "context propose",
      change: proposeChange,
      reason: " ",
    }).success,
    false,
  );
  for (
    const command of [
      "context create",
      "context set-item",
      "context archive",
      "context define",
    ]
  ) {
    assertEquals(
      propose.safeParse({ command, change: proposeChange, reason: "r" })
        .success,
      false,
    );
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

Deno.test("coding-agent/cli#R18, coding-agent/cli#R21: command 입력은 owner route 입력을 그대로 쓰고 위치 인자를 만들지 않는다", () => {
  // CLI가 MCP가 고른 op 밖의 입력 field를 만들지 않는다(계획 Q39).
  const common = ["command", ...Object.keys(cliCommonSchema.shape)];
  const fields = (schema: { shape: Record<string, unknown> }) =>
    Object.keys(schema.shape).filter((field) => !common.includes(field)).sort();

  assertEquals(fields(cliContextListSchema), [
    "cursor",
    "limit",
    "status",
  ]);
  assertEquals(fields(cliContextListSchema), [
    ...Object.keys(contextList.input.shape).sort(),
  ]);
  assertEquals(fields(cliContextShowSchema), ["context"]);
  assertEquals(
    fields(cliContextShowSchema),
    Object.keys(contextGet.input.shape).sort(),
  );
  assertEquals(fields(cliContextGlossarySchema), [
    "context",
    "cursor",
    "limit",
  ]);
  assertEquals(
    fields(cliContextGlossarySchema),
    Object.keys(termList.input.shape).sort(),
  );
  assertEquals(fields(cliContextOfSchema), [
    "cursor",
    "limit",
    "status",
    "target",
  ]);
  assertEquals(
    fields(cliContextOfSchema),
    Object.keys(contextRelated.input.shape).sort(),
  );
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
  // items는 outline.context 입력에 CLI 관점을 더한 것이고 owner의 depth는 없다.
  const items = fields(cliContextItemsSchema);
  assertEquals(
    items.filter((field) => field !== "perspective"),
    [...Object.keys(outlineContext.input.shape).sort()],
  );
  for (
    const schema of [
      cliContextListSchema,
      cliQuestionListSchema,
      cliApprovalListSchema,
    ]
  ) {
    assertEquals(
      schema.safeParse({ command: "", depth: 2 }).success,
      false,
    );
  }
  assertEquals(
    cliContextItemsSchema.safeParse({
      command: "context items",
      context: CTX,
      depth: 2,
    }).success,
    false,
  );
  // --app은 CLI 공통 선택값이라 tool filter가 아니다(architecture 5.4).
  cliContextListSchema.parse({
    command: "context list",
    app: "app_01arz3ndektsv4rrffq69g5fav",
  });
});

Deno.test("coding-agent/cli#R19: propose는 고정 변경안·이유만 받고 그것만으로 context·용어를 바꾸지 않는다", () => {
  const propose = CLI_DECISION_COMMANDS[5];
  // 제안 입력은 변경안·이유·idempotency key뿐이고 결과로 적용할 CAS를 받지 않는다.
  assertEquals(
    Object.keys(propose.shape).filter((field) =>
      !["command", ...Object.keys(cliCommonSchema.shape)].includes(field)
    ).sort(),
    ["change", "reason"],
  );
  // 관점 변경·분할·병합은 owner command가 없어 union에도 없다.
  for (
    const change of [
      {
        kind: "perspective",
        context: CTX,
        target: { kind: "document", document: doc, section: null },
        perspective: "watch",
      },
      { kind: "split", context: CTX },
      { kind: "merge", context: CTX, from: CTX },
      { kind: "adopt", term: TRM, definition: "정한 뜻" },
      { kind: "archive", context: CTX },
      { kind: "unarchive", context: CTX },
    ]
  ) {
    assertEquals(
      propose.safeParse({ command: "context propose", change, reason: "r" })
        .success,
      false,
    );
  }
  // 적용 command처럼 보이는 이름은 이 schema가 받지 않는다.
  for (
    const command of [
      "context rename",
      "context set-item",
      "context remove-item",
      "context term-propose",
      "context term-update",
    ]
  ) {
    assertEquals(
      propose.safeParse({
        command,
        change: proposeChange,
        reason: "r",
      }).success,
      false,
    );
  }
});
