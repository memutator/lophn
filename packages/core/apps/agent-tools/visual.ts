import { ok } from "../../../base/mod.ts";
import { appTools } from "../../../protocol/apps/declaration/read.ts";
import { recordMessage } from "../../../protocol/lophn-agent/mod.ts";
import { cardViewDeclared } from "./app-card.ts";
import {
  commandOf,
  defineTool,
  fitted,
  notFound,
  readOf,
  type ToolDefinition,
} from "../../lophn-agent/tools/spi.ts";
import { z } from "zod";
import { idSchema } from "../../../protocol/base/ids.ts";

const nonblank = z.string().refine((value) => value.trim().length > 0, {
  message: "expected nonblank text",
});

// 대화에 보이는 시각물은 앱 카드뿐이다. 카드는 `app_card` message part로 session에 올린다.
export const VISUAL_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: "visual.show",
    defer: true,
    input: z.strictObject({ app: idSchema("app"), view: nonblank }),
    routes: [appTools, recordMessage],
    description:
      "Show an app card in the conversation. view is a screen key of the app's declaration that declares the card size.",
    effect: "read",
    handler: async (input, ctx) => {
      const { app, view } = input;
      const read = await readOf(ctx.core, appTools, { app });
      if (!read.ok) return read;
      if (!cardViewDeclared(read.value.screens, view)) {
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
      return ok(
        fitted(`showed the ${view} card of ${app}`, {
          message: posted.value.message,
        }),
      );
    },
  }),
];
