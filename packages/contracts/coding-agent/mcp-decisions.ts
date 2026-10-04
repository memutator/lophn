import { z } from "zod";
import {
  contextCreateInputSchema,
  contextGet,
  contextList,
  contextPerspectiveSchema,
  contextRelated,
  contextRemoveItemInputSchema,
  contextSetItemInputSchema,
  contextUpdateInputSchema,
  nonblankSchema,
  outlineContext,
  termList,
  termProposeInputSchema,
  termUpdateInputSchema,
} from "../documents/mod.ts";
import { questionList, questionRead } from "../lophn-agent/mod.ts";
import { approvalsGet, approvalsList } from "../platform/approvals.ts";
import { idempotencyKeySchema } from "../platform/envelope.ts";
import { thingsToConfirmLinkSchema } from "../shell/mod.ts";
import { readOnlyHint, type ScopeMark, type Toolset } from "./output.ts";

// tool 입력은 owner route 입력을 다시 적지 않는다. filter 이름도 owner 것이 그대로다
// (질문·approval 표의 state는 questionList·approvalsList의 status).
const questionInput = z.discriminatedUnion("op", [
  questionList.input.extend({ op: z.literal("list") }),
  questionRead.input.extend({ op: z.literal("show") }),
]);

const approvalInput = z.discriminatedUnion("op", [
  approvalsList.input.extend({ op: z.literal("list") }),
  approvalsGet.input.extend({ op: z.literal("show") }),
]);

// 생성·이름 변경·항목 추가와 관점 변경·항목 제거는 context가 소유한 command 입력,
// 용어 추가와 채택 변경은 term이 소유한 command 입력을 그대로 빌린다. definition
// 직접 변경(term.define)과 보관·해제는 사람 권한이라 없다. 분할·병합은
// documents/contexts가 두지 않는 동작이라 이 union에도 없다.
const contextChangeSchema = z.discriminatedUnion("kind", [
  contextCreateInputSchema.extend({ kind: z.literal("create") }),
  contextUpdateInputSchema.extend({ kind: z.literal("rename") }),
  contextSetItemInputSchema.extend({ kind: z.literal("set_item") }),
  contextRemoveItemInputSchema.extend({ kind: z.literal("remove_item") }),
  termProposeInputSchema.extend({ kind: z.literal("term_propose") }),
  termUpdateInputSchema.extend({ kind: z.literal("term_update") }),
]);

// propose는 변경안과 이유를 받아 고정 변경안 문서로 남긴다. context·term은 그대로이고
// run도 질문도 만들지 않는다. CLI의 context propose는 op 없이 같은 필드를 받는다.
export const contextProposeFields = {
  change: contextChangeSchema,
  reason: nonblankSchema,
  idempotency_key: idempotencyKeySchema.optional(),
};

const contextInput = z.discriminatedUnion("op", [
  contextList.input.extend({ op: z.literal("list") }),
  contextGet.input.extend({ op: z.literal("show") }),
  // 관점은 기준·참고·watch를 같은 순서로 구별한다(architecture/coding-agent 5.2).
  outlineContext.input.extend({
    op: z.literal("items"),
    perspective: contextPerspectiveSchema.optional(),
  }),
  termList.input.extend({ op: z.literal("glossary") }),
  contextRelated.input.extend({ op: z.literal("of") }),
  z.strictObject({ op: z.literal("propose"), ...contextProposeFields }),
]);

export const MCP_DECISION_TOOLS = [
  {
    name: "lophn_context",
    toolset: "core",
    scope: "S",
    input: contextInput,
    ops: ["list", "show", "items", "glossary", "of", "propose"],
  },
  {
    name: "lophn_question",
    toolset: "core",
    scope: "S",
    input: questionInput,
    ops: ["list", "show"],
  },
  {
    name: "lophn_approval",
    toolset: "core",
    scope: "S",
    input: approvalInput,
    ops: ["list", "show"],
  },
] as const satisfies readonly {
  name: string;
  toolset: Toolset;
  scope: ScopeMark;
  input: z.ZodType;
  ops: readonly string[];
}[];

export type McpDecisionToolName = (typeof MCP_DECISION_TOOLS)[number]["name"];

export const MCP_DECISION_ROUTES = {
  lophn_context: {
    list: contextList,
    show: contextGet,
    items: outlineContext,
    glossary: termList,
    of: contextRelated,
    // propose는 owner command를 부르지 않는다. 변경안 문서 저장은 host의 몫이다.
    propose: contextProposeFields,
  },
  lophn_question: {
    list: questionList,
    show: questionRead,
  },
  lophn_approval: {
    list: approvalsList,
    show: approvalsGet,
  },
} as const;

export function mcpDecisionTool(name: string) {
  const tool = MCP_DECISION_TOOLS.find((item) => item.name === name);
  if (!tool) return undefined;
  return { ...tool, readOnlyHint: readOnlyHint(tool.name) };
}

// 질문·approval 대기는 사람이 결정하는 화면에서 열린다. confirmation window를 열지
// 않고 링크만 낸다(cli#R7·R21).
export function decisionLink(id: string): string {
  return thingsToConfirmLinkSchema.parse(`lophn://things-to-confirm/${id}`);
}
