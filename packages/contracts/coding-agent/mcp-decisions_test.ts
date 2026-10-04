import { assert, assertEquals } from "@std/assert";
import { doc, version } from "../documents/document-fixtures.ts";
import {
  MCP_DECISION_ROUTES,
  MCP_DECISION_TOOLS,
  mcpDecisionTool,
} from "./mcp-decisions.ts";

const CTX = "ctx_01arz3ndektsv4rrffq69g5fav";
const TRM = "trm_01arz3ndektsv4rrffq69g5fav";

const tool = (name: string) => {
  const found = mcpDecisionTool(name);
  if (!found) throw new Error(name);
  return found;
};

const documentItem = (perspective: "basis" | "reference" | "watch") => ({
  target: { kind: "document" as const, document: doc, section: null },
  perspective,
  reason: "판단 근거",
});

Deno.test("coding-agent/mcp-server#R17: context는 list·show·items·glossary·of·propose만 있고 읽기 주석이 없다", () => {
  assertEquals(MCP_DECISION_TOOLS.map((item) => item.name), [
    "lophn_context",
    "lophn_question",
    "lophn_approval",
  ]);
  const context = tool("lophn_context");
  assertEquals(context.ops, [
    "list",
    "show",
    "items",
    "glossary",
    "of",
    "propose",
  ]);
  assertEquals(context.toolset, "core");
  assertEquals(context.scope, "S");
  // propose가 있는 tool에는 읽기 전용 주석을 붙이지 않는다(output.ts READ_ONLY_TOOLS).
  assertEquals(context.readOnlyHint, undefined);
  context.input.parse({ op: "list", status: "archived" });
  context.input.parse({ op: "show", context: CTX });
  context.input.parse({ op: "items", context: CTX });
  context.input.parse({ op: "items", context: CTX, perspective: "watch" });
  context.input.parse({ op: "glossary", context: CTX });
  context.input.parse({
    op: "of",
    target: { kind: "document", document: doc, section: null },
  });
  assertEquals(
    context.input.safeParse({ op: "items", context: CTX, perspective: "nope" })
      .success,
    false,
  );
  assertEquals(
    context.input.safeParse({ op: "archive", context: CTX }).success,
    false,
  );
  assertEquals(
    context.input.safeParse({ op: "show", context: "ctx_bad" }).success,
    false,
  );
  assertEquals(
    context.input.safeParse({ op: "list", title: "x" }).success,
    false,
  );
});

Deno.test("coding-agent/mcp-server#R17: propose는 고정 변경안·이유만 받고 폴더·untracked 항목 제안을 거절한다", () => {
  const propose = {
    op: "propose" as const,
    reason: "기준 문서가 바뀌었다",
    idempotency_key: "propose-1",
  };
  const context = tool("lophn_context");
  context.input.parse({
    ...propose,
    change: {
      kind: "create",
      id: CTX,
      title: "결정 기록",
      purpose: "마감 판단",
      items: [documentItem("basis")],
    },
  });
  context.input.parse({
    ...propose,
    change: { kind: "rename", context: CTX, title: "결정 근거" },
  });
  context.input.parse({
    ...propose,
    change: { kind: "set_item", context: CTX, item: documentItem("reference") },
  });
  context.input.parse({
    ...propose,
    change: {
      kind: "remove_item",
      context: CTX,
      target: { kind: "document", document: doc, section: null },
    },
  });
  context.input.parse({
    ...propose,
    change: {
      kind: "term_propose",
      id: TRM,
      context: CTX,
      name: "기한",
      evidence: [
        {
          document: doc,
          version,
          section: "1. 제목",
          start_line: 1,
          end_line: 3,
        },
      ],
    },
  });
  context.input.parse({
    ...propose,
    change: { kind: "term_update", term: TRM, definition: "정해진 시각" },
  });
  // 폴더·미추적 파일 항목은 context target이 아니다(documents/contexts#R2).
  for (
    const target of [
      { kind: "folder", path: "/work/docs" },
      { kind: "file", path: "/work/docs/plan.md" },
      { kind: "untracked_file", path: "/work/scratch.md" },
    ]
  ) {
    assertEquals(
      context.input.safeParse({
        ...propose,
        change: {
          kind: "set_item",
          context: CTX,
          item: { target, perspective: "basis", reason: "근거" },
        },
      }).success,
      false,
    );
  }
  // definition을 직접 바꾸는 동작과 관점만 바꾸는 빈 입력은 없다.
  assertEquals(
    context.input.safeParse({
      ...propose,
      change: { kind: "term_define", term: TRM, definition: "x" },
    }).success,
    false,
  );
  assertEquals(
    context.input.safeParse({
      ...propose,
      change: { kind: "rename", context: CTX },
    }).success,
    false,
  );
  assertEquals(
    context.input.safeParse({
      ...propose,
      change: { kind: "split", context: CTX },
    }).success,
    false,
  );
  assertEquals(
    context.input.safeParse({
      op: "propose",
      reason: "  ",
      change: { kind: "rename", context: CTX, title: "이름" },
    }).success,
    false,
  );
  assertEquals(
    context.input.safeParse({
      op: "propose",
      change: { kind: "rename", context: CTX, title: "이름" },
    }).success,
    false,
  );
});

Deno.test("coding-agent/mcp-server#R18: 질문과 approval은 list·show만 있고 답·허락·거절·사용 op가 없다", () => {
  const question = tool("lophn_question");
  assertEquals(question.ops, ["list", "show"]);
  assertEquals(question.scope, "S");
  assertEquals(question.readOnlyHint, true);
  question.input.parse({ op: "list", status: "pending" });
  question.input.parse({
    op: "show",
    question: "qst_01arz3ndektsv4rrffq69g5fav",
  });
  for (
    const op of [
      "answer",
      "defer",
      "cancel",
      "expire",
      "apply-option",
      "create",
    ]
  ) {
    assertEquals(
      question.input.safeParse({
        op,
        question: "qst_01arz3ndektsv4rrffq69g5fav",
      })
        .success,
      false,
    );
  }
  assertEquals(
    question.input.safeParse({
      op: "list",
      status: "granted",
    }).success,
    false,
  );

  const approval = tool("lophn_approval");
  assertEquals(approval.ops, ["list", "show"]);
  assertEquals(approval.readOnlyHint, true);
  approval.input.parse({ op: "list", status: "pending" });
  approval.input.parse({
    op: "show",
    approval: "apr_01arz3ndektsv4rrffq69g5fav",
  });
  for (
    const op of ["grant", "reject", "expire", "cancel", "apply", "create"]
  ) {
    assertEquals(
      approval.input.safeParse({
        op,
        approval: "apr_01arz3ndektsv4rrffq69g5fav",
      }).success,
      false,
    );
  }
  assertEquals(
    approval.input.safeParse({ op: "show", approval: "apr_bad" }).success,
    false,
  );
});

Deno.test("coding-agent/mcp-server#R18: op는 owner read route를 가리킨다", () => {
  assertEquals(MCP_DECISION_ROUTES.lophn_question.list.name, "ListQuestions");
  assertEquals(MCP_DECISION_ROUTES.lophn_question.show.name, "ReadQuestion");
  assertEquals(MCP_DECISION_ROUTES.lophn_approval.list.name, "ListApprovals");
  assertEquals(MCP_DECISION_ROUTES.lophn_approval.show.name, "GetApproval");
  assertEquals(MCP_DECISION_ROUTES.lophn_context.list.name, "context.list");
  assertEquals(MCP_DECISION_ROUTES.lophn_context.show.name, "context.get");
  assertEquals(MCP_DECISION_ROUTES.lophn_context.items.name, "outline.context");
  assertEquals(MCP_DECISION_ROUTES.lophn_context.glossary.name, "term.list");
  assertEquals(MCP_DECISION_ROUTES.lophn_context.of.name, "context.related");
  // propose는 owner command를 부르지 않는다.
  assertEquals(
    Object.keys(MCP_DECISION_ROUTES.lophn_context.propose).sort(),
    ["change", "idempotency_key", "reason"],
  );
  assert(mcpDecisionTool("lophn_save") === undefined);
});
