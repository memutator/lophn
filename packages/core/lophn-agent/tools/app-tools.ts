import { ok } from "../../../base/mod.ts";
import {
  appCallTool,
  type InputSchema,
  type ToolCallOutput,
} from "../../../protocol/apps/mod.ts";
import type { AppTool } from "../../../protocol/apps/blueprint/read.ts";
import type { AgentGrantEntry } from "../../../protocol/approvals/mod.ts";
import type { ToolResult } from "../../../protocol/lophn-agent/mod.ts";
import { readOf } from "../run-loop/core-call.ts";
import { toolInput } from "./app-tool/input.ts";
import { appToolName } from "./app-tool/name.ts";
import { limitJson } from "./result.ts";
import type { ToolDefinition } from "./registry.ts";
import type { ToolContext } from "./tool-context.ts";

// 앱 tool. 허락된 앱의 활성 release 선언에서 tool 하나마다 agent tool 하나를 만든다. 호출은 core의
// 호출 경로 route(`app.call_tool`) 하나로 간다. 부른 쪽 확인, Gate, invocation 기록,
// 결과 모름은 core가 다룬다. 이 tool은 core가 돌려준 상태를 ToolResult로 옮길 뿐이다.

export const APP_TOOL_CONTRACT = appCallTool.name;

// agent grant가 이 tool을 부르게 두는가. 앱을 할당하지 않았거나 tool을 뺐으면 아니다.
function grantAllows(
  entries: readonly AgentGrantEntry[],
  app: string,
  tool: string,
): boolean {
  for (const entry of entries) {
    if (entry.kind !== "app" || entry.app !== app) continue;
    return !entry.tools.some((one) =>
      one.tool === tool && one.setting === "excluded"
    );
  }
  return false;
}

// 활성 release에서 읽은 tool 선언이다.
export type AppToolView = {
  app: string;
  name: string;
  release: string;
  tools: readonly AppTool[];
};

export type AppToolSource = {
  views: readonly AppToolView[];
  // agent grant의 entries. 앱 단위 할당과 tool별 빼기가 들어 있다.
  entries: readonly AgentGrantEntry[];
};

export type AppToolEntry = {
  definition: ToolDefinition;
  app: string;
  tool: string;
};

// 앱 ∩ 선언 ∩ agent grant만 정의가 된다. 하나라도 빠지면 정의가 없다. 순서는 앱, tool 이름 순이다.
export async function buildAppTools(
  source: AppToolSource,
): Promise<readonly AppToolEntry[]> {
  const entries: AppToolEntry[] = [];
  const names = new Set<string>();
  const views = [...source.views].sort((a, b) => a.app < b.app ? -1 : 1);
  for (const view of views) {
    const declared = [...view.tools].sort((a, b) => a.name < b.name ? -1 : 1);
    for (const tool of declared) {
      if (!grantAllows(source.entries, view.app, tool.name)) continue;
      const name = await appToolName(tool.domain, tool.name);
      if (names.has(name)) continue;
      names.add(name);
      const shape = toolInput(tool.inputSchema as InputSchema | null);
      const definition: ToolDefinition = {
        name,
        description:
          `Domain ${tool.domain} of app ${view.name} (${view.app}), tool ${tool.name}: ${tool.title}. ${tool.description}`,
        input: shape.validator,
        inputSchema: shape.jsonSchema,
        effect: tool.effect,
        origin: "app",
        handler: async (input, ctx) => {
          const reply = await readOf(ctx.core, appCallTool, {
            target: { mode: "live", app: view.app, release: null },
            tool: tool.name,
            ...(tool.inputSchema === null ? {} : { input }),
            caller: callerOf(ctx),
          });
          if (!reply.ok) return reply;
          return ok(
            resultOf(view.name, tool.name, tool.effect, reply.value),
          );
        },
        // Gate는 core의 호출 경로가 건다.
        operations: [APP_TOOL_CONTRACT],
      };
      entries.push({ definition, app: view.app, tool: tool.name });
    }
  }
  return entries;
}

function callerOf(ctx: ToolContext) {
  return {
    kind: "agent",
    session: ctx.session,
    turn: ctx.turn,
    tool_call: ctx.tool_call,
  } as const;
}

function toolResult(
  status: ToolResult["status"],
  summary: string,
  content: unknown,
  extra: Partial<Pick<ToolResult, "complete" | "pending">> = {},
): ToolResult {
  return {
    status,
    summary,
    content: content as ToolResult["content"],
    complete: true,
    source: null,
    continuation: null,
    pending: [],
    ...extra,
  };
}

// core가 돌려준 상태(성공, 실패, 거절, 결과 모름)를 그대로 옮긴다. 앱 결과는 감싸지 않는다.
function resultOf(
  appName: string,
  tool: string,
  effect: AppTool["effect"],
  output: ToolCallOutput,
): ToolResult {
  const label = `tool ${tool} of ${appName}`;
  const { invocation, outcome } = output;
  switch (outcome.status) {
    case "succeeded": {
      const full = { invocation, result: outcome.result };
      const limited = limitJson(full);
      return limited.complete
        ? toolResult("success", `${label} finished`, full)
        : toolResult(
          "success",
          `${label} finished`,
          { invocation, result: null, omitted: true },
          {
            complete: false,
            pending: ["the result was too large to show"],
          },
        );
    }
    case "failed":
      return toolResult("failure", `${label} failed`, {
        invocation,
        error: outcome.error,
      });
    case "denied":
      return toolResult("not_executed", `${label} was not run`, {
        invocation,
        denied: outcome.denial,
      });
    case "unknown":
      return toolResult(
        "uncertain",
        `the result of ${label} is not known`,
        { invocation, reason: outcome.reason },
        {
          pending: [
            effect === "read"
              ? "the read can be repeated"
              : "check the app before repeating this call",
          ],
        },
      );
  }
}
