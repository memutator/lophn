import { TOOL_ORDER } from "../agent-places/tool-lists.ts";
import { PLACE_AGENT_TOOLS } from "../agent-places/tools/mod.ts";
import { APPS_AGENT_TOOLS } from "../apps/agent-tools/mod.ts";
import { DOMAIN_AGENT_TOOLS } from "../domains/agent-tools.ts";
import { JOB_AGENT_TOOLS } from "../jobs/agent-tools.ts";
import { ASK_TOOLS } from "../lophn-agent/tools/bundles/ask.ts";
import { CALL_TOOLS } from "../lophn-agent/tools/bundles/call.ts";
import { createFileTools } from "../lophn-agent/tools/bundles/file.ts";
import { SHELL_TOOLS } from "../lophn-agent/tools/bundles/shell.ts";
import { SKILL_TOOLS } from "../lophn-agent/tools/bundles/skill.ts";
import { TOOL_TOOLS } from "../lophn-agent/tools/bundles/tool.ts";
import { WEB_TOOLS } from "../lophn-agent/tools/bundles/web.ts";
import type { ToolDefinition } from "../lophn-agent/tools/mod.ts";
import type { FileHooks } from "../lophn-agent/tools/ports.ts";
import { WORKFLOW_AGENT_TOOLS } from "../workflows/agent-tools.ts";

// agent에게 줄 수 있는 내장 tool 전부를 모으는 유일한 곳(composition root)이다.
// place 층(`agent-places`)이 채우는 hook은 인자로 받는다. 순서는 `TOOL_ORDER`다: model에 보이는 tool 순서가 바뀌면 같은 재료가 같은 bytes가 아니게 된다.
const DECLARED_ORDER = new Map<string, number>(
  TOOL_ORDER.map((name, at) => [name, at]),
);

export function agentTools(hooks: {
  file: FileHooks;
}): readonly ToolDefinition[] {
  const all = [
    ...createFileTools(hooks.file),
    ...SHELL_TOOLS,
    ...WEB_TOOLS,
    ...APPS_AGENT_TOOLS,
    ...DOMAIN_AGENT_TOOLS,
    ...WORKFLOW_AGENT_TOOLS,
    ...JOB_AGENT_TOOLS,
    ...PLACE_AGENT_TOOLS,
    ...CALL_TOOLS,
    ...ASK_TOOLS,
    ...SKILL_TOOLS,
    ...TOOL_TOOLS,
  ];
  const at = (tool: ToolDefinition) =>
    DECLARED_ORDER.get(tool.name) ?? Number.MAX_SAFE_INTEGER;
  return all.toSorted((a, b) => at(a) - at(b));
}
