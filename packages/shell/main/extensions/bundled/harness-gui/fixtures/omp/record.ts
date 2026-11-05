// 녹화 script. 사람 PATH의 `omp --mode rpc-ui`를 진짜 model로 띄워 scenario를 차례로 몰고, 보낸 줄(send)과 받은 줄(recv)을
// `<out>/<scenario>.jsonl`에 `{t, kind, data}`로 쓴다. test는 이것을 돌리지 않는다. 사람 허락 아래 lead가 돌린다.
//
// 저장소 root에서:
//   node --experimental-strip-types --no-warnings packages/shell/main/extensions/bundled/harness-gui/fixtures/omp/record.ts --out <dir> --model <패턴> [scenario ...]
// scenario를 안 주면 아래를 다 돈다. --out과 --model은 필수다(model을 빼면 omp의 기본 model로 돌아 비쌀 수 있다).
// session은 `<out>/sessions/`에 따로 쌓아 사람의 ~/.omp를 건드리지 않는다(auth와 설정은 사람의 것을 그대로 쓴다).
// scenario cwd는 os.tmpdir() 아래 mkdtemp 폴더이고 끝나면 지운다(lophn checkout 안이면 omp가 위 폴더의 AGENTS.md를 읽는다).
// 상위 lophn 터미널 env(`LPN_*`, `LOPHN_*`)는 빼고 띄운다. 사람의 role·approval 설정 file은 쓰지 않는다.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type Frame = {
  type?: string;
  id?: string;
  command?: string;
  success?: boolean;
  data?: unknown;
  method?: string;
  title?: string;
  status?: string;
  agentInvoked?: boolean;
  questions?: { id: string; options: { label: string }[] }[];
  chunkId?: string;
  index?: number;
  count?: number;
  payload?: { id?: string; status?: string; detached?: boolean };
};

const ROOT = process.cwd();
const SECOND = 1000;

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
};
const outArg = flag("--out");
const model = flag("--model");
const wanted = argv.filter(
  (one, index) =>
    !one.startsWith("--") &&
    !["--out", "--model"].includes(argv[index - 1] ?? ""),
);
if (outArg === undefined || model === undefined) {
  console.error(
    "usage: record.ts --out <dir> --model <cheap model pattern> [scenario ...]",
  );
  process.exit(1);
}
const OUT = resolve(outArg);
const SESSIONS = join(OUT, "sessions");

const baseEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined &&
      !entry[0].startsWith("LPN_") &&
      !entry[0].startsWith("LOPHN_"),
  ),
);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const data = <T>(frame: Frame) => frame.data as T;

class Log {
  private start = Date.now();
  readonly path: string;
  constructor(path: string) {
    this.path = path;
    writeFileSync(path, "");
  }
  write(kind: string, payload: unknown) {
    appendFileSync(
      this.path,
      `${JSON.stringify({ t: Date.now() - this.start, kind, data: payload })}\n`,
    );
  }
}

/** 띄운 omp 하나. 받은 줄은 rpc_chunk를 합쳐 `frames`에 쌓고, 합치기 전 줄을 그대로 기록한다. */
class Rec {
  frames: Frame[] = [];
  exited = false;
  private buffer = "";
  private chunks = new Map<string, Buffer[]>();
  private counter = 0;

  private log: Log;
  readonly proc: ChildProcess;

  constructor(log: Log, proc: ChildProcess) {
    this.log = log;
    this.proc = proc;
    proc.stdout?.setEncoding("utf8");
    proc.stdout?.on("data", (text: string) => {
      this.buffer += text;
      for (
        let at = this.buffer.indexOf("\n");
        at >= 0;
        at = this.buffer.indexOf("\n")
      ) {
        const line = this.buffer.slice(0, at);
        this.buffer = this.buffer.slice(at + 1);
        if (line.trim() !== "") this.onLine(line);
      }
    });
    proc.stderr?.setEncoding("utf8");
    proc.stderr?.on("data", (text: string) => log.write("stderr", text));
    proc.on("exit", (code) => {
      this.exited = true;
      log.write("lead_note", `omp exited with code ${code}`);
    });
  }

  private onLine(line: string) {
    let frame: Frame;
    try {
      frame = JSON.parse(line) as Frame;
    } catch {
      this.log.write("recv_raw", line);
      return;
    }
    this.log.write("recv", frame);
    if (frame.type === "rpc_chunk") {
      const parts = this.chunks.get(frame.chunkId ?? "") ?? [];
      parts[frame.index ?? 0] = Buffer.from(
        String((frame as { data?: unknown }).data ?? ""),
        "base64",
      );
      this.chunks.set(frame.chunkId ?? "", parts);
      if (parts.filter(Boolean).length === frame.count) {
        this.chunks.delete(frame.chunkId ?? "");
        this.frames.push(JSON.parse(Buffer.concat(parts).toString("utf8")));
      }
      return;
    }
    this.frames.push(frame);
  }

  note(text: string) {
    this.log.write("lead_note", text);
  }

  send(body: Record<string, unknown>) {
    this.log.write("send", body);
    this.proc.stdin?.write(`${JSON.stringify(body)}\n`);
  }

  mark() {
    return this.frames.length;
  }

  async until(
    pred: (frame: Frame) => boolean,
    what: string,
    from = 0,
    ms = 120 * SECOND,
  ): Promise<Frame> {
    const end = Date.now() + ms;
    for (;;) {
      const found = this.frames.slice(from).find(pred);
      if (found) return found;
      if (this.exited) throw new Error(`omp exited while waiting for ${what}`);
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await sleep(25);
    }
  }

  /** 명령 하나를 보내고 그 답 frame을 받는다. 실패 답도 돌려준다. */
  async call(
    type: string,
    params: Record<string, unknown> = {},
    ms = 60 * SECOND,
  ): Promise<Frame> {
    const id = `rec-${++this.counter}`;
    const from = this.mark();
    this.send({ id, type, ...params });
    return this.until(
      (frame) => frame.type === "response" && frame.id === id,
      `the ${type} response`,
      from,
      ms,
    );
  }

  /** prompt를 보내고 `prompt_result`와 `session_settled`까지 기다린다. 로컬 명령은 답의 `agentInvoked: false`로 끝난다. */
  async prompt(
    message: string,
    params: Record<string, unknown> = {},
    ms = 180 * SECOND,
  ): Promise<Frame> {
    const id = `rec-${++this.counter}`;
    const from = this.mark();
    this.send({ id, type: "prompt", message, ...params });
    const reply = await this.until(
      (frame) => frame.type === "response" && frame.id === id,
      "the prompt response",
      from,
      ms,
    );
    if (
      reply.success !== true ||
      data<{ agentInvoked?: boolean }>(reply)?.agentInvoked === false
    ) {
      await sleep(500);
      return reply;
    }
    const result = await this.until(
      (frame) => frame.type === "prompt_result" && frame.id === id,
      "prompt_result",
      from,
      ms,
    );
    await this.until(
      (frame) => frame.type === "session_settled",
      "session_settled",
      from,
      ms,
    ).catch(() => this.note("no session_settled after the prompt"));
    return result;
  }

  async stop() {
    this.proc.stdin?.end();
    for (let waited = 0; !this.exited && waited < 10 * SECOND; waited += 100) {
      await sleep(100);
    }
    if (!this.exited) this.proc.kill("SIGTERM");
    for (let waited = 0; !this.exited && waited < 5 * SECOND; waited += 100) {
      await sleep(100);
    }
  }
}

type Ctx = { name: string; cwd: string; log: Log };

function workdir(name: string): string {
  const cwd = mkdtempSync(join(tmpdir(), `omp-rec-${name}-`));
  writeFileSync(join(cwd, "hello.txt"), "hello\nworld\n");
  return cwd;
}

// 실패한 scenario가 omp를 남기지 않게 띄운 것을 기억한다.
const active: Rec[] = [];

/** 띄우고 v2, ask dialog, 전체 snapshot filter까지 맞춘다(adapter의 시작 순서와 같다). */
async function launch(
  ctx: Ctx,
  extra: string[] = [],
  env: Record<string, string> = {},
): Promise<Rec> {
  const args = [
    "--mode",
    "rpc-ui",
    `--cwd=${ctx.cwd}`,
    `--session-dir=${SESSIONS}`,
    `--model=${model}`,
    ...extra,
  ];
  ctx.log.write("lead_note", `spawn: omp ${args.join(" ")}`);
  const rec = new Rec(
    ctx.log,
    spawn("omp", args, {
      cwd: ctx.cwd,
      env: { ...baseEnv, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    }),
  );
  active.push(rec);
  await rec.until((frame) => frame.type === "ready", "ready", 0, 60 * SECOND);
  await rec.call("negotiate_protocol", { protocolVersion: 2 });
  await rec.call("set_ask_dialog", { enabled: true });
  await rec.call("set_event_filter", { events: null });
  return rec;
}

const isApproval = (frame: Frame) =>
  frame.type === "extension_ui_request" &&
  frame.method === "select" &&
  (frame.title ?? "").startsWith("Allow tool:");

const sessionFiles = (dir = SESSIONS): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sessionFiles(join(dir, entry.name))
      : entry.name.endsWith(".jsonl")
        ? [join(dir, entry.name)]
        : [],
  );

type Entry = { id: string; type: string; message?: { role?: string } };
const entriesOf = async (rec: Rec) =>
  data<{ entries: Entry[] }>(await rec.call("get_entries")).entries;
const userEntries = (entries: Entry[]) =>
  entries.filter(
    (one) => one.type === "message" && one.message?.role === "user",
  );
const sessionIdOf = async (rec: Rec) =>
  data<{ sessionId: string }>(await rec.call("get_state")).sessionId;

const SCENARIOS: Record<string, (ctx: Ctx) => Promise<void>> = {
  // (1) thinking이 있는 글 turn. v2 협상과 filter 답은 launch가 기록한다.
  async text(ctx) {
    const rec = await launch(ctx, ["--thinking=low"]);
    await rec.call("get_state");
    await rec.prompt("Reply with exactly the word pong. Do not use any tool.");
    await rec.call("get_state");
    await rec.stop();
  },

  // (2) 기본 yolo의 tool turn.
  async tools(ctx) {
    const rec = await launch(ctx, ["--approval-mode=yolo"]);
    await rec.prompt(
      "Read the file hello.txt with the read tool, then run `echo done` with the bash tool, then answer in one short sentence.",
    );
    await rec.stop();
  },

  // (3) write mode의 승인: bash 하나는 Approve, 다른 하나는 Deny.
  async approval(ctx) {
    const rec = await launch(ctx, ["--approval-mode=write"]);
    for (const [word, value] of [
      ["one", "Approve"],
      ["two", "Deny"],
    ] as const) {
      const from = rec.mark();
      const id = `rec-p-${word}`;
      rec.send({
        id,
        type: "prompt",
        message: `Run \`echo ${word}\` with the bash tool and tell me its output.`,
      });
      const ask = await rec.until(isApproval, `the approval for ${word}`, from);
      rec.note(`answering ${value}`);
      rec.send({ type: "extension_ui_response", id: ask.id, value });
      await rec.until(
        (frame) => frame.type === "prompt_result" && frame.id === id,
        "prompt_result",
        from,
      );
      await rec
        .until(
          (frame) => frame.type === "session_settled",
          "session_settled",
          from,
        )
        .catch(() => {});
    }
    await rec.stop();
  },

  // (4) `ask` tool과 질문 묶음 답.
  async ask(ctx) {
    const rec = await launch(ctx, ["--approval-mode=yolo"]);
    const from = rec.mark();
    const id = "rec-p-ask";
    rec.send({
      id,
      type: "prompt",
      message:
        "Use the ask tool to ask me which color I prefer, with the options red and blue. Then reply with my choice only.",
    });
    const ask = await rec.until(
      (frame) =>
        frame.type === "extension_ui_request" && frame.method === "ask",
      "the ask dialog",
      from,
    );
    const questions = ask.questions ?? [];
    rec.send({
      type: "extension_ui_response",
      id: ask.id,
      answers: questions.map((one) => ({
        id: one.id,
        selectedOptions: one.options[0] ? [one.options[0].label] : [],
      })),
    });
    await rec.until(
      (frame) => frame.type === "prompt_result" && frame.id === id,
      "prompt_result",
      from,
    );
    await rec
      .until(
        (frame) => frame.type === "session_settled",
        "session_settled",
        from,
      )
      .catch(() => {});
    await rec.stop();
  },

  // (5) 도는 중 steer, follow-up 둘, 지우기, 올리기, queue_update.
  async queue(ctx) {
    const rec = await launch(ctx, ["--approval-mode=yolo"]);
    const from = rec.mark();
    const id = "rec-p-queue";
    rec.send({
      id,
      type: "prompt",
      message: "Run `sleep 10` with the bash tool, then say done.",
    });
    await rec.until(
      (frame) => frame.type === "tool_execution_start",
      "the tool start",
      from,
    );
    await rec.call("prompt", {
      message: "Also say the word steered.",
      streamingBehavior: "steer",
    });
    await rec.call("follow_up", { message: "follow one" });
    await rec.call("follow_up", { message: "follow two" });
    await rec.call("remove_queued_message", {
      message: "follow two",
      queue: "followUp",
    });
    await rec.call("promote_queued_message", { message: "follow one" });
    await rec.until(
      (frame) => frame.type === "prompt_result" && frame.id === id,
      "prompt_result",
      from,
      240 * SECOND,
    );
    await rec
      .until(
        (frame) => frame.type === "session_settled",
        "session_settled",
        from,
        240 * SECOND,
      )
      .catch(() => {});
    await rec.stop();
  },

  // (6) abort와 abort_and_restore_queue.
  async abort(ctx) {
    const rec = await launch(ctx, ["--approval-mode=yolo"]);
    const long =
      "Write a very long numbered list of 200 programming tips, one per line, no tools.";
    let from = rec.mark();
    let id = "rec-p-abort";
    rec.send({ id, type: "prompt", message: long });
    await rec.until(
      (frame) => frame.type === "message_update",
      "streaming",
      from,
    );
    await rec.call("abort");
    await rec.until(
      (frame) => frame.type === "prompt_result" && frame.id === id,
      "prompt_result",
      from,
    );
    await rec
      .until(
        (frame) => frame.type === "session_settled",
        "session_settled",
        from,
      )
      .catch(() => {});

    from = rec.mark();
    id = "rec-p-restore";
    rec.send({ id, type: "prompt", message: long });
    await rec.until(
      (frame) => frame.type === "message_update",
      "streaming",
      from,
    );
    await rec.call("follow_up", { message: "queued follow-up" });
    await rec.call("prompt", {
      message: "queued steer",
      streamingBehavior: "steer",
    });
    await rec.call("abort_and_restore_queue");
    await rec.until(
      (frame) => frame.type === "prompt_result" && frame.id === id,
      "prompt_result",
      from,
    );
    await rec
      .until(
        (frame) => frame.type === "session_settled",
        "session_settled",
        from,
      )
      .catch(() => {});
    await rec.stop();
  },

  // (7) 목록과 model, thinking 바꾸기. model 호출이 없다.
  async models(ctx) {
    const rec = await launch(ctx);
    await rec.call("get_state");
    await rec.call("get_available_commands");
    const models = data<{ models: { id: string; provider: string }[] }>(
      await rec.call("get_available_models"),
    ).models;
    const levels = data<{ levels: string[] }>(
      await rec.call("get_available_thinking_levels"),
    ).levels;
    const state = data<{
      model?: { id: string; provider: string };
      thinkingLevel?: string;
    }>(await rec.call("get_state"));
    const level = levels.find(
      (one) => one !== state.thinkingLevel && one !== "off",
    );
    if (level) await rec.call("set_thinking_level", { level });
    const other = models.find(
      (one) =>
        one.provider === state.model?.provider && one.id !== state.model?.id,
    );
    if (other)
      await rec.call("set_model", {
        provider: other.provider,
        modelId: other.id,
      });
    await sleep(500);
    await rec.call("get_state");
    await rec.call("get_available_thinking_levels");
    await rec.stop();
  },

  // (8) 수동 compaction.
  async compact(ctx) {
    const rec = await launch(ctx, ["--approval-mode=yolo"]);
    await rec.prompt(
      "Reply with a two sentence summary of what a hash map is. Do not use any tool.",
    );
    await rec.call("compact", {}, 240 * SECOND);
    await sleep(500);
    await rec.call("get_state");
    await rec.stop();
  },

  // (9) get_entries 뒤 사람 entry에 branch, 그리고 fork.
  async branch(ctx) {
    const rec = await launch(ctx, ["--approval-mode=yolo"]);
    await rec.prompt("Reply with exactly the word one. Do not use any tool.");
    await rec.prompt("Reply with exactly the word two. Do not use any tool.");
    const before = await sessionIdOf(rec);
    const entries = await entriesOf(rec);
    const second = userEntries(entries)[1];
    if (!second) throw new Error("no second user entry");
    rec.note(`branching at the second user entry; session before: ${before}`);
    await rec.call("branch", { entryId: second.id });
    rec.note(`session after branch: ${await sessionIdOf(rec)}`);
    await rec.call("get_entries");
    await rec.prompt("Reply with exactly the word three. Do not use any tool.");
    const entries2 = await entriesOf(rec);
    const assistant = entries2.find(
      (one) => one.type === "message" && one.message?.role === "assistant",
    );
    if (!assistant) throw new Error("no assistant entry");
    rec.note(
      `forking at the first assistant entry; session before: ${await sessionIdOf(rec)}`,
    );
    await rec.call("fork", { entryId: assistant.id });
    rec.note(`session after fork: ${await sessionIdOf(rec)}`);
    await rec.call("get_entries");
    await rec.call("fork", {});
    rec.note(`session after whole fork: ${await sessionIdOf(rec)}`);
    await rec.stop();
  },

  // (10) print mode(TUI의 대신)가 만든 session을 rpc-ui로 이어 받기와 get_messages_page, 그 반대.
  async resume(ctx) {
    const cli = (args: string[]) => {
      const run = spawnSync(
        "omp",
        [
          "-p",
          `--cwd=${ctx.cwd}`,
          `--session-dir=${SESSIONS}`,
          "--approval-mode=yolo",
          `--model=${model}`,
          ...args,
        ],
        { cwd: ctx.cwd, env: baseEnv, encoding: "utf8", timeout: 240 * SECOND },
      );
      ctx.log.write("lead_note", {
        cli: ["omp", "-p", ...args],
        status: run.status,
        stdout: run.stdout,
        stderr: run.stderr,
      });
    };
    const before = new Set(sessionFiles());
    cli(["Reply with exactly the word alpha. Do not use any tool."]);
    const created = sessionFiles().filter((one) => !before.has(one));
    if (created.length !== 1)
      throw new Error(`expected one new session file, got ${created.length}`);
    const file = created[0] as string;
    const id = file.match(/_([^_/]+)\.jsonl$/)?.[1];
    if (!id) throw new Error(`cannot read a session id from ${file}`);
    ctx.log.write("lead_note", `print mode made session ${id}`);

    const rec = await launch(ctx, ["--approval-mode=yolo", `--resume=${id}`]);
    const state = data<{ sessionId: string }>(await rec.call("get_state"));
    rec.note(`rpc-ui resumed; sessionId ${state.sessionId} (expected ${id})`);
    await rec.call("get_messages_page", { limit: 256 });
    await rec.prompt("Reply with exactly the word beta. Do not use any tool.");
    rec.note(
      `after a turn sessionId ${await sessionIdOf(rec)}; files now ${sessionFiles().length}`,
    );
    await rec.stop();

    const filesBefore = sessionFiles().length;
    cli([
      `--resume=${id}`,
      "Reply with exactly the word gamma. Do not use any tool.",
    ]);
    ctx.log.write("lead_note", {
      filesBeforeReverse: filesBefore,
      filesAfterReverse: sessionFiles().length,
    });
  },

  // (11) 로컬 명령의 command_output.
  async command_output(ctx) {
    const rec = await launch(ctx);
    await rec.call("get_available_commands");
    await rec.prompt("/context");
    await rec.prompt("/usage");
    await rec.stop();
  },

  // (12) task subagent와 progress 구독.
  async subagent(ctx) {
    const rec = await launch(ctx, ["--approval-mode=yolo"]);
    await rec.call("set_subagent_subscription", { level: "progress" });
    await rec.prompt(
      "Use the task tool to start exactly one subagent that reads hello.txt and reports its first line. Then reply with that line.",
      {},
      300 * SECOND,
    );
    await rec.call("get_subagents");
    await rec.stop();
  },

  // (13) provider 오류 turn. 틀린 key로 보낸다.
  async error(ctx) {
    const rec = await launch(ctx, [
      "--approval-mode=yolo",
      "--api-key=invalid-key-for-recording",
    ]);
    await rec.call("set_auto_retry", { enabled: false });
    await rec.prompt("Reply with the word hi.", {}, 180 * SECOND);
    await rec.stop();
  },

  // (14) 가짜 LPN_TERMINAL_HOOK을 준 채 new_session과 branch를 해 lophn의 omp extension이 새 session id를 알리는지 본다.
  async hook(ctx) {
    const dir = join(OUT, "hook");
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const sink = join(dir, "sink.mjs");
    const calls = join(dir, "calls.jsonl");
    writeFileSync(
      sink,
      `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
let stdin = "";
process.stdin.on("data", (chunk) => (stdin += chunk));
process.stdin.on("end", () => appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ args: process.argv.slice(2), stdin: stdin ? JSON.parse(stdin) : null }) + "\\n"));
`,
    );
    chmodSync(sink, 0o755);
    // extension 폴더의 code는 coding-agent를 import하지 못한다. 녹화 script만 경로를 만들어 읽는다.
    const bodies = (await import(
      pathToFileURL(
        join(ROOT, "packages/coding-agent/harnesses/hook-bodies.ts"),
      ).href
    )) as { pluginSource(harness: string, command: string): string | null };
    const source = bodies.pluginSource("omp", sink);
    if (source === null) throw new Error("no omp extension body");
    const extension = join(dir, "lophn-status.ts");
    writeFileSync(extension, source);

    const rec = await launch(
      ctx,
      ["--approval-mode=yolo", "--no-extensions", "-e", extension],
      { LPN_TERMINAL_HOOK: join(dir, "fake.sock") },
    );
    rec.note(`session at start: ${await sessionIdOf(rec)}`);
    await rec.call("new_session");
    await sleep(500);
    rec.note(`session after new_session: ${await sessionIdOf(rec)}`);
    await rec.prompt("Reply with exactly the word hi. Do not use any tool.");
    const second = userEntries(await entriesOf(rec))[0];
    if (!second) throw new Error("no user entry");
    await rec.call("branch", { entryId: second.id });
    await sleep(500);
    rec.note(`session after branch: ${await sessionIdOf(rec)}`);
    await rec.stop();
    await sleep(500);
    ctx.log.write("lead_note", {
      hookCalls: readFileSync(calls, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as unknown),
    });
  },

  // (15) `/todo` 출력과 todo tool. abandoned가 나오게 시킨다.
  async todo(ctx) {
    const rec = await launch(ctx, ["--approval-mode=yolo"]);
    await rec.prompt("/todo");
    await rec.prompt(
      "Use the todo tool to make a plan with two tasks, then mark the first one completed and the second one abandoned. Then reply with ok.",
    );
    await rec.prompt("/todo");
    await rec.call("get_state");
    await rec.stop();
  },

  // (16) 사용량: `/stats`, `/session`, `get_session_stats`. 한 turn 뒤에 본다.
  async stats(ctx) {
    const rec = await launch(ctx, ["--approval-mode=yolo"]);
    await rec.prompt("Reply with exactly the word pong. Do not use any tool.");
    await rec.call("get_session_stats");
    await rec.prompt("/stats");
    await rec.prompt("/session");
    await rec.call("get_state");
    await rec.stop();
  },

  // (17) 도는 중 `/context`를 followUp으로. 명령은 바로 처리되는지, 도는 turn을 끝내는지 본다. 명령 출력을 본 뒤 abort한다.
  async command_during_turn(ctx) {
    const rec = await launch(ctx, ["--approval-mode=yolo"]);
    const from = rec.mark();
    const id = "rec-p-long";
    rec.send({
      id,
      type: "prompt",
      message:
        "Write a numbered list of 60 programming tips, one per line, no tools.",
    });
    await rec.until(
      (frame) => frame.type === "message_update",
      "streaming",
      from,
    );
    const at = rec.mark();
    await rec.call("prompt", {
      message: "/context",
      streamingBehavior: "followUp",
    });
    await rec
      .until(
        (frame) => frame.type === "command_output",
        "the command_output",
        at,
        30 * SECOND,
      )
      .catch(() => rec.note("no command_output while the turn was running"));
    await rec.call("abort");
    await rec.until(
      (frame) => frame.type === "prompt_result" && frame.id === id,
      "prompt_result",
      from,
    );
    await rec
      .until(
        (frame) => frame.type === "session_settled",
        "session_settled",
        from,
      )
      .catch(() => {});
    await rec.stop();
  },

  // (18) `events` 구독의 subagent: 도는 중 get_subagents, get_subagent_messages, steer_subagent. 그 뒤 detached 하나와 cancel_subagent.
  async subagent_events(ctx) {
    const rec = await launch(ctx, ["--approval-mode=yolo"]);
    await rec.call("set_subagent_subscription", { level: "events" });

    let from = rec.mark();
    let id = "rec-p-sub";
    rec.send({
      id,
      type: "prompt",
      message:
        "Use the task tool to start exactly one subagent that reads hello.txt and reports its first line. Then reply with that line.",
    });
    const started = await rec.until(
      (frame) =>
        frame.type === "subagent_lifecycle" && frame.payload?.id !== undefined,
      "the subagent start",
      from,
      180 * SECOND,
    );
    const subagentId = started.payload?.id as string;
    await rec.call("get_subagents");
    await rec.call("get_subagent_messages", { subagentId });
    await rec.call("steer_subagent", {
      subagentId,
      message: "Also mention the word steered in your report.",
    });
    await rec.until(
      (frame) => frame.type === "prompt_result" && frame.id === id,
      "prompt_result",
      from,
      300 * SECOND,
    );
    await rec
      .until(
        (frame) => frame.type === "session_settled",
        "session_settled",
        from,
        300 * SECOND,
      )
      .catch(() => {});
    await rec.call("get_subagent_messages", { subagentId });

    from = rec.mark();
    id = "rec-p-bg";
    rec.send({
      id,
      type: "prompt",
      message:
        "Use the task tool to start one background subagent that runs `sleep 120` with the bash tool and then reports done. Do not wait for it; reply started right away.",
    });
    const background = await rec
      .until(
        (frame) =>
          frame.type === "subagent_lifecycle" &&
          frame.payload?.detached === true,
        "a detached subagent",
        from,
        180 * SECOND,
      )
      .catch(() => {
        rec.note("no detached subagent appeared");
        return undefined;
      });
    await rec.until(
      (frame) => frame.type === "prompt_result" && frame.id === id,
      "prompt_result",
      from,
      300 * SECOND,
    );
    await rec.call("get_subagents");
    if (background?.payload?.id !== undefined) {
      await rec.call("cancel_subagent", { subagentId: background.payload.id });
      await sleep(2 * SECOND);
      await rec.call("get_subagents");
    }
    await rec.stop();
  },

  // (19) goal create, pause, drop. prompt를 보내지 않는다(이어가기 turn이 돌지 않게).
  async goal(ctx) {
    const rec = await launch(ctx, ["--approval-mode=yolo"]);
    await rec.call("get_state");
    await rec.call("goal", {
      op: "create",
      objective: "Reply with the word done and nothing else.",
    });
    await rec.call("get_state");
    await rec.call("goal", { op: "pause" });
    await rec.call("goal", { op: "resume" });
    await rec.call("goal", { op: "pause" });
    await rec.call("goal", { op: "drop" });
    await rec.call("get_state");
    await rec.stop();
  },

  // (20) fast on/off. on 뒤에 prompt를 보내지 않는다(priority tier는 비싸다). slow는 session scope일 때만.
  async fast(ctx) {
    const rec = await launch(ctx);
    const state = data<{ slowModeScope?: string; slowModeSupported?: boolean }>(
      await rec.call("get_state"),
    );
    await rec.call("set_fast_mode", { enabled: true });
    await rec.call("get_state");
    await rec.call("set_fast_mode", { enabled: false });
    if (state.slowModeSupported === true && state.slowModeScope === "session") {
      await rec.call("set_slow_mode", { enabled: true });
      await rec.call("get_state");
      await rec.call("set_slow_mode", { enabled: false });
    } else {
      rec.note(`slow mode not touched: scope ${state.slowModeScope}`);
    }
    await rec.call("get_state");
    await rec.stop();
  },

  // (21) `bash`와 `abort_bash`, 그리고 resume해 get_messages_page의 bash 기록.
  async bash(ctx) {
    const rec = await launch(ctx, ["--approval-mode=yolo"]);
    await rec.call("bash", { command: "ls" });
    const from = rec.mark();
    rec.send({ id: "rec-bash-sleep", type: "bash", command: "sleep 30" });
    await sleep(2 * SECOND);
    await rec.call("abort_bash");
    await rec.until(
      (frame) => frame.type === "response" && frame.id === "rec-bash-sleep",
      "the sleep bash response",
      from,
    );
    const sessionId = await sessionIdOf(rec);
    await rec.stop();

    const again = await launch(ctx, [
      "--approval-mode=yolo",
      `--resume=${sessionId}`,
    ]);
    await again.call("get_messages_page", { limit: 256 });
    await again.stop();
  },

  // (22) `/switch @smol`과 model_changed. role model은 사람 설정이라 비쌀 수 있어 prompt를 보내지 않는다.
  async switch_role(ctx) {
    const rec = await launch(ctx);
    await rec.call("get_state");
    await rec.prompt("/switch @smol");
    await rec.call("get_state");
    await rec.stop();
  },

  // (23) new_session과 그 뒤 get_state, get_entries. 앞 turn이 있어야 앞 대화가 어떻게 되는지 보인다.
  async new_session(ctx) {
    const rec = await launch(ctx, ["--approval-mode=yolo"]);
    await rec.prompt("Reply with exactly the word pong. Do not use any tool.");
    rec.note(`session before: ${await sessionIdOf(rec)}`);
    await rec.call("new_session");
    await sleep(500);
    await rec.call("get_state");
    await rec.call("get_entries");
    await rec.stop();
  },

  // (24) `/export`의 출력(경로). export_html RPC는 쓰지 않는다. cwd가 tmp라 파일은 같이 지워진다.
  async export(ctx) {
    const rec = await launch(ctx, ["--approval-mode=yolo"]);
    await rec.prompt("Reply with exactly the word pong. Do not use any tool.");
    await rec.prompt("/export");
    await rec.stop();
  },
};

async function main() {
  mkdirSync(SESSIONS, { recursive: true });
  const names = wanted.length > 0 ? wanted : Object.keys(SCENARIOS);
  let failed = 0;
  for (const name of names) {
    const run = SCENARIOS[name];
    if (run === undefined) {
      console.error(`unknown scenario ${name}`);
      failed += 1;
      continue;
    }
    const log = new Log(join(OUT, `${name}.jsonl`));
    console.log(`== ${name}`);
    const cwd = workdir(name);
    try {
      await run({ name, cwd, log });
      console.log(`   done -> ${log.path}`);
    } catch (cause) {
      failed += 1;
      log.write(
        "lead_note",
        `scenario failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      console.error(
        `   FAILED: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    } finally {
      for (const rec of active.splice(0)) await rec.stop();
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  process.exit(failed === 0 ? 0 : 1);
}

void main();
