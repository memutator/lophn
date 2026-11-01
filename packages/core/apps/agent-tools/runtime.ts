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
      const reason =
        body.state.reason === undefined
          ? ""
          : ` (${body.state.reason.code}: ${body.state.reason.summary})`;
      return ok(
        fitted(`app ${input.app} is ${body.state.state}${reason}`, body),
      );
    },
  }),
  defineTool({
    name: "app.logs",
    input: appLogsReadInputSchema,
    routes: [appLogs],
    description:
      "Read app output, reported problems, exceptions, screen errors and process exits; newest lines last. Filter by invocation, since (inclusive), until (exclusive) and limit.",
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
      "List an app's calls (operations and commands) with their caller, effect, status and times, newest first. Successful reads are not recorded; failed reads, writes and denied calls are. Filter by status, effect, release, mode, session or turn.",
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
