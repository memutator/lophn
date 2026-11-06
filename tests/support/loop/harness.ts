import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { manualClock, ok } from "../../../packages/base/mod.ts";
import {
  type FinishRequest,
  type LoopDeps,
  startTurnLoop,
  type ToolDone,
  type TurnContext,
  type TurnInput,
  type TurnLoopHandle,
  type TurnPorts,
} from "../../../packages/core/lophn-agent/run-loop/mod.ts";
import {
  DEFAULT_TURN_LIMITS,
  type TurnElapsed,
} from "../../../packages/protocol/lophn-agent/mod.ts";
import { scriptedModel, type Step } from "./model.ts";

// startTurnLoop를 core 없이 돌리는 port 묶음이다. model만 scripted이고 나머지는 입력을 고정하거나
// 받은 것을 기록한다. 멈춤은 `handle.stop()`으로 건다.

export const START_MS = Date.UTC(2026, 0, 1);

export type HarnessTool = {
  name: string;
  effect: "read" | "write" | "external";
  run(
    args: unknown,
  ):
    | { status: ToolDone["status"]; code: string; summary: string }
    | Promise<{ status: ToolDone["status"]; code: string; summary: string }>;
};

// 쓰기 tool이 실행됐는지 disk로 보려고 root 아래에 진짜 file을 쓴다.
export function writeFileTool(root: string): HarnessTool {
  return {
    name: "write_file",
    effect: "write",
    async run(args) {
      const { path } = args as { path: string };
      await writeFile(join(root, path), "written");
      return { status: "success", code: "ok", summary: "written" };
    },
  };
}

function toolResult(
  status: ToolDone["status"],
  summary: string,
): ToolDone["result"] {
  return {
    status,
    summary,
    content: null,
    complete: true,
    source: null,
    continuation: null,
    pending: [],
  };
}

export function loopHarness(init: {
  steps: readonly Step[];
  tools?: readonly HarnessTool[];
  limits?: Partial<TurnInput["limits"]>;
  // turn 안 Compact다. 끝난 결과를 내고, compacted면 그 뒤의 context()가 after를 이전 대화로 읽는다.
  compact?: {
    outcome: "compacted" | "skipped" | "failed";
    after: TurnContext["session"];
  };
}) {
  const harnessTools = init.tools ?? [];
  const model = scriptedModel(init.steps);
  const clock = manualClock(START_MS);
  const waits: number[] = [];
  const answers: string[] = [];
  const finishes: FinishRequest[] = [];
  const checkpoints: TurnElapsed[] = [];
  const runs: { name: string; args: unknown }[] = [];
  // turn 안 Compact가 불린 때 turn이 넘긴 진행(이력)의 message 수.
  const compactions: number[] = [];
  let compacted = false;
  const firing = new Set<() => void>();
  let toolCalls = 0;

  async function done(
    status: ToolDone["status"],
    code: string,
    summary: string,
  ): Promise<ToolDone> {
    toolCalls += 1;
    await Promise.resolve();
    return {
      tool_call: `tcl_${toolCalls}`,
      status,
      code,
      result: toolResult(status, summary),
    };
  }

  const ports: TurnPorts = {
    stop: () => Promise.resolve({ stopped: false }),
    inputs: () =>
      Promise.resolve(
        ok({ request: [{ kind: "text", text: "go" }], steering: [] }),
      ),
    context: () => {
      const context: TurnContext = {
        prompt: {
          workspace_kind_prompt: "You are a test agent.",
          tools: harnessTools.map((tool) => ({
            name: tool.name,
            description: tool.name,
            input_schema: { type: "object" },
          })),
          instructions: { global: "", project: "", agent: "" },
          skills: [],
          workspace: { text: "", agents: [] },
          limits: {
            context_limit: 200_000,
            input_limit: 200_000,
            output_limit: 8192,
          },
          reserved_output: 1024,
        },
        session:
          compacted && init.compact !== undefined
            ? init.compact.after
            : { compaction: null, messages: [] },
        notices: [],
        keep() {},
      };
      return Promise.resolve(ok(context));
    },
    model: model.port,
    tools: {
      info(name) {
        const tool = harnessTools.find((t) => t.name === name);
        return tool === undefined
          ? undefined
          : { effect: tool.effect, server: null };
      },
      async attempt(call) {
        const tool = harnessTools.find((t) => t.name === call.name);
        if (tool === undefined) throw new Error(`no tool ${call.name}`);
        runs.push({ name: call.name, args: call.input });
        const result = await tool.run(call.input);
        return await done(result.status, result.code, result.summary);
      },
      close: (_call, why) => done(why.status, why.code, why.summary),
    },
    checkpoint(elapsed) {
      checkpoints.push(elapsed);
      return Promise.resolve();
    },
    answer(text) {
      answers.push(text);
      return Promise.resolve(ok(undefined));
    },
    finish(request) {
      finishes.push(request);
      return Promise.resolve(ok({ finished: true as const }));
    },
    ...(init.compact === undefined
      ? {}
      : {
          compact(history: readonly unknown[]) {
            compactions.push(history.length);
            compacted = init.compact!.outcome === "compacted";
            return Promise.resolve(init.compact!.outcome);
          },
        }),
  };

  const deps: LoopDeps = {
    clock,
    wait(ms, signal) {
      waits.push(ms);
      return Promise.resolve(signal.aborted ? "aborted" : "elapsed");
    },
    // test가 fireDeadline()으로 풀 때만 한도 시간이 지난 것이다.
    deadline: (_ms, signal) =>
      new Promise((resolve) => {
        if (signal.aborted) return resolve("aborted");
        const fire = () => resolve("elapsed");
        firing.add(fire);
        signal.addEventListener(
          "abort",
          () => {
            firing.delete(fire);
            resolve("aborted");
          },
          { once: true },
        );
      }),
    // tool retry 대기가 정확히 1000ms가 된다.
    random: () => 0.5,
    ports,
    abortGraceMs: 10,
  };

  const input: TurnInput = {
    turn: "trn_test",
    session: "ses_test",
    limits: { ...DEFAULT_TURN_LIMITS, ...init.limits },
    elapsed: { active_ms: 0, stall_ms: 0, checkpoint_at: null },
    attempts: 0,
  };

  return {
    run(): TurnLoopHandle {
      return startTurnLoop(deps, input);
    },
    model,
    clock,
    waits,
    answers,
    finishes,
    checkpoints,
    runs,
    compactions,
    fireDeadline() {
      for (const fire of [...firing]) fire();
      firing.clear();
    },
  };
}
