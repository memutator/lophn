import { ok } from "../../base/mod.ts";
import {
  handResultSchema,
  reportLineSchema,
  sessionChoiceSchema,
  stepNameSchema,
  workflowCheck,
  workflowEdit,
  workflowEditInputSchema,
  workflowInstanceRead,
  workflowKeySchema,
  workflowList,
  workflowReport,
  workflowTextSchema,
} from "../../protocol/workflows/mod.ts";
import {
  countSummary,
  defineTool,
  fitted,
  readBody,
  readOf,
  type ToolDefinition,
} from "../lophn-agent/tools/spi.ts";
import { z } from "zod";
import { idSchema } from "../../protocol/base/mod.ts";

const LAST_LINES = 20;

// EditWorkflow 입력은 op로 가르는 합이라 JSON Schema가 top-level anyOf가 된다. provider가 object를
// 요구하므로 tool 입력만 평평한 객체로 두고, 칸이 op에 안 맞는 경우는 route의 검사가 invalid_input으로 돌려준다.
// 칸 모양은 합의 variant에서 가져와 복사본을 만들지 않는다.
const [addStep, updateStep] = workflowEditInputSchema.options;
const editInput = z.strictObject({
  instance: idSchema("wfi"),
  op: z.enum(["add_step", "update_step", "remove_step", "end", "hand_now"]),
  step: z.union([stepNameSchema, addStep.shape.step]).optional(),
  after: addStep.shape.after,
  name: stepNameSchema.optional(),
  patch: updateStep.shape.patch.optional(),
  text: workflowTextSchema.optional(),
  session: sessionChoiceSchema.optional(),
});

const TEXT_NOTE =
  "text: at most 8 KiB UTF-8; put longer content in a file and pass its path.";
const STATE_NOTE =
  "User-stopped instances reject edits; reports are recorded but hand nothing. Handing a step resumes an instance ended by end.";

function handedSummary(
  verb: string,
  value: { line: string; handed: z.output<typeof handResultSchema> | null },
): string {
  const { line, handed } = value;
  if (handed === null) return `${verb} (line ${line})`;
  return handed.outcome === "handed"
    ? `${verb}; step ${handed.step} handed`
    : `${verb}; step ${handed.step} was not handed: ${handed.reason}`;
}

export const WORKFLOW_AGENT_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: "workflow.list",
    input: z.strictObject({ project: z.string().min(1).optional() }),
    routes: [workflowList],
    description:
      "List the workflows of a project: key, state, steps and, for a broken declaration, the `problem`. Give the project by name or id; in a project place you may omit it.",
    effect: "read",
    handler: async (input, ctx) => {
      const read = await readOf(ctx.core, workflowList, input);
      if (!read.ok) return read;
      const { workflows } = read.value;
      return ok(
        fitted(
          countSummary("workflows", workflows.length, false),
          { workflows },
          ["workflows"],
        ),
      );
    },
  }),
  defineTool({
    name: "workflow.get",
    input: z.strictObject({ instance: idSchema("wfi") }),
    routes: [workflowInstanceRead],
    description: `Read a workflow instance's state, steps, latest reports and last ${LAST_LINES} lines, newest first. After lophn_restarted, a step message may be undelivered; use workflow.edit hand_now to resend if needed. program_exited ends a flow instance and records its exit code and last stderr line.`,
    effect: "read",
    handler: async (input, ctx) => {
      let cursor: string | undefined;
      let lines: unknown[] = [];
      for (;;) {
        const read = await readOf(ctx.core, workflowInstanceRead, {
          instance: input.instance,
          ...(cursor === undefined ? {} : { cursor }),
        });
        if (!read.ok) return read;
        const page = read.value;
        lines = [...lines, ...page.lines].slice(-LAST_LINES);
        if (page.next_cursor === null) {
          const { body } = readBody(page);
          // 줄이 이미 step을 갖고 있어 map의 key는 버리고 배열로 둔다: fitted는 배열 key만 덜어 낸다.
          const last_reports = Object.values(body.last_reports).sort((a, b) =>
            BigInt(a.seq) < BigInt(b.seq) ? 1 : -1,
          );
          return ok(
            fitted(
              `workflow ${body.instance.workflow} ${body.instance.state}`,
              {
                instance: body.instance,
                last_reports,
                lines: lines.toReversed(),
              },
              ["lines", "last_reports"],
            ),
          );
        }
        cursor = page.next_cursor;
      }
    },
  }),
  defineTool({
    name: "workflow.report",
    input: z.strictObject({
      instance: idSchema("wfi"),
      step: stepNameSchema,
      text: workflowTextSchema,
      next: reportLineSchema.shape.next.unwrap().optional(),
      session: sessionChoiceSchema.optional(),
    }),
    routes: [workflowReport],
    description: `Report a step result. next hands a step or ends the instance; omit it for a progress note. The report stays even if handing fails; the summary explains why. ${TEXT_NOTE} ${STATE_NOTE}`,
    effect: "write",
    handler: async (input, ctx) => {
      const done = await readOf(ctx.core, workflowReport, input);
      if (!done.ok) return done;
      return ok(fitted(handedSummary("reported", done.value), done.value));
    },
  }),
  defineTool({
    name: "workflow.edit",
    input: editInput,
    routes: [workflowEdit],
    description: `Edit an instance. add_step: step object, optional after. update_step: name and patch. remove_step: name. end: no extra fields. hand_now: step name, optional text/session. ${TEXT_NOTE} ${STATE_NOTE}`,
    effect: "write",
    handler: async (input, ctx) => {
      const body = Object.fromEntries(
        Object.entries(input).filter(([, v]) => v !== undefined),
      );
      const done = await readOf(ctx.core, workflowEdit, body);
      if (!done.ok) return done;
      return ok(fitted(handedSummary("edited", done.value), done.value));
    },
  }),
  defineTool({
    name: "workflow.check",
    input: z.strictObject({ workflow: workflowKeySchema }),
    routes: [workflowCheck],
    description:
      "Type-check the flow named <project>/<workflow> against the installed @lophn/flow SDK. Returns type errors; does not execute or start the flow.",
    effect: "read",
    handler: async (input, ctx) => {
      const checked = await readOf(ctx.core, workflowCheck, input);
      if (!checked.ok) return checked;
      const { errors } = checked.value;
      return ok(
        fitted(
          errors.length === 0
            ? `flow.ts of ${input.workflow} has no type errors`
            : `flow.ts of ${input.workflow} has ${errors.length} errors`,
          { errors },
        ),
      );
    },
  }),
];
