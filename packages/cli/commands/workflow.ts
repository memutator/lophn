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
  sessionChoiceSchema,
  sessionOpenModeSchema,
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
  workflowRefsSchema,
  workflowRename,
  workflowReport,
  workflowResume,
  workflowRetry,
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
  value: { line: string | null; handed: HandResult | null },
): string {
  const { line, handed } = value;
  // 다른 컴퓨터에서 받은 step의 report는 그 컴퓨터로 간다. 이 컴퓨터에는 줄이 없다.
  if (line === null) return `${verb} to the computer that started the workflow`;
  if (handed === null) return `${verb} (line ${line})`;
  return handed.outcome === "handed"
    ? `${verb}; step ${handed.step} handed`
    : `${verb}; step ${handed.step} was not handed: ${handed.reason}`;
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
  description: `Report a step result. --next hands a step or ends the instance (end); omit it for a progress note. --session new|same chooses whether the next step opens a new session. --refs lists output file paths (repeat the flag for multiple paths) and --data attaches optional structured JSON. The report stays even if handing fails; the summary explains why. For a step that came from another computer, the same command sends the report back to that computer (only the session that got the step; a report with --next ends the step there). ${TEXT_NOTE} ${STATE_NOTE}`,
  input: z.strictObject({
    instance,
    step: stepNameSchema,
    text: workflowTextSchema,
    next: stepNextSchema.optional().describe("next step name or end"),
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
    const reported = await ctx.core.read(workflowReport, input);
    if (!reported.ok) return reported;
    const { line, handed } = reported.value;
    return ok({
      summary: handedSummary("reported", reported.value),
      content: { line, handed },
      text:
        line === null
          ? "sent to the computer that started the workflow"
          : `line: ${line}\nhanded: ${handedText(handed)}`,
    });
  },
});

// EditWorkflow 입력은 op로 가르는 합이라 flag로 못 만든다. 칸이 평평한 입력을 받아 합의 variant로 옮긴다.
// 칸 모양은 합의 variant에서 가져와 복사본을 만들지 않는다. 칸이 op에 안 맞는 경우는 route의 검사가 돌려준다.
const [addStep, updateStep] = workflowEditInputSchema.options;
const edit = defineCommand({
  name: "workflow.edit",
  summary: "Edit a workflow instance",
  description: `Edit an instance. add_step: --new-step object, optional --after. update_step: --name and --patch. remove_step: --name. end: no extra fields. hand_now: --step name, optional --text/--session. ${TEXT_NOTE} ${STATE_NOTE}`,
  input: z.strictObject({
    instance,
    op: z.enum(["add_step", "update_step", "remove_step", "end", "hand_now"]),
    new_step: addStep.shape.step.optional(),
    after: addStep.shape.after,
    name: stepNameSchema.optional(),
    patch: updateStep.shape.patch.optional(),
    step: stepNameSchema.optional(),
    text: workflowTextSchema.optional(),
    session: sessionChoiceSchema.optional(),
  }),
  positional: ["instance"],
  effect: "write",
  routes: [workflowEdit],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    const { new_step, ...rest } = input;
    const done = await ctx.core.read(workflowEdit, {
      ...rest,
      ...(new_step === undefined ? {} : { step: new_step }),
    });
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

export const WORKFLOW_COMMANDS = [
  list,
  get,
  report,
  edit,
  check,
  rename,
  remove,
  start,
  retry,
  resume,
  stop,
];
