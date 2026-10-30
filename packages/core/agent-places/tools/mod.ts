import type { ToolDefinition } from "../../lophn-agent/tools/spi.ts";
import { SETTINGS_TOOLS } from "./settings.ts";
import { KIND_TOOLS } from "./kind.ts";
import { AGENT_TOOLS } from "./agent.ts";

// place 층(`agent-places`)의 규칙(종류마다 보이는 범위, 만들 수 있는 place)이 든 tool이다. 나머지 tool은 harness와 domain이 정의한다.
export const PLACE_AGENT_TOOLS: readonly ToolDefinition[] = [
  ...SETTINGS_TOOLS,
  ...AGENT_TOOLS,
  ...KIND_TOOLS,
];
