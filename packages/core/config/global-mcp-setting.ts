// 전역 MCP server 목록. project·agent 층과 같은 mcpServerSchema 배열이다.
// lophn-agent의 전역 층이 읽고, Settings › Agents 화면이 settings/list로 읽는다.
import { z } from "zod";
import { declareSetting } from "../../protocol/config/mod.ts";
import { mcpServerSchema } from "../../protocol/lophn-agent/mcp-settings.ts";

export const globalMcpServersSetting = declareSetting({
  key: "lophn-agent.extensions.mcp_servers",
  type: z.array(mcpServerSchema).max(32),
  default: [],
});
