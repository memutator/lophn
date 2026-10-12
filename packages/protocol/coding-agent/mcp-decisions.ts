import { z } from "zod";
import { questionList, questionRead } from "../lophn-agent/mod.ts";
import { approvalsGet, approvalsList } from "../platform/approvals.ts";
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

export const MCP_DECISION_TOOLS = [
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
