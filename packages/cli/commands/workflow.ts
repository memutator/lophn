// `lophn workflow start|report|stop|show`: 사람과 program이 workflow instance를 시작하고, report하고, 멈추고, 읽는다.
// 입력은 route 입력이 아니라 CLI 칸이다. report의 크기와 `--next` 값은 검사하지 않는다. core가 거절하거나 줄로 남긴다.
// place 종류가 비어 있어 binary만 부른다.
import { z } from "zod";
import { ok } from "../../base/mod.ts";
import { idSchema } from "../../protocol/base/ids.ts";
import {
  type HandResult,
  workflowInstanceRead,
  workflowReport,
  workflowStart,
  workflowStop,
} from "../../protocol/workflows/mod.ts";
import { defineCommand } from "./types.ts";

function handedText(handed: HandResult | null): string {
  if (handed === null) return "none";
  if (handed.outcome === "not_handed") {
    return `not_handed ${handed.step}: ${handed.reason}`;
  }
  return `handed ${handed.step} -> ${handed.receiver}${
    handed.human_turn ? " (human turn)" : ""
  }`;
}

const instance = idSchema("wfi");

const start = defineCommand({
  name: "workflow.start",
  summary: "Start a workflow instance",
  description:
    "Starts an instance of <project name>/<name> with the given text and prints its id. Without --step it begins at the declaration's start step.",
  input: z.strictObject({
    workflow: z.string().min(1).describe("<project name>/<name>"),
    text: z.string().min(1),
    step: z
      .string()
      .min(1)
      .optional()
      .describe("first step name (default: the declaration's start step)"),
  }),
  positional: ["workflow", "text"],
  effect: "write",
  routes: [workflowStart],
  places: [],
  run: async (input, ctx) => {
    const started = await ctx.core.read(workflowStart, input);
    if (!started.ok) return started;
    const { instance, handed } = started.value;
    // 넘기지 못했어도 시작과 기록은 성공이다. 조용히 잃지 않게 이유를 알린다.
    return ok({
      summary: "workflow started",
      content: { instance, handed },
      text: instance.id,
      ...(handed?.outcome === "not_handed"
        ? { note: `not_handed: ${handed.reason}: ${handed.message}` }
        : {}),
    });
  },
});

const report = defineCommand({
  name: "workflow.report",
  summary: "Report a step's result and hand over to the next step",
  description:
    "Records the step's result in the instance and hands over to --next (a step name or end). --session new|same chooses whether the next step opens a new session.",
  input: z.strictObject({
    instance,
    step: z.string().min(1),
    text: z.string().min(1),
    next: z.string().min(1).optional().describe("next step name or end"),
    session: z.enum(["new", "same"]).optional(),
  }),
  positional: ["instance", "step", "text"],
  effect: "write",
  routes: [workflowReport],
  places: [],
  run: async (input, ctx) => {
    const reported = await ctx.core.read(workflowReport, input);
    if (!reported.ok) return reported;
    const { line, handed } = reported.value;
    return ok({
      summary: "reported",
      content: { line, handed },
      text: `line: ${line}\nhanded: ${handedText(handed)}`,
    });
  },
});

const stop = defineCommand({
  name: "workflow.stop",
  summary: "Stop a workflow instance",
  description: "Stops the instance and prints it.",
  input: z.strictObject({ instance }),
  positional: ["instance"],
  effect: "write",
  routes: [workflowStop],
  places: [],
  run: async (input, ctx) => {
    const stopped = await ctx.core.read(workflowStop, {
      instance: input.instance,
    });
    return stopped.ok
      ? ok({
          summary: "workflow stopped",
          content: stopped.value.instance as unknown as Record<string, unknown>,
        })
      : stopped;
  },
});

const show = defineCommand({
  name: "workflow.show",
  summary: "Read a workflow instance and its lines",
  description:
    "Prints the instance, the last report of each step and all lines.",
  input: z.strictObject({ instance }),
  positional: ["instance"],
  effect: "read",
  routes: [workflowInstanceRead],
  places: [],
  run: async (input, ctx) => {
    // `next_cursor`가 null일 때까지 줄을 모은다. instance와 last_reports는 마지막 page의 것이다.
    const lines: unknown[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await ctx.core.read(workflowInstanceRead, {
        instance: input.instance,
        ...(cursor === undefined ? {} : { cursor }),
      });
      if (!page.ok) return page;
      lines.push(...page.value.lines);
      if (page.value.next_cursor === null) {
        return ok({
          summary: `${lines.length} lines`,
          content: {
            instance: page.value.instance,
            last_reports: page.value.last_reports,
            lines,
          },
          arrayKeys: ["lines"],
        });
      }
      cursor = page.value.next_cursor;
    }
  },
});

export const WORKFLOW_COMMANDS = [start, report, stop, show];
