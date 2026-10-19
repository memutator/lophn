import { ok } from "../../../base/mod.ts";
import {
  type AppApiCallOutput,
  appCallApi,
  type InputSchema,
} from "../../../protocol/apps/mod.ts";
import type { Place } from "../../../protocol/lophn-agent/places.ts";
import type { AppTool } from "../../../protocol/apps/blueprint/read.ts";
import type { AgentGrantEntry } from "../../../protocol/approvals/mod.ts";
import type { ToolResult } from "../../../protocol/lophn-agent/mod.ts";
import { readOf } from "../run-loop/core-call.ts";
import { appApiInput } from "./app-api/input.ts";
import { appApiToolName } from "./app-api/name.ts";
import { limitJson } from "./result.ts";
import type { ToolDefinition } from "./registry.ts";
import type { ToolContext } from "./tool-context.ts";

// 앱 app-api tool. 허락된 앱의 활성 release 선언에서 app-api 하나마다 tool 하나를 만든다. 호출은 core의
// 호출 경로 route(`app.call_api`) 하나로 간다. 부른 쪽 확인, project 정하기, Gate, invocation 기록,
// 결과 모름은 core가 다룬다. 이 tool은 core가 돌려준 상태를 ToolResult로 옮길 뿐이다.

export const APP_TOOL_CONTRACT = appCallApi.name;

// agent grant가 이 app-api를 부르게 두는가. 앱을 할당하지 않았거나 api를 뺐으면 아니다.
function grantAllows(
  entries: readonly AgentGrantEntry[],
  app: string,
  api: string,
): boolean {
  for (const entry of entries) {
    if (entry.kind !== "app" || entry.app !== app) continue;
    return !entry.apis.some((one) =>
      one.api === api && one.setting === "excluded"
    );
  }
  return false;
}

// 활성 release에서 읽은 tool 선언이다.
export type AppApiView = {
  app: string;
  name: string;
  release: string;
  tools: readonly AppTool[];
};

export type AppApiSource = {
  // 지금은 쓰지 않는다. project 범위 입력이 없어져 place가 입력 모양을 바꾸지 않는다.
  place: Place | null;
  views: readonly AppApiView[];
  // agent grant의 entries. 앱 단위 할당과 app-api별 빼기가 들어 있다.
  entries: readonly AgentGrantEntry[];
};

export type AppApiTool = {
  definition: ToolDefinition;
  app: string;
  api: string;
};

// 앱 ∩ 선언 ∩ agent grant만 정의가 된다. 하나라도 빠지면 정의가 없다. 순서는 앱, api 키 순이다.
export async function buildAppApiTools(
  source: AppApiSource,
): Promise<readonly AppApiTool[]> {
  const tools: AppApiTool[] = [];
  const names = new Set<string>();
  const views = [...source.views].sort((a, b) => a.app < b.app ? -1 : 1);
  for (const view of views) {
    const apis = [...view.tools].sort((a, b) => a.name < b.name ? -1 : 1);
    for (const api of apis) {
      if (!grantAllows(source.entries, view.app, api.name)) continue;
      const name = await appApiToolName(view.app, api.name);
      if (names.has(name)) continue;
      names.add(name);
      const shape = appApiInput(api.inputSchema as InputSchema | null);
      const definition: ToolDefinition = {
        name,
        description:
          `App ${view.name} (${view.app}), app-api ${api.name}: ${api.title}. ${api.description}`,
        input: shape.validator,
        inputSchema: shape.jsonSchema,
        effect: api.effect,
        origin: "app",
        handler: async (input, ctx) => {
          const { input: appInput } = shape.split(input);
          const reply = await readOf(ctx.core, appCallApi, {
            target: { mode: "live", app: view.app, release: null },
            api: api.name,
            ...(appInput === undefined ? {} : { input: appInput }),
            caller: callerOf(ctx),
          });
          if (!reply.ok) return reply;
          return ok(
            resultOf(view.name, api.name, api.effect, reply.value),
          );
        },
        // Gate는 core의 호출 경로가 건다.
        operations: [APP_TOOL_CONTRACT],
      };
      tools.push({ definition, app: view.app, api: api.name });
    }
  }
  return tools;
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
  api: string,
  effect: AppTool["effect"],
  output: AppApiCallOutput,
): ToolResult {
  const label = `app-api ${api} of ${appName}`;
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
