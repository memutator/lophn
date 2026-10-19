import type { ToolDefinition } from "../../lophn-agent/tools/spi.ts";
import { CONTEXT_TOOLS } from "./context.ts";
import { GUIDE_TOOLS } from "./guide.ts";
import { INSTRUCTION_TOOLS } from "./instructions.ts";
import { KIND_TOOLS } from "./kind.ts";
import { OPERATOR_TOOLS } from "./operator.ts";

// role 규칙(role마다 보이는 범위, 만들 수 있는 place)이 든 tool이다. 나머지 tool은 harness와 domain이 정의한다.
export const ROLE_AGENT_TOOLS: readonly ToolDefinition[] = [
  ...GUIDE_TOOLS,
  ...INSTRUCTION_TOOLS,
  ...OPERATOR_TOOLS,
  ...CONTEXT_TOOLS,
  ...KIND_TOOLS,
];
