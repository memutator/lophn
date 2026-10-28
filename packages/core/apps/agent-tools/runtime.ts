import { ok } from "../../../base/mod.ts";
import {
  appInvocations,
  appInvocationsInputSchema,
  appLogs,
  appLogsReadInputSchema,
  appRuntime,
} from "../../../protocol/apps/mod.ts";
import { appIdSchema } from "../../../protocol/projects/values.ts";
import {
  countSummary,
  defineTool,
  fitted,
  readBody,
  readOf,
  type ToolDefinition,
} from "../../lophn-agent/tools/spi.ts";
import { z } from "zod";

// 앱을 진단하는 읽기 tool.
export const RUNTIME_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: "app.status",
    input: z.strictObject({ app: appIdSchema }),
    routes: [appRuntime],
    description:
      "Read whether an app is running: its state (and the reason when it is unavailable) and the latest supervisor observation.",
    effect: "read",
    handler: async (input, ctx) => {
      const read = await readOf(ctx.core, appRuntime, input);
      if (!read.ok) return read;
      const { body } = readBody(read.value);
      return ok(fitted(`app ${input.app} is ${body.state}`, body));
    },
  }),
  defineTool({
    name: "app.logs",
    input: appLogsReadInputSchema,
    routes: [appLogs],
    description:
      "Read an app's log, newest lines last: its own output, `error <name>[: <message>][ <details JSON>]` lines from reportProblem, uncaught exceptions as `exception <name>: <message>` followed by `  at <path>:<line>:<column>` source frames, screen errors as `view_error <observation> <name>: <message>` lines, and abnormal process ends as `process_exit <reason>: <message>`. Narrow it with invocation, since (inclusive), until (exclusive) and limit.",
    effect: "read",
    handler: async (input, ctx) => {
      const read = await readOf(ctx.core, appLogs, input);
      if (!read.ok) return read;
      const { body } = readBody(read.value);
      const count = `${body.lines.length} lines`;
      return ok(
        fitted(
          body.truncated
            ? `${count} (older lines exist; narrow with since, until or invocation)`
            : count,
          body,
          ["lines"],
        ),
      );
    },
  }),
  defineTool({
    name: "app.invocations",
    input: appInvocationsInputSchema.omit({ cursor: true }).extend({
      app: appIdSchema,
    }),
    routes: [appInvocations],
    description:
      "List an app's tool calls with their caller, effect, status and times, newest first. Successful reads are not recorded; failed reads, writes and denied calls are. Filter by status, effect, release, mode, session or turn.",
    effect: "read",
    handler: async (input, ctx) => {
      const read = await readOf(ctx.core, appInvocations, input);
      if (!read.ok) return read;
      const { body, more } = readBody(read.value);
      return ok(
        fitted(
          countSummary("invocations", body.invocations.length, more),
          body,
          ["invocations"],
        ),
      );
    },
  }),
];
