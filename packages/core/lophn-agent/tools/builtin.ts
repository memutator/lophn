import {
  type BuiltinToolName,
  builtinToolNames,
  TOOL_INPUTS,
} from "../../../protocol/lophn-agent/tool-catalog.ts";
import type { Role } from "../../../protocol/lophn-agent/places.ts";
import { APP_TOOLS } from "./bundles/app.ts";
import { ASK_TOOLS } from "./bundles/ask.ts";
import { CALL_TOOLS } from "./bundles/call.ts";
import { CONTEXT_TOOLS } from "./bundles/context.ts";
import { FILE_TOOLS } from "./bundles/file.ts";
import { GUIDE_TOOLS } from "./bundles/guide.ts";
import { INSTRUCTION_TOOLS } from "./bundles/instructions.ts";
import { OPERATOR_TOOLS } from "./bundles/operator.ts";
import { OUTLINE_TOOLS } from "./bundles/outline.ts";
import { PACKAGE_TOOLS } from "./bundles/package.ts";
import { PROBLEM_TOOLS } from "./bundles/problem.ts";
import { RELEASE_TOOLS } from "./bundles/release.ts";
import { SHELL_TOOLS } from "./bundles/shell.ts";
import { SKILL_TOOLS } from "./bundles/skill.ts";
import { TICKET_TOOLS } from "./bundles/ticket.ts";
import { VISUAL_TOOLS } from "./bundles/visual.ts";
import { WEB_TOOLS } from "./bundles/web.ts";
import type { ToolDefinition } from "./registry.ts";

// 묶음 file의 정의를 모은다. 이름이 겹치는지는 wire 표를 만들 때 본다(wire.ts).
export function builtinTools(): readonly ToolDefinition[] {
  return [
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
    ...OUTLINE_TOOLS,
    ...CALL_TOOLS,
    ...ASK_TOOLS,
    ...SKILL_TOOLS,
  ];
}

const DECLARED_ORDER = Object.keys(TOOL_INPUTS) as BuiltinToolName[];

// role이 고정한 목록이다. 목록에도 실행에도 이 밖의 tool은 없다.
// 순서는 `TOOL_INPUTS` 선언 순서다(같은 판의 같은 bytes). model이 image를 받지 못하면 `image.read`를 뺀다.
// 아직 정의가 없는 이름(채우는 task가 오기 전)은 건너뛴다.
export function listRoleTools(
  role: Role,
  model: { input_media: readonly string[] },
  definitions: readonly ToolDefinition[] = builtinTools(),
): readonly ToolDefinition[] {
  const allowed = new Set<string>(builtinToolNames(role));
  if (!model.input_media.includes("image")) allowed.delete("image.read");
  const byName = new Map(definitions.map((tool) => [tool.name, tool]));
  const listed: ToolDefinition[] = [];
  for (const name of DECLARED_ORDER) {
    const definition = byName.get(name);
    if (allowed.has(name) && definition !== undefined) {
      listed.push(definition);
    }
  }
  return listed;
}
