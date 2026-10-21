import type { ToolDefinition } from "../../lophn-agent/tools/spi.ts";
import { APP_TOOLS } from "./app.ts";
import { PACKAGE_TOOLS } from "./package.ts";
import { PREVIEW_TOOLS } from "./preview.ts";
import { RELEASE_TOOLS } from "./release.ts";
import { RUNTIME_TOOLS } from "./runtime.ts";
import { VISUAL_TOOLS } from "./visual.ts";

// 순서는 `main/agent-tools.ts`가 `TOOL_ORDER`로 다시 정렬하므로 여기서는 뜻이 없다.
export const APPS_AGENT_TOOLS: readonly ToolDefinition[] = [
  ...APP_TOOLS,
  ...RUNTIME_TOOLS,
  ...PACKAGE_TOOLS,
  ...RELEASE_TOOLS,
  ...PREVIEW_TOOLS,
  ...VISUAL_TOOLS,
];
