import { err, ok, type Result } from "../../../base/mod.ts";
import { toMcpTool } from "../../../protocol/apps/blueprint/mod.ts";
import type {
  ToolCallOutput,
  ToolOutcome,
} from "../../../protocol/apps/calls/mod.ts";
import { type JsonValue, parseActor } from "../../../protocol/base/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import type { McpCallResult, McpTools } from "../../server/mod.ts";
import type { ToolDeclaration } from "../blueprint/mod.ts";
import type { AppApiCallPath } from "../ports.ts";
import type { CurrentPreview } from "../preview/mod.ts";

export type CodingMcpDeps = {
  // token이 이 endpoint와 그 앱에 닿는지 본다. 거절은 registry가 주는 not_found·forbidden 그대로다.
  authorize(ctx: AuthenticatedContext): Result<{ app: string }>;
  previews: { current(app: string): Promise<Result<CurrentPreview | null>> };
  // 활성 release의 tool 선언. 활성 release가 없으면 빈 목록이다.
  activeTools(app: string): Result<readonly ToolDeclaration[]>;
  calls: AppApiCallPath;
};

const NO_PREVIEW =
  "unavailable: no preview is running for this app. Start one with `lophn app preview start`.";

function failed(text: string): McpCallResult {
  return { content: [{ type: "text", text }], isError: true };
}

function textOf(outcome: ToolOutcome): McpCallResult {
  switch (outcome.status) {
    case "succeeded": {
      const { result } = outcome;
      const mcp: McpCallResult = {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
      if (
        result !== null && typeof result === "object" && !Array.isArray(result)
      ) mcp.structuredContent = result as Record<string, unknown>;
      return mcp;
    }
    case "failed":
      return failed(`${outcome.error.code}: ${outcome.error.message}`);
    case "denied":
      return failed(
        `denied (${outcome.denial.code}): ${outcome.denial.message}`,
      );
    case "unknown":
      return failed(`result unknown (${outcome.reason})`);
  }
}

// coding agent가 부르는 앱 tool. 부르는 길은 preview 하나뿐이고 live 앱은 어떤 경우에도 부르지 않는다.
export function createCodingMcpTools(deps: CodingMcpDeps): McpTools {
  // 목록은 preview가 있으면 그 bundle의, 없으면 활성 release의 선언이다.
  async function declared(
    ctx: AuthenticatedContext,
  ): Promise<
    Result<{
      app: string;
      tools: readonly ToolDeclaration[];
      preview: CurrentPreview | null;
    }>
  > {
    if (parseActor(ctx.actor)?.kind !== "coding_agent") {
      return err({ code: "forbidden", message: "coding agent only" });
    }
    const allowed = deps.authorize(ctx);
    if (!allowed.ok) return allowed;
    const { app } = allowed.value;
    const preview = await deps.previews.current(app);
    if (!preview.ok) return preview;
    if (preview.value !== null) {
      return ok({ app, tools: preview.value.tools, preview: preview.value });
    }
    const active = deps.activeTools(app);
    if (!active.ok) return active;
    return ok({ app, tools: active.value, preview: null });
  }

  return {
    async list(ctx) {
      const found = await declared(ctx);
      return found.ok ? ok(found.value.tools.map(toMcpTool)) : found;
    },
    async call(ctx, name, args) {
      const found = await declared(ctx);
      if (!found.ok) return found;
      const { app, tools, preview } = found.value;
      if (!tools.some((tool) => tool.name === name)) return ok(null);
      if (preview === null || !preview.ready) return ok(failed(NO_PREVIEW));
      // 인자 없는 tool(inputSchema가 null)은 input을 싣지 않는다. 앱이 `undefined`만 받는다.
      const declaration = tools.find((tool) => tool.name === name)!;
      const noInput = declaration.inputSchema === null;
      if (noInput && Object.keys(args ?? {}).length > 0) {
        return ok(failed(`invalid_input: tool ${name} takes no arguments`));
      }
      // 사람 화면의 preview 호출과 같은 취급이다. 운영으로 새지 않는 것은 previewOnly가 막는다.
      const called: Result<ToolCallOutput> = await deps.calls.call({
        target: {
          mode: "preview",
          app: app as never,
          process_nonce: preview.process_nonce,
        },
        tool: name,
        ...(noInput ? {} : { input: args as JsonValue }),
        caller: { kind: "person", view_session: ctx.principal },
      }, { actor: "user", previewOnly: true });
      return ok(
        called.ok
          ? textOf(called.value.outcome)
          : failed(`${called.error.code}: ${called.error.message}`),
      );
    },
  };
}
