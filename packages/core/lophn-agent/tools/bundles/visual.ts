import { ok } from "../../../../base/mod.ts";
import { appAppApi } from "../../../../protocol/apps/blueprint/read.ts";
import { recordMessage } from "../../../../protocol/lophn-agent/mod.ts";
import { commandOf, readOf } from "../../run-loop/core-call.ts";
import type { ToolDefinition } from "../registry.ts";
import { cardViewDeclared } from "../domain/app-card.ts";
import type { ToolInput } from "../domain/input.ts";
import { fitted, notFound } from "../domain/result.ts";
import { defineTool } from "../define.ts";
import { TOOL_INPUTS } from "../../../../protocol/lophn-agent/tool-catalog.ts";

// 대화에 보이는 시각물은 앱 카드뿐이다. 카드는 `app_card` message part로 session에 올린다.
export const VISUAL_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: "visual.show",
    input: TOOL_INPUTS["visual.show"],
    routes: [appAppApi, recordMessage],
    description:
      "Show an app card in the conversation. view is a screen key of the app's blueprint that declares the card size.",
    effect: "read",
    handler: async (input, ctx) => {
      const { app, view } = input as ToolInput<"visual.show">;
      const blueprint = await readOf(ctx.core, appAppApi, { app });
      if (!blueprint.ok) return blueprint;
      if (!cardViewDeclared(blueprint.value.screens, view)) {
        return notFound("the app has no such card view");
      }
      const posted = await commandOf(
        ctx.core,
        recordMessage,
        {
          id: ctx.ids.newId("msg"),
          session: ctx.session,
          turn: ctx.turn,
          content: {
            schema_version: 1,
            parts: [{ kind: "app_card", app, view }],
          },
        },
        {},
        ctx.tool_call,
      );
      if (!posted.ok) return posted;
      return ok(fitted(`showed the ${view} card of ${app}`, {
        message: posted.value.message,
      }));
    },
  }),
];
