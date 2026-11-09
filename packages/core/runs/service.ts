import { z } from "zod";
import { err, type IdSource, ok, type Result } from "../../base/mod.ts";
import type { Id, JsonValue } from "../../protocol/base/mod.ts";
import {
  type AgentAtWorkspace,
  MESSAGE_CONTENT_MAX_BYTES,
  serializeMessageContent,
} from "../../protocol/lophn-agent/mod.ts";
import type {
  RunFailReason,
  RunRecord,
  runStart,
} from "../../protocol/runs/mod.ts";
import type {
  RunAgents,
  RunOrigin,
  RunStore,
  RunTools,
  Timers,
} from "./ports.ts";
import { readAnswer, runMessageText } from "./text.ts";

type StartInput = z.output<typeof runStart.input>;
// 이름을 이미 푼 agent로 부르는 갈래다. core 안 job만 쓰고 route 입력(runStart)에는 없다.
type AgentResolvedStart = {
  kind: "agent_resolved";
  agent: AgentAtWorkspace;
  prompt: string;
  input?: JsonValue;
  schema?: Record<string, JsonValue>;
};
type Settlement =
  | {
      state: "done";
      result?: unknown;
      turn?: Id<"trn">;
      invocation?: string | null;
    }
  | {
      state: "failed";
      reason: RunFailReason;
      message: string;
      turn?: Id<"trn">;
      invocation?: string | null;
    };

// ended: 입력을 가져간 turn이 끝났다. running: 아직 turn이 없거나 돌고 있거나 알 수 없다.
type TurnState = "ended" | "running" | "none";

// job이 연 run과 flow instance가 연 run을 가르는 칸이다.
// `<lophn-run from>`. origin이 없는 run은 `agent.run` 명령으로 연 것이다.
function runFrom(origin: RunOrigin | undefined): string {
  if (origin === undefined) return "command";
  return "job" in origin ? `job:${origin.job}` : `flow:${origin.instance}`;
}

function originColumns(origin: RunOrigin | undefined): {
  job: Id<"job"> | null;
  instance: Id<"wfi"> | null;
} {
  return {
    job: origin !== undefined && "job" in origin ? origin.job : null,
    instance:
      origin !== undefined && "instance" in origin ? origin.instance : null,
  };
}

export type RunService = ReturnType<typeof createRunService>;

export function createRunService(deps: {
  agents: RunAgents;
  tools: RunTools;
  store: RunStore;
  ids: IdSource;
  timers: Timers;
}) {
  const { agents, tools, store, ids, timers } = deps;
  // run id → 기다리는 WaitRun의 finish. Bus는 놓칠 수 있어 정본은 표다. 이것은 깨우는 데만 쓴다.
  const waiters = new Map<string, Set<() => void>>();

  function release(run: string): void {
    for (const finish of [...(waiters.get(run) ?? [])]) finish();
  }

  // 이미 끝난 run(conflict)은 지금 기록을 돌려준다.
  async function settle(
    run: string,
    s: Settlement,
  ): Promise<Result<RunRecord>> {
    const settled = await store.settle({
      run: run as Id<"run">,
      state: s.state,
      ...(s.turn === undefined ? {} : { turn: s.turn }),
      ...(s.invocation === undefined
        ? {}
        : { invocation: s.invocation as Id<"inv"> | null }),
      ...(s.state === "done" && s.result !== undefined
        ? { result: s.result as never }
        : {}),
      ...(s.state === "failed"
        ? { error: { reason: s.reason, message: s.message } }
        : {}),
    });
    if (settled.ok) {
      release(run);
      return settled;
    }
    return settled.error.code === "conflict"
      ? await store.read(run as Id<"run">)
      : settled;
  }

  const fail = (reason: RunFailReason, message: string, turn?: Id<"trn">) =>
    ({
      state: "failed",
      reason,
      message,
      ...(turn === undefined ? {} : { turn }),
    }) as const;

  // 끝은 늘 run.input_message를 가져간 turn에서만 본다. 이벤트가 알려 준 turn을 믿지 않는다.
  async function settleFromTurn(run: RunRecord): Promise<TurnState> {
    if (run.state !== "running" || run.input_message === null) return "running";
    if (run.session === null) return "running";
    const found = await agents.turnOf(run.input_message as Id<"msg">);
    if (!found.ok) return "running";
    if (found.value === null) return "none";
    const { turn, state, outcome } = found.value;
    if (state === "running" || outcome === null) return "running";
    if (outcome.kind === "failed") {
      await settle(run.id, fail("turn_failed", outcome.reason, turn));
    } else if (outcome.kind === "interrupted") {
      await settle(
        run.id,
        outcome.reason === "restarted"
          ? fail("lophn_restarted", "restarted", turn)
          : fail("turn_interrupted", outcome.reason, turn),
      );
    } else {
      const answer = await agents.answer(run.session as Id<"ses">, turn);
      if (!answer.ok) return "running";
      if (answer.value === null) {
        await settle(
          run.id,
          fail("no_answer", "the turn ended without an answer", turn),
        );
      } else if (run.schema === null) {
        await settle(run.id, { state: "done", result: answer.value, turn });
      } else {
        const read = readAnswer(
          answer.value,
          run.schema as Record<string, never>,
        );
        await settle(
          run.id,
          read.ok
            ? { state: "done", result: read.value, turn }
            : fail("invalid_output", read.message, turn),
        );
      }
    }
    return "ended";
  }

  async function startAgent(
    input: Extract<StartInput, { kind: "agent" }> | AgentResolvedStart,
    origin: RunOrigin | undefined,
  ): Promise<Result<RunRecord>> {
    if (input.kind === "agent") {
      if ((input.agent === undefined) === (input.session === undefined)) {
        return invalid("give exactly one of agent and session");
      }
    }
    if (input.schema !== undefined) {
      try {
        z.fromJSONSchema(input.schema);
      } catch {
        return invalid("schema is not a readable JSON Schema");
      }
    }
    const text = runMessageText({ ...input, from: runFrom(origin) });
    const size = serializeMessageContent({
      schema_version: 1,
      parts: [{ kind: "text", text }],
    }).byteLength;
    if (size > MESSAGE_CONTENT_MAX_BYTES) {
      return invalid("the prompt is too long");
    }

    // 이름을 다 푼 뒤에만 session을 열고 run을 만든다. 첫 시도가 아무것도 남기면 안 된다.
    const resolved =
      input.kind === "agent_resolved"
        ? ok(input.agent)
        : input.agent !== undefined
          ? await agents.resolve(input.agent)
          : await agents.agentOf(input.session! as Id<"ses">);
    if (!resolved.ok) return resolved;
    const agent = resolved.value;

    const run = ids.newId("run") as Id<"run">;
    const message = ids.newId("msg") as Id<"msg">;
    const existing = input.kind === "agent" ? input.session : undefined;
    const opened = existing === undefined;
    const session = (existing ?? ids.newId("ses")) as Id<"ses">;
    const created = await store.create({
      id: run,
      kind: "agent",
      target: { agent },
      session,
      session_opened: opened,
      input_message: message,
      schema: input.schema ?? null,
      ...originColumns(origin),
    });
    if (!created.ok) return created;

    const sent = opened ? await agents.open(agent, session) : ok(undefined);
    const delivered = sent.ok
      ? await agents.send(session, message, text)
      : sent;
    if (!delivered.ok) {
      return settle(run, fail("start_failed", delivered.error.code));
    }
    return created;
  }

  async function startTool(
    input: Extract<StartInput, { kind: "tool" }>,
    origin: RunOrigin | undefined,
  ): Promise<Result<RunRecord>> {
    const app = await tools.resolveApp(input.app);
    if (!app.ok) return app;
    const run = ids.newId("run") as Id<"run">;
    const created = await store.create({
      id: run,
      kind: "tool",
      target: { app: app.value, tool: input.tool },
      session: null,
      session_opened: false,
      input_message: null,
      schema: null,
      ...originColumns(origin),
    });
    if (!created.ok) return created;
    // 기다리지 않는다. 끝나면 settle한다.
    void callTool(run, app.value, input.tool, input.input, origin);
    return created;
  }

  async function callTool(
    run: Id<"run">,
    app: Id<"app">,
    tool: string,
    input: StartInputTool["input"],
    origin: RunOrigin | undefined,
  ): Promise<void> {
    let called: Awaited<ReturnType<RunTools["call"]>>;
    try {
      called = await tools.call(run, app, tool, input, origin);
    } catch (e) {
      called = err({ code: "internal", message: String(e) });
    }
    if (!called.ok) {
      await settle(
        run,
        fail("tool_denied", `${called.error.code}: ${called.error.message}`),
      );
      return;
    }
    const { invocation, outcome } = called.value;
    switch (outcome.status) {
      case "succeeded":
        await settle(run, {
          state: "done",
          result: outcome.result,
          invocation,
        });
        break;
      case "failed":
        await settle(run, {
          ...fail(
            "tool_failed",
            `${outcome.error.code}: ${outcome.error.message}`,
          ),
          invocation,
        });
        break;
      case "denied":
        await settle(run, fail("tool_denied", outcome.denial.code));
        break;
      case "unknown":
        await settle(run, fail("tool_unknown", outcome.reason));
        break;
    }
  }

  // 표를 다시 읽고, 끝나지 않은 agent run이면 turn을 한 번 본다.
  async function refresh(id: Id<"run">): Promise<Result<RunRecord>> {
    const read = await store.read(id);
    if (!read.ok || read.value.state !== "running") return read;
    if ((await settleFromTurn(read.value)) !== "ended") return read;
    return store.read(id);
  }

  async function runningRuns(): Promise<RunRecord[]> {
    const running = await store.running();
    return running.ok ? running.value : [];
  }

  async function cancel(id: Id<"run">): Promise<Result<RunRecord>> {
    const read = await store.read(id);
    if (!read.ok) return read;
    const run = read.value;
    if (run.state !== "running") {
      return err({ code: "conflict", message: "run is not running" });
    }
    const cancelled = await store.settle({ run: id, state: "cancelled" });
    if (!cancelled.ok) return cancelled;
    release(id);
    // tool run은 앱 호출을 멈추지 않는다. 뒤 단계의 오류는 기록에 남기지 않는다.
    if (run.input_message !== null && run.session !== null) {
      const message = run.input_message as Id<"msg">;
      const session = run.session as Id<"ses">;
      let found = await agents.turnOf(message);
      if (found.ok && found.value === null) {
        const queued = await agents.unqueue(session, message);
        // 그 사이 가져갔다.
        if (!queued.ok && queued.error.code === "conflict") {
          found = await agents.turnOf(message);
        } else return cancelled;
      }
      if (found.ok && found.value?.state === "running") {
        await agents.stop(found.value.turn);
      }
    }
    return cancelled;
  }

  return {
    start(
      input: StartInput | AgentResolvedStart,
      origin?: RunOrigin,
    ): Promise<Result<RunRecord>> {
      return input.kind === "tool"
        ? startTool(input, origin)
        : startAgent(input, origin);
    },

    async wait(id: Id<"run">, timeout_ms: number): Promise<Result<RunRecord>> {
      // 걸고 나서 읽는다. 읽는 사이에 끝나도 놓치지 않는다.
      let finish = () => {};
      const released = new Promise<void>((resolve) => {
        const handle = timers.set(() => finish(), timeout_ms);
        finish = () => {
          timers.clear(handle);
          waiters.get(id)?.delete(finish);
          resolve();
        };
      });
      const set = waiters.get(id) ?? new Set();
      set.add(finish);
      waiters.set(id, set);
      const now = await refresh(id);
      if (!now.ok || now.value.state !== "running") {
        finish();
        return now;
      }
      await released;
      return refresh(id);
    },

    cancel,

    // best-effort: 이미 끝난 run(conflict)은 버린다. process는 죽이지 않는다.
    async cancelOfInstance(instance: Id<"wfi">): Promise<void> {
      for (const run of await runningRuns()) {
        if (run.instance === instance) await cancel(run.id as Id<"run">);
      }
    },

    async turnEnded(event: {
      turn: string;
      messages: readonly string[];
    }): Promise<void> {
      for (const run of await runningRuns()) {
        if (
          run.input_message !== null &&
          event.messages.includes(run.input_message)
        )
          await settleFromTurn(run);
      }
    },

    // 입력이 줄에 있는 채로 session이 끝나면 turn이 열리지 않고 TurnEnded도 오지 않는다.
    async sessionEnded(session: string): Promise<void> {
      for (const run of await runningRuns()) {
        if (run.session !== session || run.input_message === null) continue;
        await settleFromTurn(run);
        await settle(run.id, fail("turn_interrupted", "session_ended"));
      }
    },

    // 켤 때 한 번. 돌고 있는 turn은 그 turn의 TurnEnded가 끝낸다.
    async reconcile(): Promise<void> {
      for (const run of await runningRuns()) {
        if (run.kind === "tool") {
          await settle(run.id, fail("lophn_restarted", "lophn restarted"));
        } else if ((await settleFromTurn(run)) === "none") {
          await settle(run.id, fail("lophn_restarted", "lophn restarted"));
        }
      }
    },

    // server.stop이 받은 요청을 기다리므로 걸린 WaitRun을 풀어 종료를 늦추지 않는다.
    close(): Promise<void> {
      for (const set of waiters.values()) {
        for (const finish of [...set]) finish();
      }
      return Promise.resolve();
    },
  };
}

type StartInputTool = Extract<StartInput, { kind: "tool" }>;

function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}
