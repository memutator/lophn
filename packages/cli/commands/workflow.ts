// `lophn workflow list|get|report|edit|check|rename|delete|start|retry|resume|stop`: workflow를 읽고, report하고, 고치고, 이름 바꾸고, 지우고, 시작하고, 재시도하고, 이어 가고, 멈춘다.
// lophn agent와 사람(binary)이 같은 명령을 쓰고, 부른 쪽은 core가 credential로 안다. start·retry·resume·stop은 route가 user 전용이라
// workspace 종류를 비워 binary만 부른다: agent의 시작은 job의 workflow_start가 맡고, 재시도·이어 가기·멈춤은 사람이 정한다.
import { z } from "zod";
import { ok } from "../../base/mod.ts";
import { cleanUpModeSchema } from "../../protocol/base/follow-ups.ts";
import { idSchema } from "../../protocol/base/ids.ts";
import { WORKSPACE_KINDS } from "../../protocol/lophn-agent/workspaces.ts";
import {
  type HandResult,
  newStepSchema,
  participantKeySchema,
  participantSchema,
  sessionChoiceSchema,
  sessionOpenModeSchema,
  stepJoinModeSchema,
  stepNameSchema,
  stepNextSchema,
  workflowCheck,
  workflowDataSchema,
  workflowDelete,
  workflowEdit,
  workflowEditInputSchema,
  workflowInputValuesSchema,
  workflowInstanceRead,
  workflowKeySchema,
  workflowList,
  workflowNameSchema,
  workflowOverrideCode,
  workflowRefsSchema,
  workflowRename,
  workflowReport,
  workflowResume,
  workflowRetry,
  workflowRun,
  workflowRunOverrideSchema,
  workflowSave,
  workflowStart,
  workflowStop,
  workflowTextSchema,
  workflowTitleSchema,
} from "../../protocol/workflows/mod.ts";
import { defineCommand } from "./types.ts";

const instance = idSchema("wfi");

const TEXT_NOTE =
  "text: at most 8 KiB UTF-8; put longer content in a file and pass its path.";
const STATE_NOTE =
  "User-stopped instances reject edits; reports are recorded but hand nothing. Handing a step resumes an instance ended by end.";

function handedText(handed: HandResult | null): string {
  if (handed === null) return "none";
  if (handed.outcome === "not_handed") {
    return `not_handed ${handed.step}: ${handed.reason}`;
  }
  return `handed ${handed.step} -> ${handed.receiver ?? "another computer"}${
    handed.human_turn ? " (human turn)" : ""
  }`;
}

function handedSummary(
  verb: string,
  value: {
    line: string | null;
    handed: HandResult | null;
    handed_all?: HandResult[];
  },
): string {
  const { line, handed, handed_all } = value;
  // 다른 컴퓨터에서 받은 step의 report는 그 컴퓨터로 간다. 이 컴퓨터에는 줄이 없다.
  if (line === null) return `${verb} to the computer that started the workflow`;
  const list =
    handed_all !== undefined && handed_all.length > 0
      ? handed_all
      : handed !== null
        ? [handed]
        : [];
  if (list.length === 0) return `${verb} (line ${line})`;
  if (list.length === 1) {
    const one = list[0]!;
    return one.outcome === "handed"
      ? `${verb}; step ${one.step} handed`
      : `${verb}; step ${one.step} was not handed: ${one.reason}`;
  }
  const parts = list.map((one) =>
    one.outcome === "handed"
      ? `${one.step} handed`
      : `${one.step} not handed (${one.reason})`,
  );
  return `${verb}; ${parts.join(", ")}`;
}

const list = defineCommand({
  name: "workflow.list",
  summary: "List the workflows of a project",
  description:
    "List the workflows of a project: key, state, steps and, for a broken declaration, the `problem`. Give the project by name or id; in a project workspace you may omit it.",
  input: z.strictObject({ project: z.string().min(1).optional() }),
  effect: "read",
  routes: [workflowList],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    const read = await ctx.core.read(workflowList, input);
    if (!read.ok) return read;
    const { workflows, callable_agents } = read.value;
    return ok({
      summary: `${workflows.length} workflows`,
      content: {
        workflows,
        ...(callable_agents !== undefined ? { callable_agents } : {}),
      },
      arrayKeys: ["workflows"],
    });
  },
});

const get = defineCommand({
  name: "workflow.get",
  summary: "Read a workflow instance and its lines",
  description:
    "Read a workflow instance's state, steps, the latest report of each step and its lines, newest first. --lines keeps only the newest N lines. After lophn_restarted, a step message may be undelivered; use workflow edit hand_now to resend if needed. program_exited ends a flow instance and records its exit code and last stderr line.",
  input: z.strictObject({
    instance,
    lines: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("newest lines to keep (default: all)"),
  }),
  positional: ["instance"],
  effect: "read",
  routes: [workflowInstanceRead],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    // `next_cursor`가 null일 때까지 줄을 모은다. instance와 last_reports는 마지막 page의 것이다.
    let lines: unknown[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await ctx.core.read(workflowInstanceRead, {
        instance: input.instance,
        ...(cursor === undefined ? {} : { cursor }),
      });
      if (!page.ok) return page;
      lines.push(...page.value.lines);
      if (input.lines !== undefined) lines = lines.slice(-input.lines);
      if (page.value.next_cursor === null) {
        // 줄이 이미 step을 갖고 있어 map의 key는 버리고 배열로 둔다: 상한에 맞추는 일은 배열 key만 덜어 낸다.
        const last_reports = Object.values(page.value.last_reports).sort(
          (a, b) => (BigInt(a.seq) < BigInt(b.seq) ? 1 : -1),
        );
        return ok({
          summary: `workflow ${page.value.instance.workflow} ${page.value.instance.state}`,
          content: {
            instance: page.value.instance,
            last_reports,
            lines: lines.toReversed(),
          },
          arrayKeys: ["lines", "last_reports"],
        });
      }
      cursor = page.value.next_cursor;
    }
  },
});

const report = defineCommand({
  name: "workflow.report",
  summary: "Report a step's result and hand over to the next step",
  description: `Report a step result. --next hands a step, comma-separated steps in parallel, or ends the instance (end); omit it for a progress note. --next-steps hands multiple steps in parallel. --insert-steps dynamically inserts one or more follow-up workflow steps (running in parallel when 2+) right after this step, links them to --then-step (with optional --join all|any, default all), and hands them off immediately. --session new|same chooses whether the next step opens a new session. --refs lists output file paths (repeat the flag for multiple paths) and --data attaches optional structured JSON. The report stays even if handing fails; the summary explains why. For a step that came from another computer, the same command sends the report back to that computer (only the session that got the step; a report with --next ends the step there). ${TEXT_NOTE} ${STATE_NOTE}`,
  input: z.strictObject({
    instance,
    step: stepNameSchema,
    text: workflowTextSchema,
    next: z
      .string()
      .min(1)
      .optional()
      .describe(
        "next step name, comma-separated step names for parallel fan-out, or end",
      ),
    next_steps: z
      .array(stepNameSchema)
      .min(1)
      .optional()
      .describe("multiple next step names to run in parallel"),
    insert_steps: z
      .array(newStepSchema)
      .min(1)
      .optional()
      .describe(
        "dynamically insert one or more follow-up workflow steps right after this step and hand off to them",
      ),
    then_step: stepNextSchema
      .optional()
      .describe(
        "step to run after --insert-steps finish (default: current step's next)",
      ),
    join: stepJoinModeSchema
      .optional()
      .describe(
        "join rule on --then-step when inserting parallel steps (all | any, default all)",
      ),
    session: sessionChoiceSchema.optional(),
    refs: workflowRefsSchema
      .optional()
      .describe("output file paths produced by this step"),
    data: workflowDataSchema
      .optional()
      .describe("optional structured JSON output"),
  }),
  positional: ["instance", "step", "text"],
  effect: "write",
  routes: [workflowReport],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    let next: z.output<typeof stepNextSchema> | undefined;
    let nextSteps = input.next_steps;
    if (input.next !== undefined) {
      if (input.next.includes(",")) {
        const parts = input.next
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        const parsed = z.array(stepNameSchema).min(1).safeParse(parts);
        if (!parsed.success) {
          return {
            ok: false,
            error: {
              code: "invalid_input" as const,
              message: `invalid parallel next steps: ${input.next}`,
            },
          };
        }
        nextSteps = parsed.data;
      } else {
        const parsed = stepNextSchema.safeParse(input.next);
        if (!parsed.success) {
          return {
            ok: false,
            error: {
              code: "invalid_input" as const,
              message: parsed.error.issues[0]?.message ?? "invalid next step",
            },
          };
        }
        next = parsed.data;
      }
    }
    const { next: _rawNext, next_steps: _rawNextSteps, ...rest } = input;
    const reported = await ctx.core.read(workflowReport, {
      ...rest,
      ...(next !== undefined ? { next } : {}),
      ...(nextSteps !== undefined ? { next_steps: nextSteps } : {}),
    });
    if (!reported.ok) return reported;
    const { line, handed, handed_all } = reported.value;
    const allHanded =
      handed_all !== undefined && handed_all.length > 0
        ? handed_all
        : handed !== null
          ? [handed]
          : [];
    return ok({
      summary: handedSummary("reported", reported.value),
      content: {
        line,
        handed,
        ...(handed_all !== undefined ? { handed_all } : {}),
      },
      text:
        line === null
          ? "sent to the computer that started the workflow"
          : `line: ${line}\nhanded: ${
              allHanded.length === 0
                ? "none"
                : allHanded.map(handedText).join("; ")
            }`,
    });
  },
});

// EditWorkflow 입력은 op로 가르는 합이라 flag로 못 만든다. 칸이 평평한 입력을 받아 합의 variant로 옮긴다.
// 칸 모양은 합의 variant에서 가져와 복사본을 만들지 않는다. 칸이 op에 안 맞는 경우는 route의 검사가 돌려준다.
const [addStep, insertStepsOp, updateStep] = workflowEditInputSchema.options;
const edit = defineCommand({
  name: "workflow.edit",
  summary: "Edit a workflow instance",
  description: `Edit an instance. add_step: --new-step object, optional --after. insert_steps: --steps array (1 or parallel 2+), optional --after/--then-step/--join/--hand-now/--text/--session. update_step: --name and --patch. remove_step: --name. set_participant: --key and --participant. remove_participant: --key. end: no extra fields. hand_now: --step name (or --hand-steps array for parallel), optional --text/--session. ${TEXT_NOTE} ${STATE_NOTE}`,
  input: z.strictObject({
    instance,
    op: z.enum([
      "add_step",
      "insert_steps",
      "update_step",
      "remove_step",
      "set_participant",
      "remove_participant",
      "end",
      "hand_now",
    ]),
    new_step: addStep.shape.step.optional(),
    steps: insertStepsOp.shape.steps.optional(),
    after: addStep.shape.after,
    then_step: insertStepsOp.shape.then_step,
    join: insertStepsOp.shape.join,
    hand_now: insertStepsOp.shape.hand_now,
    name: stepNameSchema.optional(),
    patch: updateStep.shape.patch.optional(),
    key: participantKeySchema.optional(),
    participant: participantSchema.optional(),
    step: stepNameSchema.optional(),
    hand_steps: z.array(stepNameSchema).min(1).optional(),
    text: workflowTextSchema.optional(),
    session: sessionChoiceSchema.optional(),
  }),
  positional: ["instance"],
  effect: "write",
  routes: [workflowEdit],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    const { new_step, hand_steps, ...rest } = input;
    const payload =
      rest.op === "hand_now" && hand_steps !== undefined
        ? { ...rest, steps: hand_steps }
        : {
            ...rest,
            ...(new_step === undefined ? {} : { step: new_step }),
          };
    const done = await ctx.core.read(
      workflowEdit,
      payload as z.input<typeof workflowEdit.input>,
    );
    if (!done.ok) return done;
    return ok({
      summary: handedSummary("edited", done.value),
      content: done.value,
    });
  },
});

const check = defineCommand({
  name: "workflow.check",
  summary: "Type-check a flow workflow",
  description:
    "Type-check the flow named <project>/<workflow> against the installed @lophn/flow SDK. Returns type errors; does not execute or start the flow.",
  input: z.strictObject({ workflow: workflowKeySchema }),
  positional: ["workflow"],
  effect: "read",
  routes: [workflowCheck],
  workspaces: ["project"],
  run: async (input, ctx) => {
    const checked = await ctx.core.read(workflowCheck, input);
    if (!checked.ok) return checked;
    const { errors } = checked.value;
    return ok({
      summary:
        errors.length === 0
          ? `flow.ts of ${input.workflow} has no type errors`
          : `flow.ts of ${input.workflow} has ${errors.length} errors`,
      content: { errors },
    });
  },
});

const start = defineCommand({
  name: "workflow.start",
  summary: "Start a workflow instance",
  description:
    "Starts an instance of <project name>/<name> with the given text and prints its id. Without --step it begins at the declaration's start step. Use --inputs '<json>' to pass declarative workflow inputs as a JSON object.",
  input: z.strictObject({
    workflow: workflowKeySchema,
    title: workflowTitleSchema
      .optional()
      .describe("optional run title (default: auto-generated from text)"),
    text: z.string().min(1),
    step: stepNameSchema
      .optional()
      .describe("first step name (default: the declaration's start step)"),
    inputs: workflowInputValuesSchema
      .optional()
      .describe("declarative workflow inputs as a JSON object"),
    open: sessionOpenModeSchema
      .optional()
      .describe("override session open mode for this run (tab | background)"),
  }),
  positional: ["workflow", "text"],
  effect: "write",
  routes: [workflowStart],
  workspaces: [],
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

const retry = defineCommand({
  name: "workflow.retry",
  summary: "Retry a blocked workflow step",
  description:
    "Retries a blocked step of a running workflow instance. Continues in the recorded session when one exists, or re-attempts handing off when the step was not handed. Omit step to retry the current blocked step.",
  input: z.strictObject({
    instance,
    step: stepNameSchema
      .optional()
      .describe("step to retry (default: the current blocked step)"),
  }),
  positional: ["instance", "step"],
  effect: "write",
  routes: [workflowRetry],
  workspaces: [],
  run: async (input, ctx) => {
    const retried = await ctx.core.read(workflowRetry, input);
    if (!retried.ok) return retried;
    const { instance: inst, line } = retried.value;
    return ok({
      summary: `retried (line ${line})`,
      content: { instance: inst, line },
      text: `line: ${line}`,
    });
  },
});

const resume = defineCommand({
  name: "workflow.resume",
  summary: "Resume a blocked flow workflow instance",
  description:
    "Resumes a blocked running flow workflow instance by restarting its flow process and replaying saved checkpoints. Pass --latest-code to update the instance code snapshot from the current workflow folder before replaying.",
  input: z.strictObject({
    instance,
    latest_code: z
      .boolean()
      .optional()
      .describe(
        "update the code snapshot to the latest flow code before replaying",
      ),
  }),
  positional: ["instance"],
  effect: "write",
  routes: [workflowResume],
  workspaces: [],
  run: async (input, ctx) => {
    const useLatest = Boolean(input.latest_code);
    const resumed = await ctx.core.read(workflowResume, {
      instance: input.instance,
      use_latest_code: useLatest,
    });
    if (!resumed.ok) return resumed;
    const { instance: inst } = resumed.value;
    return ok({
      summary: useLatest
        ? "workflow resumed with updated code"
        : "workflow resumed",
      content: { instance: inst },
      text: inst.id,
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
  workspaces: [],
  run: async (input, ctx) => {
    const stopped = await ctx.core.read(workflowStop, input);
    return stopped.ok
      ? ok({
          summary: "workflow stopped",
          content: stopped.value.instance as unknown as Record<string, unknown>,
        })
      : stopped;
  },
});

const rename = defineCommand({
  name: "workflow.rename",
  summary: "Rename a workflow in a project",
  description:
    "Rename a workflow folder and update its ledger instances, flow_sdk reviews, workflow_start jobs, and desk layout. Omit --project when running in that project workspace.",
  input: z.strictObject({
    from: workflowNameSchema,
    to: workflowNameSchema,
    project: idSchema("prj")
      .optional()
      .describe("Project ID (defaults to current project workspace)"),
  }),
  positional: ["from", "to"],
  effect: "write",
  routes: [workflowRename],
  workspaces: ["home", "project"],
  run: async (input, ctx) => {
    const project =
      input.project ??
      (ctx.workspace?.kind === "project" ? ctx.workspace.id : undefined);
    const done = await ctx.core.read(workflowRename, {
      from: input.from,
      to: input.to,
      ...(project === undefined ? {} : { project }),
    });
    if (!done.ok) return done;
    return ok({
      summary: `renamed workflow ${done.value.from} -> ${done.value.to} (${done.value.updated_jobs} jobs updated)`,
      content: done.value,
    });
  },
});

const remove = defineCommand({
  name: "workflow.delete",
  summary: "Delete a workflow from a project",
  description:
    "Delete a workflow folder, stop running instances, erase its workflow_start jobs, and clean up its desk layout. Omit --project when running in that project workspace. Use --clean-up none|now|later to control semantic reference cleanup (defaults to later for agents when references exist).",
  input: z.strictObject({
    name: workflowNameSchema,
    project: idSchema("prj")
      .optional()
      .describe("Project ID (defaults to current project workspace)"),
    clean_up: cleanUpModeSchema
      .optional()
      .describe("Semantic cleanup mode: none, now, or later"),
  }),
  positional: ["name"],
  effect: "write",
  routes: [workflowDelete],
  workspaces: ["home", "project"],
  run: async (input, ctx) => {
    const project =
      input.project ??
      (ctx.workspace?.kind === "project" ? ctx.workspace.id : undefined);
    const done = await ctx.core.read(workflowDelete, {
      name: input.name,
      ...(project === undefined ? {} : { project }),
      ...(input.clean_up === undefined ? {} : { clean_up: input.clean_up }),
    });
    if (!done.ok) return done;
    const fupCount = done.value.follow_ups.length;
    return ok({
      summary: `deleted workflow ${done.value.name} (${done.value.erased_jobs} jobs erased${
        fupCount === 0
          ? ""
          : `, ${fupCount} follow-up${fupCount === 1 ? "" : "s"}`
      })`,
      content: done.value,
      arrayKeys: ["follow_ups"],
    });
  },
});

const run = defineCommand({
  name: "workflow.run",
  summary:
    "Start a one-off workflow or a per-instance override of an existing workflow",
  description:
    "Start a one-off workflow (omit --workflow; pass --participants and --steps for YAML shorthand, or --files containing flow.ts for a programmatic flow) or start an instance of an existing --workflow (<project>/<name>) with per-instance --override (participants, patch_steps, add_steps, remove_steps, steps, files, agent) without modifying the base workflow folder. When called by an agent, flow files are type-checked first and the person approves via an approval card before the instance starts.",
  input: z.strictObject({
    workflow: workflowKeySchema
      .optional()
      .describe("base <project>/<name> when overriding an existing workflow"),
    project: z
      .string()
      .min(1)
      .optional()
      .describe(
        "target project name or id for one-off workflows (omit in a project workspace)",
      ),
    name: workflowNameSchema
      .optional()
      .describe("slug label for a one-off workflow (default: one-off)"),
    title: workflowTitleSchema
      .optional()
      .describe("optional run title (default: auto-generated from text)"),
    text: z.string().min(1),
    step: stepNameSchema.optional(),
    inputs: workflowInputValuesSchema.optional(),
    open: sessionOpenModeSchema.optional(),
    step_open: z.record(stepNameSchema, sessionOpenModeSchema).optional(),
    participants: z.record(participantKeySchema, participantSchema).optional(),
    steps: workflowRun.input.shape.steps,
    files: workflowRun.input.shape.files,
    agent: z.string().min(1).optional(),
    override: workflowRunOverrideSchema.optional(),
  }),
  positional: ["text"],
  effect: "write",
  routes: [workflowRun],
  workspaces: ["home", "project"],
  run: async (input, ctx) => {
    const started = await ctx.core.read(workflowRun, {
      ...input,
      ...(ctx.caller === undefined ? {} : { tool_call: ctx.caller.tool_call }),
    });
    if (!started.ok) return started;
    const { instance: inst, handed } = started.value;
    const label = inst.one_off
      ? `one-off workflow ${inst.workflow} started`
      : inst.overridden
        ? `overridden workflow ${inst.workflow} started`
        : `workflow ${inst.workflow} started`;
    return ok({
      summary: label,
      content: { instance: inst, handed },
      text: inst.id,
      ...(handed?.outcome === "not_handed"
        ? { note: `not_handed: ${handed.reason}: ${handed.message}` }
        : {}),
    });
  },
});

const overrideCode = defineCommand({
  name: "workflow.override-code",
  summary:
    "Override flow code for a single workflow instance without touching the base workflow",
  description:
    "Patch files in a running or blocked flow workflow instance's own code snapshot (--files JSON map of relative path to content string, or null to delete) and resume it, leaving the base workflow folder on disk unchanged. Type-checked before asking the person for approval.",
  input: z.strictObject({
    instance,
    files: workflowOverrideCode.input.shape.files,
    agent: z.string().min(1).optional(),
    resume: z
      .boolean()
      .optional()
      .describe(
        "resume the flow process with the patched snapshot (default: true)",
      ),
  }),
  positional: ["instance"],
  effect: "write",
  routes: [workflowOverrideCode],
  workspaces: ["home", "project"],
  run: async (input, ctx) => {
    const done = await ctx.core.read(workflowOverrideCode, {
      ...input,
      ...(ctx.caller === undefined ? {} : { tool_call: ctx.caller.tool_call }),
    });
    if (!done.ok) return done;
    return ok({
      summary:
        input.resume === false
          ? `overrode flow code for ${done.value.instance.id}`
          : `overrode flow code and resumed ${done.value.instance.id}`,
      content: done.value,
      text: done.value.instance.id,
    });
  },
});

const save = defineCommand({
  name: "workflow.save",
  summary:
    "Save a one-off or overridden workflow instance as a permanent project workflow",
  description:
    "Promote a workflow instance (one-off YAML/flow or overridden instance) into a permanent workflow folder under the project's Workflows folder. Pass --overwrite to replace an existing workflow with the same name.",
  input: z.strictObject({
    instance,
    name: workflowNameSchema,
    overwrite: z.boolean().optional(),
  }),
  positional: ["instance", "name"],
  effect: "write",
  routes: [workflowSave],
  workspaces: ["home", "project"],
  run: async (input, ctx) => {
    const done = await ctx.core.read(workflowSave, input);
    if (!done.ok) return done;
    return ok({
      summary: `saved ${done.value.kind} workflow ${done.value.name} (${done.value.files_written} files)`,
      content: done.value,
      text: done.value.name,
    });
  },
});

export const WORKFLOW_COMMANDS = [
  list,
  get,
  report,
  edit,
  run,
  overrideCode,
  save,
  check,
  rename,
  remove,
  start,
  retry,
  resume,
  stop,
];
