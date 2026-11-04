// harness host: 입력함의 입력을 harness의 headless CLI로 실행하고 출력을 session 기록으로 옮긴다.
// core에는 `ctx.core`로만 닿는다. 흐름과 route 순서는 `protocol/lophn-agent/harness-host.ts`.
import type { Result } from "../../../../../base/result.ts";
import { HARNESS_ADAPTERS } from "../../../../../protocol/coding-agent/harness-adapter.ts";
import type { ExtensionContext } from "../../../../../protocol/extensions/manifest.ts";

// host route의 입출력은 `protocol/lophn-agent/harness-host.ts`가 정한다. shell main의 tsc가 그 파일(과 route 기계)을
// 따라 들어오면 이 project의 엄격한 옵션으로 못 읽는 파일이 섞여서, 쓰는 칸만 여기에 적는다.
type Taken = {
  session: string;
  agent: string;
  place: { kind: "project" | "app"; id: string } | null;
  harness: "claude-code" | "codex" | "opencode";
  external_session_id: string | null;
  input_message: string;
  prompt: string;
};
type Failed =
  | "configuration_unavailable"
  | "target_unavailable"
  | "model_error"
  | "no_answer";
type Outcome =
  | { kind: "completed"; reason: "answer_completed" }
  | { kind: "failed"; reason: Failed };
// runtime 값 → `HARNESS_ADAPTERS`의 id. `harness-host.ts`의 HARNESS_ADAPTER_ID와 같은 표다.
const ADAPTER_ID = {
  "claude-code": "claude",
  codex: "codex",
  opencode: "opencode",
} as const;
type Part =
  | { kind: "text"; text: string }
  | {
      kind: "harness_tool";
      name: string;
      summary: string;
      status: "done" | "failed";
    };

const TICK_MS = 1000;
const STDERR_TAIL = 500;

type Running = { kill: () => void; stopped: boolean; shutdown: boolean };

export function createHarnessHost(
  ctx: ExtensionContext,
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

  // session의 place 폴더가 cwd다. 폴더가 없는 place(home, 폴더 없는 project·app)에서는 띄우지 않는다:
  // cwd가 곧 harness가 쓰는 범위라 임의의 폴더를 고르면 폴더 밖에 쓰게 된다.
  async function placeFolder(place: Taken["place"]): Promise<string | null> {
    if (place === null) return null;
    if (place.kind === "project") {
      const found = await read<{ project: { folders: { path: string }[] } }>(
        "projects",
        "get",
        { project: place.id },
      );
      return found.ok ? (found.value.project.folders[0]?.path ?? null) : null;
    }
    const found = await read<{
      app: { source_path: string | null; folders: { path: string }[] };
    }>("apps", "get", { app: place.id });
    return found.ok
      ? (found.value.app.source_path ??
          found.value.app.folders[0]?.path ??
          null)
      : null;
  }

  async function execute(input: Taken, turn: string, entry: Running) {
    const spec = HARNESS_ADAPTERS[ADAPTER_ID[input.harness]].headless;
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
    const cwd = await placeFolder(input.place);
    if (cwd === null) {
      return await fail(
        input,
        turn,
        "configuration_unavailable",
        "A harness agent needs a project or app place that has a folder.",
      );
    }

    const proc = ctx.spawn(
      spec.command,
      spec.args({
        prompt: input.prompt,
        sessionId: input.external_session_id,
        deny,
      }),
      { cwd },
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
        `${spec.command} failed: ${why}`,
      );
    }
    if (texts === 0) {
      return await finish(turn, { kind: "failed", reason: "no_answer" });
    }
    await finish(turn, { kind: "completed", reason: "answer_completed" });
  }

  async function runTurn(input: Taken, turn: string) {
    const entry: Running = { kill() {}, stopped: false, shutdown: stopping };
    running.set(turn, entry);
    try {
      await execute(input, turn, entry);
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
        const run = runTurn(input, (started.value as { turn: string }).turn);
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
