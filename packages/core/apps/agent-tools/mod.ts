import type { ToolDefinition } from "../../lophn-agent/tools/spi.ts";
import { APP_TOOLS } from "./app.ts";
import { PACKAGE_TOOLS } from "./package.ts";
import { RELEASE_TOOLS } from "./release.ts";
import { TICKET_TOOLS } from "./ticket.ts";
import { VISUAL_TOOLS } from "./visual.ts";

// 순서는 `main/agent-tools.ts`가 `TOOL_ORDER`로 다시 정렬하므로 여기서는 뜻이 없다.
export const APPS_AGENT_TOOLS: readonly ToolDefinition[] = [
  ...TICKET_TOOLS,
  ...APP_TOOLS,
  ...PACKAGE_TOOLS,
  ...RELEASE_TOOLS,
  ...VISUAL_TOOLS,
];
