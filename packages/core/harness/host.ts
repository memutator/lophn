// harness host: harness queue의 입력을 harness의 headless CLI로 실행하고 출력을 session 기록으로 옮긴다.
// core에는 `ctx.core`로만 닿는다. 흐름과 route 순서는 `protocol/lophn-agent/harness-host.ts`.
import type { Result } from "../../base/result.ts";
import { redactCredentials } from "../../base/telemetry/log.ts";
import {
  HARNESS_ADAPTER_OF_RUNTIME,
  HARNESS_ADAPTERS,
} from "../../protocol/coding-agent/harness-adapter.ts";
import { harnessHomeName } from "../../protocol/coding-agent/harness-home.ts";
import { AGENT_CREDENTIAL_ENV } from "../../protocol/coding-agent/headless/env.ts";
import type { CliSpawn } from "../../protocol/acp/mod.ts";
import type {
  harnessFinishTurn,
  harnessRecord,
  harnessTake,
} from "../../protocol/lophn-agent/harness-host.ts";
import type { z } from "zod";

export type HarnessHostDeps = {
  core: {
    call(
      kind: string,
      resource: string,
      method: string,
      input: unknown,
    ): Promise<Result<unknown>>;
  };
  spawn: CliSpawn;
  dataFolder(name: string): Promise<Result<string>>;
};

type Taken = NonNullable<z.output<(typeof harnessTake)["output"]>["input"]>;
type Outcome = z.output<(typeof harnessFinishTurn)["input"]>["outcome"];
type Failed = Extract<Outcome, { kind: "failed" }>["reason"];
type Part = z.output<(typeof harnessRecord)["input"]>["parts"][number];

// harness가 `lophn`을 부를 env다. 자격은 이 turn에만 쓰이고(core가 turn 끝에 만료한다) user token은 넣지 않는다.
function harnessEnv(
  credential: string,
  session: string,
): Record<string, string> {
  // LOPHN_SESSION_ID는 CLI가 띄우는 process에도 상속된다. 앱이 process 목록에서 이 session의 process를 찾는 표지다(secret이 아니다).
  return {
    [AGENT_CREDENTIAL_ENV]: credential,
    LOPHN_SESSION_ID: session,
  };
}

const TICK_MS = 1000;
const STDERR_TAIL = 500;

type Running = { kill: () => void; stopped: boolean; shutdown: boolean };

export function createHarnessHost(
  ctx: HarnessHostDeps,
  options: { tickMs?: number } = {},
) {
  const running = new Map<string, Running>();
  const turns = new Set<Promise<void>>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let ticking = false;
  let stopping = false;

  const call = (
    kind: string,
    resource: string,
    method: string,
    input: unknown,
  ) => ctx.core.call(kind, resource, method, input);
  const harness = (method: string, input: unknown) =>
    call("memory", "harness", method, input);
  const read = async <T>(resource: string, method: string, input: unknown) =>
    (await call("read", resource, method, input)) as Result<T>;

  const record = (session: string, turn: string, part: Part) =>
    harness("record", { session, turn, parts: [part] });
  // 시작하지 못한 이유는 대화에 남겨 사람이 알게 한다.
  async function fail(
    input: Taken,
    turn: string,
    reason: Failed,
    text: string,
  ) {
    await record(input.session, turn, { kind: "text", text });
    await finish(turn, { kind: "failed", reason });
  }
  // 이미 core가 닫은 turn(멈춤, 재시작)이면 conflict가 오고 그대로 둔다.
  const finish = async (turn: string, outcome: Outcome) =>
    void (await harness("finish_turn", { turn, outcome }));

  // session의 workspace 폴더가 cwd다. home은 data root 안 session마다 빈 폴더를 만들어 준다. 폴더가 없는 project·app은
  // 띄우지 않는다: cwd가 곧 harness가 쓰는 범위라 임의의 폴더를 고르면 폴더 밖에 쓰게 된다.
  async function workspaceFolder(
    workspace: Taken["workspace"],
    session: string,
  ): Promise<string | null> {
    if (workspace === null) {
      const made = await ctx.dataFolder(harnessHomeName(session));
      return made.ok ? made.value : null;
    }
    if (workspace.kind === "project") {
      const found = await read<{ project: { folders: { path: string }[] } }>(
        "projects",
        "get",
        { project: workspace.id },
      );
      return found.ok ? (found.value.project.folders[0]?.path ?? null) : null;
    }
    const found = await read<{
      app: { source_path: string | null; folders: { path: string }[] };
    }>("apps", "get", { app: workspace.id });
    return found.ok
      ? (found.value.app.source_path ??
          found.value.app.folders[0]?.path ??
          null)
      : null;
  }

  // `git rev-parse --show-prefix`는 cwd가 git root면 빈 줄이고, 그 아래면 root에서의 상대 경로다. 저장소 밖(오류)은 빈 줄로 친다.
  async function belowGitRoot(cwd: string): Promise<boolean> {
    const proc = ctx.spawn("git", ["rev-parse", "--show-prefix"], { cwd });
    let out = "";
    proc.onStdout((text) => {
      out += text;
    });
    proc.end();
    const code = await new Promise<number | null>((resolve) =>
      proc.onExit(resolve),
    );
    return code === 0 && out.trim() !== "";
  }

  async function execute(
    input: Taken,
    turn: string,
    credential: string,
    entry: Running,
  ) {
    const spec =
      HARNESS_ADAPTERS[HARNESS_ADAPTER_OF_RUNTIME[input.harness]].headless;
    if (spec === undefined) {
      return await fail(
        input,
        turn,
        "target_unavailable",
        `${input.harness} cannot run headless.`,
      );
    }
    if (input.prompt.trim() === "") {
      return await fail(
        input,
        turn,
        "configuration_unavailable",
        "The message has no text to send to the harness.",
      );
    }
    const definition = await read<{
      definition: { permissions?: { deny?: string[] } } | null;
    }>("agents", "read", { agent: input.agent });
    if (!definition.ok) {
      return await fail(
        input,
        turn,
        "target_unavailable",
        "The agent definition could not be read.",
      );
    }
    const deny = spec.permissions(
      definition.value.definition?.permissions?.deny ?? [],
    );
    if (deny === null) {
      return await fail(
        input,
        turn,
        "configuration_unavailable",
        `${input.harness} cannot keep this agent's deny rules, so it was not started.`,
      );
    }
    const cwd = await workspaceFolder(input.workspace, input.session);
    if (cwd === null) {
      return await fail(
        input,
        turn,
        "configuration_unavailable",
        "A harness agent needs a workspace that has a folder (home works too).",
      );
    }
    if (spec.needsOwnGitRoot && (await belowGitRoot(cwd))) {
      return await fail(
        input,
        turn,
        "configuration_unavailable",
        `${input.harness} writes to the top of the git repository, and ${cwd} is inside one but is not its top, so it was not started.`,
      );
    }

    const proc = ctx.spawn(
      spec.command,
      spec.args({
        prompt: input.prompt,
        sessionId: input.external_session_id,
        forkFrom: input.fork_external_session_id,
        deny,
      }),
      { cwd, env: harnessEnv(credential, input.session) },
    );
    entry.kill = () => proc.kill();
    if (entry.shutdown) proc.kill();
    // codex는 stdin이 끝나기를 기다린다. prompt는 인자로 넘기므로 보낼 것이 없다.
    proc.end();

    const parse = spec.parser();
    let chain: Promise<unknown> = Promise.resolve();
    let buffer = "";
    let stderr = "";
    let bound = input.external_session_id;
    let texts = 0;
    let end: { ok: boolean; error?: string } | undefined;
    const handle = async (events: ReturnType<typeof parse>) => {
      for (const event of events) {
        if (event.kind === "session") {
          if (event.id === bound) continue;
          bound = event.id;
          await harness("set_external_id", {
            session: input.session,
            external_session_id: event.id,
          });
        } else if (event.kind === "end") {
          end = event;
        } else {
          if (event.kind === "text") texts += 1;
          const part: Part =
            event.kind === "text"
              ? event
              : {
                  kind: "harness_tool",
                  name: event.name,
                  summary: event.summary,
                  status: event.status,
                };
          const done = await record(input.session, turn, part);
          if (!done.ok && done.error.code === "conflict") stop();
        }
      }
    };
    const stop = () => {
      entry.stopped = true;
      proc.kill();
    };
    const feed = (lines: string[]) => {
      const events = lines.flatMap((line) => parse(line));
      chain = chain.then(() => handle(events));
    };
    proc.onStdout((text) => {
      buffer += text;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      feed(lines);
    });
    proc.onStderr((text) => {
      stderr = (stderr + text).slice(-STDERR_TAIL);
    });

    // 사람이 멈추면 core가 turn을 닫는다. process를 죽이고 더 기록하지 않는다.
    const watch = setInterval(() => {
      void read<{ turn: { state: string } }>("turns", "read", { turn }).then(
        (found) => {
          if (found.ok && found.value.turn.state === "finished") stop();
        },
      );
    }, options.tickMs ?? TICK_MS);
    const code = await new Promise<number | null>((resolve) =>
      proc.onExit(resolve),
    );
    clearInterval(watch);
    if (buffer !== "") feed([buffer]);
    await chain;

    if (entry.shutdown) {
      return await finish(turn, {
        kind: "failed",
        reason: "target_unavailable",
      });
    }
    if (entry.stopped) return;
    const ok = end === undefined ? code === 0 : end.ok;
    if (!ok) {
      const why = end?.error ?? (stderr.trim() || `exit code ${code}`);
      return await fail(
        input,
        turn,
        code === null ? "target_unavailable" : "model_error",
        redactCredentials(`${spec.command} failed: ${why}`),
      );
    }
    if (texts === 0) {
      return await finish(turn, { kind: "failed", reason: "no_answer" });
    }
    await finish(turn, { kind: "completed", reason: "answer_completed" });
  }

  async function runTurn(input: Taken, turn: string, credential: string) {
    const entry: Running = { kill() {}, stopped: false, shutdown: stopping };
    running.set(turn, entry);
    try {
      await execute(input, turn, credential, entry);
    } catch {
      await finish(turn, { kind: "failed", reason: "target_unavailable" });
    } finally {
      running.delete(turn);
    }
  }

  async function tick() {
    if (ticking || stopping) return;
    ticking = true;
    try {
      for (;;) {
        const taken = await harness("take", {});
        if (!taken.ok) return;
        const input = (taken.value as { input: Taken | null }).input;
        if (input === null) return;
        const started = await harness("start_turn", {
          session: input.session,
          input_message: input.input_message,
        });
        if (!started.ok) return;
        const { turn, credential } = started.value as {
          turn: string;
          credential: string;
        };
        const run = runTurn(input, turn, credential);
        turns.add(run);
        void run.finally(() => turns.delete(run));
      }
    } finally {
      ticking = false;
    }
  }

  return {
    start() {
      timer = setInterval(() => void tick(), options.tickMs ?? TICK_MS);
    },
    // process를 끄고, 끝나지 못한 turn은 실패로 닫는다(설정이 이미 꺼졌으면 core가 거절해 재시작 때 닫힌다).
    async stop() {
      stopping = true;
      clearInterval(timer);
      for (const entry of running.values()) {
        entry.shutdown = true;
        entry.kill();
      }
      await Promise.all(turns);
    },
  };
}
