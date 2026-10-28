// `lophn agent run`, `tool call`, `run wait|show|cancel`: 사람이 쓰는 run 명령이다. 입력은 route 입력이 아니라
// CLI 칸이라 여기서 route 입력을 만든다. 기다리는 명령은 끝난 run의 값을 stdout에 내고, 실패·취소는 exit 4다.
import { err, type LophnError, ok, type Result } from "../../../base/mod.ts";
import {
  type AgentAddress,
  LOPHN_AGENT_NAME,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  RUN_WAIT_MAX_MS,
  runCancel,
  runRead,
  type RunRecord,
  runStart,
  runWait,
} from "../../../protocol/runs/mod.ts";
import type { Route } from "../../../protocol/base/mod.ts";
import { callRoute } from "../../connection/mod.ts";
import { CLI_EXITS } from "../output.ts";
import {
  type CommandEntry,
  entryOf,
  ExitWith,
  type RunContext,
} from "./types.ts";

type Out = Promise<Result<unknown, LophnError>>;

function invalid(message: string): LophnError {
  return { code: "invalid_input", message };
}

function call(
  ctx: RunContext,
  route: Route,
  input: Record<string, unknown>,
): Out {
  if (ctx.client === undefined) {
    return Promise.resolve(
      err({ code: "unavailable", message: "lophn에 연결하지 못했다" }),
    );
  }
  return callRoute(ctx.client, { route, input });
}

const runOf = (value: unknown) => (value as { run: RunRecord }).run;

// run이 running인 동안 되풀이해 기다린다. 끝은 core가 정한다.
async function finish(
  ctx: RunContext,
  first: RunRecord,
): Promise<Result<unknown, LophnError>> {
  let run = first;
  while (run.state === "running") {
    const waited = await call(ctx, runWait, {
      run: run.id,
      timeout_ms: RUN_WAIT_MAX_MS,
    });
    if (!waited.ok) return waited;
    run = runOf(waited.value);
  }
  if (run.state === "done") {
    if (ctx.json) return ok(run);
    return ok(
      typeof run.result === "string" ? run.result : JSON.stringify(run.result),
    );
  }
  if (ctx.json) return ok(new ExitWith(CLI_EXITS.failed, run));
  const note =
    run.state === "cancelled"
      ? "cancelled"
      : `failed: ${run.error?.reason}: ${run.error?.message}`;
  return ok(new ExitWith(CLI_EXITS.failed, undefined, note));
}

async function start(
  ctx: RunContext,
  input: Record<string, unknown>,
  async: boolean,
): Promise<Result<unknown, LophnError>> {
  const started = await call(ctx, runStart, input);
  if (!started.ok) return started;
  const run = runOf(started.value);
  if (async) return ok(ctx.json ? run : run.id);
  return await finish(ctx, run);
}

function optional(input: Record<string, unknown>, ...keys: string[]) {
  return Object.fromEntries(
    keys.flatMap((key) =>
      input[key] === undefined ? [] : [[key, input[key]]],
    ),
  );
}

function runAgent(input: Record<string, unknown>, ctx: RunContext): Out {
  // 이어 쓰는 session의 agent와 place는 열 때 정해져 바뀌지 않는다.
  if (
    input.session !== undefined &&
    (input.agent !== undefined ||
      input.project !== undefined ||
      input.app !== undefined)
  ) {
    return Promise.resolve(
      err(invalid("--session은 --agent·--project·--app과 같이 쓰지 않는다")),
    );
  }
  if (input.project !== undefined && input.app !== undefined) {
    return Promise.resolve(
      err(invalid("--project와 --app은 같이 쓰지 않는다")),
    );
  }
  let schema: unknown;
  if (input.schema !== undefined) {
    try {
      schema = JSON.parse(input.schema as string);
    } catch {
      schema = undefined;
    }
    if (
      typeof schema !== "object" ||
      schema === null ||
      Array.isArray(schema)
    ) {
      return Promise.resolve(err(invalid("--schema는 JSON Schema 객체다")));
    }
  }
  const base = {
    kind: "agent",
    prompt: input.prompt,
    ...optional(input, "input", "session"),
    ...(schema === undefined ? {} : { schema }),
  };
  if (input.session !== undefined) {
    return start(ctx, base, input.async === true);
  }
  // place가 없으면 home이다. 이름이나 id는 core가 푼다.
  const agent: AgentAddress = {
    agent: (input.agent as string | undefined) ?? LOPHN_AGENT_NAME,
    ...(input.project !== undefined
      ? { place: { project: input.project as string } }
      : input.app !== undefined
        ? { place: { app: input.app as string } }
        : {}),
  };
  return start(ctx, { ...base, agent }, input.async === true);
}

function callTool(input: Record<string, unknown>, ctx: RunContext): Out {
  return start(
    ctx,
    { kind: "tool", ...optional(input, "app", "tool", "input") },
    input.async === true,
  );
}

async function show(
  route: Route,
  input: Record<string, unknown>,
  ctx: RunContext,
) {
  const done = await call(ctx, route, { run: input.run });
  return done.ok ? ok(runOf(done.value)) : done;
}

export const RUN_COMMANDS: readonly CommandEntry[] = [
  entryOf("agent run", "lophn agent를 화면 없이 부르고 답을 기다린다", {
    positional: ["prompt"],
    run: runAgent,
  }),
  entryOf("tool call", "앱 tool을 부르고 결과를 기다린다", {
    positional: ["app", "tool"],
    run: callTool,
  }),
  entryOf("run wait", "run이 끝나기를 기다려 결과를 낸다", {
    positional: ["run"],
    run: async (input, ctx) => {
      const waited = await call(ctx, runWait, {
        run: input.run,
        timeout_ms: RUN_WAIT_MAX_MS,
      });
      return waited.ok ? await finish(ctx, runOf(waited.value)) : waited;
    },
  }),
  entryOf("run show", "run 기록을 읽는다", {
    positional: ["run"],
    run: (input, ctx) => show(runRead, input, ctx),
  }),
  entryOf("run cancel", "run을 취소한다", {
    positional: ["run"],
    run: (input, ctx) => show(runCancel, input, ctx),
  }),
];
