import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { questionList, questionRead } from "../lophn-agent/mod.ts";
import { approvalsGet, approvalsList } from "../platform/approvals.ts";
import {
  MCP_DECISION_ROUTES,
  MCP_DECISION_TOOLS,
  mcpDecisionTool,
} from "./mcp-decisions.ts";

const CTX = "ctx_01arz3ndektsv4rrffq69g5fav";

const tool = (name: string) => {
  const found = mcpDecisionTool(name);
  if (!found) throw new Error(name);
  return found;
};

// tool op 하나가 받는 field. `op`는 tool 것이므로 뺀다.
const branchFields = (input: unknown, op: string) => {
  const union = input as {
    options: { shape: Record<string, unknown> }[];
  };
  const branch = union.options.find((option) => {
    const value = (option.shape.op as unknown as { value?: string }).value;
    return value === op;
  });
  if (!branch) throw new Error(op);
  return Object.keys(branch.shape).filter((field) => field !== "op").sort();
};

Deno.test("coding-agent/mcp-server#R38 [ctx-R7]: 결정 tool은 질문과 approval의 list·show뿐이다", () => {
  assertEquals(MCP_DECISION_TOOLS.map((item) => item.name), [
    "lophn_question",
    "lophn_approval",
  ]);
  assertEquals(tool("lophn_question").ops, ["list", "show"]);
  assertEquals(tool("lophn_approval").ops, ["list", "show"]);
});

Deno.test("coding-agent/mcp-server#R18: 질문과 approval은 list·show만 있고 답·허락·거절·사용 op가 없다", () => {
  const question = tool("lophn_question");
  assertEquals(question.ops, ["list", "show"]);
  assertEquals(question.scope, "S");
  assertEquals(question.readOnlyHint, true);
  question.input.parse({ op: "list", status: "pending" });
  question.input.parse({
    op: "show",
    group: "qgr_01arz3ndektsv4rrffq69g5fav",
  });
  for (
    const op of [
      // R18이 이름으로 금지하는 op(답·허락·거절·사용)와 owner command.
      "answer",
      "allow",
      "reject",
      "consume",
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
        group: "qgr_01arz3ndektsv4rrffq69g5fav",
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
    const op of [
      // R18의 allow·reject·consume과 owner command.
      "allow",
      "reject",
      "consume",
      "grant",
      "expire",
      "cancel",
      "apply",
      "create",
    ]
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
  assertEquals(
    MCP_DECISION_ROUTES.lophn_question.list.name,
    "ListQuestionGroups",
  );
  assertEquals(
    MCP_DECISION_ROUTES.lophn_question.show.name,
    "ReadQuestionGroup",
  );
  assertEquals(MCP_DECISION_ROUTES.lophn_approval.list.name, "ListApprovals");
  assertEquals(MCP_DECISION_ROUTES.lophn_approval.show.name, "GetApproval");
  assert(mcpDecisionTool("lophn_save") === undefined);
});

Deno.test("coding-agent/mcp-server#R18: op 입력은 owner route 입력을 그대로 쓰고 모르는 filter를 만들지 않는다", () => {
  // owner read가 받지 않는 filter는 tool에도 없다. architecture 표의 state는
  // owner 이름 status이고 app filter는 owner route에 없다(계획 Q39).
  assertEquals(branchFields(tool("lophn_question").input, "list"), [
    "assignment",
    "cursor",
    "run",
    "session",
    "status",
  ]);
  assertEquals(branchFields(tool("lophn_question").input, "list"), [
    ...Object.keys(questionList.input.shape).sort(),
  ]);
  assertEquals(branchFields(tool("lophn_approval").input, "list"), [
    "limit",
    "run",
    "status",
  ]);
  assertEquals(branchFields(tool("lophn_approval").input, "list"), [
    ...Object.keys(approvalsList.input.shape).sort(),
  ]);
  // MCP tool마다 app filter와 depth를 거절한다.
  for (
    const [name, op] of [
      ["lophn_question", "list"],
      ["lophn_approval", "list"],
    ] as const
  ) {
    assertEquals(
      tool(name).input.safeParse({ op, app: "app_01arz3ndektsv4rrffq69g5fav" })
        .success,
      false,
    );
  }
  assertEquals(
    tool("lophn_question").input.safeParse({ op: "show", group: CTX })
      .success,
    false,
  );
  assertEquals(
    tool("lophn_approval").input.safeParse({ op: "show", approval: CTX })
      .success,
    false,
  );
});

Deno.test("coding-agent/mcp-server#R18: 읽기 op는 platform·lophn-agent read route와 같은 출력 schema를 쓴다", () => {
  assertEquals(
    MCP_DECISION_ROUTES.lophn_question.show.output,
    questionRead.output,
  );
  assertEquals(
    MCP_DECISION_ROUTES.lophn_question.list.output,
    questionList.output,
  );
  assertEquals(
    MCP_DECISION_ROUTES.lophn_approval.show.output,
    approvalsGet.output,
  );
  assertEquals(
    MCP_DECISION_ROUTES.lophn_approval.list.output,
    approvalsList.output,
  );
});

Deno.test("coding-agent/mcp-server#R18: op의 read route 오류 코드는 공통 7종 안이다", () => {
  const known = new Set<string>(ERROR_CODES);
  for (
    const route of [
      MCP_DECISION_ROUTES.lophn_question.list,
      MCP_DECISION_ROUTES.lophn_question.show,
      MCP_DECISION_ROUTES.lophn_approval.list,
      MCP_DECISION_ROUTES.lophn_approval.show,
    ]
  ) {
    for (const code of route.errors) assert(known.has(code));
  }
});
