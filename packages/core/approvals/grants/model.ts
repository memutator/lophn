import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type AgentGrantEntry,
  agentGrantEntryKey,
  agentKey,
  type Intent,
} from "../../../protocol/approvals/mod.ts";

function failure(
  code: "invalid_input" | "not_found" | "conflict",
  message: string,
): Result<never> {
  return err({ code, message });
}

// "항상"의 효과: 그 대상의 setting을 never로 바꾼다. 열려 있지 않은 대상을 새로 넓히지 않는다.
// 앱·MCP tool·agent는 entry가 있어야 하고 settings만 새로 만든다. 순수 함수다.
export function withNever(
  entries: readonly AgentGrantEntry[],
  target: Intent["target"],
): Result<AgentGrantEntry[]> {
  switch (target.kind) {
    case "app_tool": {
      const entry = entries.find((one) =>
        one.kind === "app" && one.app === target.app
      );
      if (entry === undefined || entry.kind !== "app") {
        return failure("not_found", "agent grant has no entry for this app");
      }
      const current = entry.tools.find((one) => one.tool === target.tool);
      if (current?.setting === "excluded") {
        return failure("conflict", "tool is excluded for this agent");
      }
      const tools = [
        ...entry.tools.filter((one) => one.tool !== target.tool),
        { tool: target.tool, setting: "never" as const },
      ];
      return ok(replace(entries, { ...entry, tools }));
    }
    case "mcp_tool":
    case "agent_call": {
      const key = target.kind === "mcp_tool"
        ? agentGrantEntryKey({
          kind: "mcp_tool",
          server: target.server,
          tool: target.tool,
        })
        : `agent:${agentKey(target.agent)}`;
      const entry = entries.find((one) => agentGrantEntryKey(one) === key);
      if (entry === undefined || entry.kind === "app") {
        return failure("not_found", "agent grant has no entry for this target");
      }
      return ok(replace(entries, { ...entry, setting: "never" }));
    }
    case "settings_edit": {
      const entry = entries.find((one) => one.kind === "settings");
      return ok(
        entry === undefined
          ? [...entries, { kind: "settings", setting: "never" }]
          : replace(entries, { ...entry, setting: "never" }),
      );
    }
    default:
      return failure("invalid_input", "target cannot be allowed always");
  }
}

function replace(
  entries: readonly AgentGrantEntry[],
  next: AgentGrantEntry,
): AgentGrantEntry[] {
  const key = agentGrantEntryKey(next);
  return entries.map((one) => agentGrantEntryKey(one) === key ? next : one);
}
