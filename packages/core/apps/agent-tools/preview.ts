import { ok } from "../../../base/mod.ts";
import { appCallTool, previewsGet } from "../../../protocol/apps/mod.ts";
import { idSchema } from "../../../protocol/base/ids.ts";
import {
  defineTool,
  fitted,
  readOf,
  type ToolDefinition,
} from "../../lophn-agent/tools/spi.ts";
import { z } from "zod";

// `preview.start`와 `preview.stop`은 명령(`packages/cli/commands/preview.ts`)으로 옮겼다. 이 tool만 남은 이유는
// caller가 session·turn·tool call id를 싣는데 명령 context에 아직 없기 때문이다.
export const PREVIEW_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: "preview.call",
    input: z.strictObject({
      app: idSchema("app"),
      // 화면이 부르는 operation도 확인할 수 있다. live에서는 agent가 operation을 부르지 못한다.
      kind: z.enum(["operation", "command"]),
      name: z.string().min(1),
      input: z.unknown().optional(),
    }),
    routes: [previewsGet, appCallTool],
    description:
      "Call an operation (what the app's screens call) or a command (what agents and other apps call) of your app's running preview and return its outcome. Nothing is recorded and live data is never touched. Omit input for one that takes none.",
    effect: "write",
    handler: async (input, ctx) => {
      const { app, kind, name } = input;
      const current = await readOf(ctx.core, previewsGet, { app });
      if (!current.ok) return current;
      const observation = current.value.observation;
      if (observation === null) {
        return ok(
          fitted(
            "no preview is running for this app; start one with `lophn preview start`",
            { running: false },
          ),
        );
      }
      const reply = await readOf(ctx.core, appCallTool, {
        target: {
          mode: "preview",
          app,
          process_nonce: observation.process_nonce,
        },
        kind,
        name,
        ...(input.input === undefined ? {} : { input: input.input }),
        caller: {
          kind: "agent",
          session: ctx.session,
          turn: ctx.turn,
          tool_call: ctx.tool_call,
        },
      });
      if (!reply.ok) return reply;
      const { outcome } = reply.value;
      const detail =
        outcome.status === "denied"
          ? ` (${outcome.denial.code})`
          : outcome.status === "failed"
            ? ` (${outcome.error.code})`
            : "";
      return ok(
        fitted(`preview call of ${name} ${outcome.status}${detail}`, {
          outcome,
        }),
      );
    },
  }),
];
