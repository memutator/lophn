import type { ToolDefinition } from "../../lophn-agent/tools/spi.ts";
import { PREVIEW_TOOLS } from "./preview.ts";
import { VISUAL_TOOLS } from "./visual.ts";

// 순서는 `main/agent-tools.ts`가 `TOOL_ORDER`로 다시 정렬하므로 여기서는 뜻이 없다.
export const APPS_AGENT_TOOLS: readonly ToolDefinition[] = [
  ...PREVIEW_TOOLS,
  ...VISUAL_TOOLS,
];
