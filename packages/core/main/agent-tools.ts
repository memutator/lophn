import { TOOL_ORDER } from "../../protocol/lophn-agent/tool-catalog.ts";
import { APP_TOOLS } from "../lophn-agent/tools/bundles/app.ts";
import { ASK_TOOLS } from "../lophn-agent/tools/bundles/ask.ts";
import { CALL_TOOLS } from "../lophn-agent/tools/bundles/call.ts";
import { CONTEXT_TOOLS } from "../lophn-agent/tools/bundles/context.ts";
import { FILE_TOOLS } from "../lophn-agent/tools/bundles/file.ts";
import { GUIDE_TOOLS } from "../lophn-agent/tools/bundles/guide.ts";
import { INSTRUCTION_TOOLS } from "../lophn-agent/tools/bundles/instructions.ts";
import { OPERATOR_TOOLS } from "../lophn-agent/tools/bundles/operator.ts";
import { PACKAGE_TOOLS } from "../lophn-agent/tools/bundles/package.ts";
import { PROBLEM_TOOLS } from "../lophn-agent/tools/bundles/problem.ts";
import { RELEASE_TOOLS } from "../lophn-agent/tools/bundles/release.ts";
import { SHELL_TOOLS } from "../lophn-agent/tools/bundles/shell.ts";
import { SKILL_TOOLS } from "../lophn-agent/tools/bundles/skill.ts";
import { TICKET_TOOLS } from "../lophn-agent/tools/bundles/ticket.ts";
import { VISUAL_TOOLS } from "../lophn-agent/tools/bundles/visual.ts";
import { WEB_TOOLS } from "../lophn-agent/tools/bundles/web.ts";
import type { ToolDefinition } from "../lophn-agent/tools/mod.ts";

// agent에게 줄 수 있는 내장 tool 전부를 모으는 유일한 곳(composition root)이다.
// 순서는 `TOOL_ORDER`다: model에 보이는 tool 순서가 바뀌면 같은 재료가 같은 bytes가 아니게 된다.
const DECLARED_ORDER = new Map<string, number>(
  TOOL_ORDER.map((name, at) => [name, at]),
);

export function agentTools(): readonly ToolDefinition[] {
  const all = [
    ...FILE_TOOLS,
    ...SHELL_TOOLS,
    ...WEB_TOOLS,
    ...TICKET_TOOLS,
    ...PROBLEM_TOOLS,
    ...APP_TOOLS,
    ...PACKAGE_TOOLS,
    ...RELEASE_TOOLS,
    ...GUIDE_TOOLS,
    ...OPERATOR_TOOLS,
    ...VISUAL_TOOLS,
    ...INSTRUCTION_TOOLS,
    ...CONTEXT_TOOLS,
    ...CALL_TOOLS,
    ...ASK_TOOLS,
    ...SKILL_TOOLS,
  ];
  const at = (tool: ToolDefinition) =>
    DECLARED_ORDER.get(tool.name) ?? Number.MAX_SAFE_INTEGER;
  return all.toSorted((a, b) => at(a) - at(b));
}
