// `lophn agent run`, `run wait|show|cancel`: 사람이 쓰는 run 명령이다. 앱 command(`lophn <slug> <command>`)도 `start`로
// run을 시작한다(`app-command.ts`). 입력은 route 입력이 아니라 CLI 칸이라 여기서 route 입력을 만든다. 기다리는 명령은 끝난 run의 값을 내고, 실패·취소는 `failed`로 알린다.
// workspace 종류가 비어 있어 binary만 부른다.
import { z } from "zod";
import { err, type LophnError, ok, type Result } from "../../base/mod.ts";
import { idSchema } from "../../protocol/base/ids.ts";
import { jsonValueSchema } from "../../protocol/base/json-values.ts";
import {
  type AgentAddress,
  LOPHN_AGENT_NAME,
} from "../../protocol/lophn-agent/mod.ts";
import {
  RUN_WAIT_MAX_MS,
  runCancel,
  runRead,
  type RunRecord,
  runStart,
  runWait,
} from "../../protocol/runs/mod.ts";
import {
  type CommandContext,
  type CommandResult,
  defineCommand,
} from "./types.ts";

type Out = Promise<Result<CommandResult, LophnError>>;

function invalid(message: string): LophnError {
  return { code: "invalid_input", message };
}

const asContent = (run: RunRecord) => run as unknown as Record<string, unknown>;

// run이 running인 동안 되풀이해 기다린다. 끝은 core가 정한다.
async function finish(ctx: CommandContext, first: RunRecord): Out {
  let run = first;
  while (run.state === "running") {
    if (ctx.signal.aborted) {
      return err({
        code: "unavailable",
        message: "stopped waiting for the run",
      });
    }
    const waited = await ctx.core.read(runWait, {
      run: run.id,
      timeout_ms: RUN_WAIT_MAX_MS,
    });
    if (!waited.ok) return waited;
    run = waited.value.run;
  }
  if (run.state === "done") {
    return ok({
      summary: "run done",
      content: asContent(run),
      text:
        typeof run.result === "string"
          ? run.result
          : JSON.stringify(run.result),
    });
  }
  return ok({
    summary: `run ${run.state}`,
    content: asContent(run),
    failed:
      run.state === "cancelled"
        ? "cancelled"
        : `failed: ${run.error?.reason}: ${run.error?.message}`,
  });
}

export async function start(
  ctx: CommandContext,
  input: Record<string, unknown>,
  wait: boolean,
): Out {
  const started = await ctx.core.read(runStart, input);
  if (!started.ok) return started;
  const run = started.value.run;
  if (!wait) {
    return ok({
      summary: "run started",
      content: asContent(run),
      text: run.id,
    });
  }
  return await finish(ctx, run);
}

const agentRunInput = z.strictObject({
  prompt: z.string().min(1),
  agent: z.string().min(1).optional().describe("agent name (default lophn)"),
  project: z
    .string()
    .min(1)
    .optional()
    .describe(
      "name or id of the project to use as the workspace; not with --app",
    ),
  app: z
    .string()
    .min(1)
    .optional()
    .describe(
      "name or id of the app to use as the workspace; not with --project",
    ),
  session: idSchema("ses").optional(),
  schema: z.string().min(1).optional().describe("output JSON Schema text"),
  async: z.boolean().optional().describe("return the run id without waiting"),
  data: jsonValueSchema
    .optional()
    .describe("JSON value passed to the agent as the run input"),
});

const agentRun = defineCommand({
  name: "agent.run",
  summary: "Call a lophn agent without a screen and wait for its answer",
  description:
    "Starts a run of the agent and prints its answer. --session continues a session (its agent and workspace cannot change). Without --project/--app the workspace is home.",
  input: agentRunInput,
  positional: ["prompt"],
  effect: "external",
  routes: [runStart, runWait],
  workspaces: [],
  run: (input, ctx) => {
    // 이어 쓰는 session의 agent와 workspace는 열 때 정해져 바뀌지 않는다.
    if (
      input.session !== undefined &&
      (input.agent !== undefined ||
        input.project !== undefined ||
        input.app !== undefined)
    ) {
      return Promise.resolve(
        err(
          invalid("--session cannot be used with --agent, --project or --app"),
        ),
      );
    }
    if (input.project !== undefined && input.app !== undefined) {
      return Promise.resolve(
        err(invalid("--project and --app cannot be used together")),
      );
    }
    let schema: unknown;
    if (input.schema !== undefined) {
      try {
        schema = JSON.parse(input.schema);
      } catch {
        schema = undefined;
      }
      if (
        typeof schema !== "object" ||
        schema === null ||
        Array.isArray(schema)
      ) {
        return Promise.resolve(
          err(invalid("--schema must be a JSON Schema object")),
        );
      }
    }
    const base = {
      kind: "agent",
      prompt: input.prompt,
      ...(input.data === undefined ? {} : { input: input.data }),
      ...(input.session === undefined ? {} : { session: input.session }),
      ...(schema === undefined ? {} : { schema }),
    };
    const wait = input.async !== true;
    if (input.session !== undefined) return start(ctx, base, wait);
    // workspace가 없으면 home이다. 이름이나 id는 core가 푼다.
    const agent: AgentAddress = {
      agent: input.agent ?? LOPHN_AGENT_NAME,
      ...(input.project !== undefined
        ? { workspace: { project: input.project } }
        : input.app !== undefined
          ? { workspace: { app: input.app } }
          : {}),
    };
    return start(ctx, { ...base, agent }, wait);
  },
});

const runRef = z.strictObject({ run: idSchema("run") });

const runWaitCommand = defineCommand({
  name: "run.wait",
  summary: "Wait for a run to finish and print its result",
  description: "Waits for the run and prints its answer or result.",
  input: runRef,
  positional: ["run"],
  effect: "read",
  routes: [runWait],
  workspaces: [],
  run: async (input, ctx) => {
    const waited = await ctx.core.read(runWait, {
      run: input.run,
      timeout_ms: RUN_WAIT_MAX_MS,
    });
    return waited.ok ? await finish(ctx, waited.value.run) : waited;
  },
});

const runShow = defineCommand({
  name: "run.show",
  summary: "Read a run record",
  description: "Prints the run record: state, result or error.",
  input: runRef,
  positional: ["run"],
  effect: "read",
  routes: [runRead],
  workspaces: [],
  run: async (input, ctx) => {
    const read = await ctx.core.read(runRead, { run: input.run });
    return read.ok
      ? ok({ summary: "run record", content: asContent(read.value.run) })
      : read;
  },
});

const runCancelCommand = defineCommand({
  name: "run.cancel",
  summary: "Cancel a run",
  description: "Cancels a running run and prints its record.",
  input: runRef,
  positional: ["run"],
  effect: "write",
  routes: [runCancel],
  workspaces: [],
  run: async (input, ctx) => {
    const done = await ctx.core.read(runCancel, { run: input.run });
    return done.ok
      ? ok({ summary: "run cancelled", content: asContent(done.value.run) })
      : done;
  },
});

export const RUN_COMMANDS = [
  agentRun,
  runWaitCommand,
  runShow,
  runCancelCommand,
];
