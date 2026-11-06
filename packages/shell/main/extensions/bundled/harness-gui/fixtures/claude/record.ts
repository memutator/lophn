// Claude adapter가 쓰는 SDK 동작을 진짜 `claude`로 녹화한다. 실제 model을 부르니 사람의 허락 아래 lead가 돌린다.
//
//   RECORD_OUT=<dir> node packages/shell/main/extensions/bundled/harness-gui/fixtures/claude/record.ts [scenario ...]
//
// RECORD_OUT은 꼭 준다(worktree 안 폴더는 merge 때 지워진다). scenario를 안 주면 전부 차례로 돈다.
// scenario마다 `<RECORD_OUT>/<scenario>.jsonl`에 한 줄씩
// `{t, kind, data}`를 쓴다(t: scenario 시작부터 ms). kind는
//   send               push한 user 메시지(uuid·priority 포함)
//   message            SDK가 낸 메시지 하나
//   can_use_tool       canUseTool 인자(signal 제외)
//   permission_result  recorder가 돌려준 답
//   call               Query method / library 함수 호출 {name, args, result | error}
//   spawn              claude process를 띄운 명령과 env에서 뺀 이름
//   lead_note          recorder가 본 것(파일 내용, 시간 초과 등)
//   iterator_error     query 순회가 던진 오류
// 사람 PATH의 `claude`를 쓰고 상위 session 표지(`CLAUDE*` 등)를 뺀 env로 띄운다. 사람의 permission 설정이 auto여도
// 승인 요청이 오게 permissionMode는 default로 고정한다. 기본 model은 haiku(싸다)이고 model·effort scenario만 기본 model이다.
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import {
  forkSession,
  getSessionInfo,
  getSessionMessages,
  getSubagentMessages,
  listSessions,
  listSubagents,
  query,
  renameSession,
  type CanUseTool,
  type Options,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type SDKUserMessage,
  type SpawnedProcess,
  type SpawnOptions,
} from "@anthropic-ai/claude-agent-sdk";

// `packages/shell/terminal-host/env.ts`의 SESSION_MARKER_NAME 중 Claude 쪽과 같다(extension은 그 file을 import하지 못한다).
const MARKERS = new Set([
  "AI_AGENT",
  "CLAUDECODE",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_PID",
  "CLAUDE_EFFORT",
]);

if (process.env.RECORD_OUT === undefined || process.env.RECORD_OUT === "") {
  console.error("RECORD_OUT is required (the output folder of the recording)");
  process.exit(1);
}
const OUT = resolve(process.env.RECORD_OUT);
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const hasText = (m: Msg, text: string) => JSON.stringify(m).includes(text);

// SDK 메시지에서 recorder가 읽는 칸만 적는다.
type Msg = {
  type: string;
  subtype?: string;
  session_id?: string;
  uuid?: string;
  state?: string;
  tasks?: { task_id: string }[];
  task_id?: string;
  task_type?: string;
  tool_use_id?: string;
  status?: string;
  parent_tool_use_id?: string | null;
  isReplay?: boolean;
  terminal_reason?: string;
  event?: { type?: string; delta?: { type?: string } };
  message?: { role?: string; content?: unknown };
};

class Recorder {
  readonly start = Date.now();
  readonly path: string;
  constructor(path: string) {
    this.path = path;
    writeFileSync(path, "");
  }
  write(kind: string, data: unknown) {
    appendFileSync(
      this.path,
      `${JSON.stringify({ t: Date.now() - this.start, kind, data })}\n`,
    );
  }
}

function pushable() {
  const items: SDKUserMessage[] = [];
  let wake: (() => void) | null = null;
  let ended = false;
  return {
    push(message: SDKUserMessage) {
      items.push(message);
      wake?.();
    },
    end() {
      ended = true;
      wake?.();
    },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        const next = items.shift();
        if (next !== undefined) yield next;
        else if (ended) return;
        else
          await new Promise<void>((done) => {
            wake = done;
          });
      }
    },
  };
}

type Decide = (
  tool: string,
  input: Record<string, unknown>,
  options: Parameters<CanUseTool>[2],
) => PermissionResult | Promise<PermissionResult>;

const allowOnce: Decide = (_tool, input) => ({
  behavior: "allow",
  updatedInput: input,
});
// 제안(suggestions)을 "이 session 동안"으로 바꿔 돌려준다. adapter의 always 길과 같다.
const allowSession: Decide = (_tool, input, options) => ({
  behavior: "allow",
  updatedInput: input,
  ...(options.suggestions === undefined
    ? {}
    : {
        updatedPermissions: options.suggestions.map(
          (one): PermissionUpdate => ({ ...one, destination: "session" }),
        ),
      }),
});

type Cancel = Query & { cancelAsyncMessage(uuid: string): Promise<boolean> };

// adapter가 받는 `spawn`의 최종 env와 같게 SDK가 만든 env에서 상위 session 표지를 뺀다(`cliEnv`).
function spawnClaude(rec: Recorder, options: SpawnOptions): SpawnedProcess {
  const env: Record<string, string> = {};
  const stripped: string[] = [];
  for (const [name, value] of Object.entries(options.env)) {
    if (value === undefined) continue;
    if (MARKERS.has(name))
      stripped.push(`${name}=${name.includes("ENTRYPOINT") ? value : "..."}`);
    else env[name] = value;
  }
  rec.write("spawn", {
    command: options.command,
    args: options.args,
    stripped,
  });
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });
  child.stderr.on("data", () => {});
  return child as unknown as SpawnedProcess;
}

class Run {
  readonly input = pushable();
  readonly messages: Msg[] = [];
  readonly q: Cancel;
  lastAt = Date.now();
  ended = false;
  readonly rec: Recorder;
  constructor(rec: Recorder, cwd: string, options: Options, decide: Decide) {
    this.rec = rec;
    const canUseTool: CanUseTool = async (tool, input, opts) => {
      const { signal: _signal, ...rest } = opts;
      rec.write("can_use_tool", { toolName: tool, input, options: rest });
      const result = await decide(tool, input, opts);
      rec.write("permission_result", result);
      return result;
    };
    const q = query({
      prompt: this.input,
      options: {
        cwd,
        pathToClaudeCodeExecutable: "claude",
        settingSources: ["user", "project", "local"],
        systemPrompt: { type: "preset", preset: "claude_code" },
        includePartialMessages: true,
        perTaskStopAffordance: true,
        enableFileCheckpointing: true,
        permissionMode: "default",
        model: "haiku",
        canUseTool,
        spawnClaudeCodeProcess: (spawnOptions) =>
          spawnClaude(rec, spawnOptions),
        ...options,
      },
    }) as Cancel;
    this.q = q;
    void (async () => {
      try {
        for await (const message of q) {
          this.messages.push(message as unknown as Msg);
          this.lastAt = Date.now();
          rec.write("message", message);
        }
      } catch (cause) {
        rec.write("iterator_error", String(cause));
      }
      this.ended = true;
    })();
  }

  user(
    content: string | unknown[],
    extra: {
      priority?: "now" | "next" | "later";
      uuid?: string;
      /** false면 transcript에만 붙고 turn을 열지 않는다(`!` shell 출력). */
      shouldQuery?: boolean;
      clientComposed?: boolean;
    } = {},
  ): SDKUserMessage {
    return {
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
      uuid: (extra.uuid ?? randomUUID()) as SDKUserMessage["uuid"],
      ...(extra.priority === undefined ? {} : { priority: extra.priority }),
      ...(extra.shouldQuery === undefined
        ? {}
        : { shouldQuery: extra.shouldQuery }),
      ...(extra.clientComposed === true ? { client_composed: true } : {}),
    } as SDKUserMessage;
  }

  send(message: SDKUserMessage) {
    this.rec.write("send", message);
    this.input.push(message);
    return message.uuid as string;
  }

  results() {
    return this.messages.filter((m) => m.type === "result").length;
  }

  /** 조건이 참이 될 때까지. 시간이 지나면 note를 남기고 false. */
  async until(label: string, test: () => boolean, ms = 180_000) {
    const limit = Date.now() + ms;
    while (!test()) {
      if (this.ended || Date.now() > limit) {
        this.rec.write("lead_note", `gave up waiting: ${label}`);
        return false;
      }
      await sleep(100);
    }
    return true;
  }

  /** 보내고 그 turn의 result까지 기다린다. */
  async ask(
    content: string | unknown[],
    extra: { priority?: "now" | "next" | "later"; uuid?: string } = {},
  ) {
    const before = this.results();
    const uuid = this.send(this.user(content, extra));
    await this.until(
      `result for ${String(content).slice(0, 40)}`,
      () => this.results() > before,
    );
    return uuid;
  }

  /** 새 메시지가 `quiet` ms 없을 때까지. */
  async settle(quiet = 6000, ms = 180_000) {
    const limit = Date.now() + ms;
    while (Date.now() - this.lastAt < quiet && Date.now() < limit)
      await sleep(200);
  }

  /** 명령 하나를 보내고 조용해질 때까지 기다린 뒤, 출력이 AC §5.2의 어느 꼴로 왔는지 남긴다. */
  async command(text: string, quiet = 8000, ms = 120_000) {
    const from = this.messages.length;
    this.send(this.user(text));
    await sleep(500);
    await this.settle(quiet, ms);
    const forms = this.messages.slice(from).flatMap((m) => {
      const raw = JSON.stringify(m);
      if (m.type === "stream_event") return [];
      const found: string[] = [`${m.type}${m.subtype ? `/${m.subtype}` : ""}`];
      if (raw.includes('"local_command_run"')) found.push("local_command_run");
      if (raw.includes("<local-command-stdout>"))
        found.push("local-command-stdout");
      if (raw.includes("<local-command-stderr>"))
        found.push("local-command-stderr");
      if (raw.includes('"context_usage"')) found.push("context_usage");
      if (raw.includes('"usage_report"')) found.push("usage_report");
      return [found.join("+")];
    });
    this.rec.write("lead_note", { command: text, forms });
  }

  async call<T>(name: string, args: unknown, fn: () => Promise<T>) {
    try {
      const result = await Promise.race([
        fn(),
        sleep(60_000).then(() => {
          throw new Error("recorder timeout 60s");
        }),
      ]);
      this.rec.write("call", { name, args, result });
      return result;
    } catch (cause) {
      this.rec.write("call", { name, args, error: String(cause) });
      return undefined;
    }
  }

  sessionId() {
    return this.messages.find((m) => m.session_id !== undefined)?.session_id;
  }

  async close() {
    this.input.end();
    this.q.close();
    await sleep(1500);
  }
}

type Ctx = {
  rec: Recorder;
  cwd: string;
  open(options?: Options, decide?: Decide): Run;
};

const textOfFile = (path: string) =>
  readFile(path, "utf8").catch(
    (cause: unknown) => `(unreadable: ${String(cause)})`,
  );

// session 대화에서 uuid의 직전 assistant 메시지 uuid.
async function assistantBefore(
  rec: Recorder,
  cwd: string,
  session: string,
  userUuid: string,
) {
  const list = await getSessionMessages(session, { dir: cwd });
  rec.write("call", {
    name: "getSessionMessages",
    args: { session, dir: cwd },
    result: list,
  });
  const at = list.findIndex((m) => m.uuid === userUuid);
  for (let i = (at < 0 ? list.length : at) - 1; i >= 0; i--) {
    if (list[i]?.type === "assistant") return list[i]?.uuid;
  }
  return undefined;
}

function png(size: number, rgb: [number, number, number]): string {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, tail]);
  };
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(Array.from({ length: size }, () => rgb).flat()),
  ]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk(
      "IDAT",
      deflateSync(Buffer.concat(Array.from({ length: size }, () => row))),
    ),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}

const printEnv = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      ([name, value]) => value !== undefined && !MARKERS.has(name),
    ),
  ) as Record<string, string>;

function claudeP(rec: Recorder, cwd: string, args: string[]): Promise<void> {
  return new Promise((done) => {
    execFile(
      "claude",
      args,
      { cwd, env: printEnv(), timeout: 180_000, maxBuffer: 8_000_000 },
      (error, stdout, stderr) => {
        let parsed: unknown = stdout;
        try {
          parsed = JSON.parse(stdout);
        } catch {
          // 글 그대로 둔다.
        }
        rec.write("call", {
          name: "claude -p",
          args,
          result: parsed,
          stderr: stderr.slice(-500),
          exit: error === null ? 0 : (error as { code?: unknown }).code,
        });
        done();
      },
    );
  });
}

const SCENARIOS: Record<string, (ctx: Ctx) => Promise<void>> = {
  // (a) 새 session에 sessionId를 넘기고 첫 turn 전에 목록과 사용량을 읽는다.
  async init({ rec, open }) {
    const sessionId = randomUUID();
    rec.write("lead_note", { passedSessionId: sessionId });
    const run = open({ sessionId, model: undefined });
    await run.call("supportedModels", {}, () => run.q.supportedModels());
    await run.call("supportedCommands", {}, () => run.q.supportedCommands());
    await run.call("getContextUsage", { detail: "summary" }, () =>
      run.q.getContextUsage({ detail: "summary" }),
    );
    await run.ask("Reply with the single word: ok");
    rec.write("lead_note", {
      initSessionId: run.sessionId(),
      same: run.sessionId() === sessionId,
    });
    await run.call("getContextUsage", { detail: "summary" }, () =>
      run.q.getContextUsage({ detail: "summary" }),
    );
    await run.call("getContextUsage", { detail: "full" }, () =>
      run.q.getContextUsage({ detail: "full" }),
    );
    await run.call("supportedModels", { after: "turn" }, () =>
      run.q.supportedModels(),
    );
    await run.close();
  },

  // (b) setModel, /effort(priority later), 거절되는 model.
  async model_effort({ open }) {
    const run = open({ model: undefined });
    await run.ask("Reply with the single word: ok");
    await run.call("setModel", "haiku", () => run.q.setModel("haiku"));
    run.send(run.user("/effort low", { priority: "later" }));
    await run.ask("Reply with the single word: ok");
    await run.settle(4000);
    await run.call("supportedModels", { after: "setModel" }, () =>
      run.q.supportedModels(),
    );
    await run.call("setModel", "no-such-model", () =>
      run.q.setModel("no-such-model"),
    );
    await run.ask("Reply with the single word: ok");
    await run.close();
  },

  // (c) plan mode → ExitPlanMode 승인에 setMode(acceptEdits).
  async plan_exit({ rec, cwd, open }) {
    const run = open({}, (tool, input) =>
      tool === "ExitPlanMode"
        ? {
            behavior: "allow",
            updatedInput: input,
            updatedPermissions: [
              { type: "setMode", mode: "acceptEdits", destination: "session" },
            ],
          }
        : { behavior: "allow", updatedInput: input },
    );
    await run.call("setPermissionMode", "plan", () =>
      run.q.setPermissionMode("plan"),
    );
    await run.ask(
      "Plan how to create a file named notes.txt that contains the word hello. When the plan is ready call ExitPlanMode, then carry the plan out.",
    );
    await run.settle(4000);
    rec.write("lead_note", {
      notes: await textOfFile(resolve(cwd, "notes.txt")),
    });
    await run.close();
  },

  // (d) 도는 중 priority next, cancelAsyncMessage 뒤 now로 다시.
  async steer({ rec, open }) {
    const run = open();
    run.send(
      run.user("Write the numbers from 1 to 150, one per line, nothing else."),
    );
    await run.until("first text delta", () =>
      run.messages.some(
        (m) =>
          m.type === "stream_event" && m.event?.delta?.type === "text_delta",
      ),
    );
    const b = run.send(
      run.user("After that, say the single word BETA.", { priority: "next" }),
    );
    const c = run.send(
      run.user("Also say the single word GAMMA.", { priority: "next" }),
    );
    await sleep(1000);
    await run.call("cancelAsyncMessage", c, () => run.q.cancelAsyncMessage(c));
    run.send(
      run.user("Stop and say the single word DELTA instead.", {
        priority: "now",
        uuid: randomUUID(),
      }),
    );
    rec.write("lead_note", { b, cancelled: c });
    await run.settle(10_000);
    await run.close();
  },

  // (e) tool이 도는 중 interrupt. aborted_tools.
  async interrupt_tool({ rec, open }) {
    const run = open();
    run.send(run.user("Run the shell command `sleep 40` and then say done."));
    await run.until("bash approval", () =>
      run.messages.some(
        (m) => m.type === "assistant" && hasText(m, "sleep 40"),
      ),
    );
    await sleep(4000);
    await run.call("interrupt", {}, () => run.q.interrupt());
    await run.until("result", () => run.results() > 0, 60_000);
    rec.write("lead_note", {
      results: run.messages
        .filter((m) => m.type === "result")
        .map((m) => m.terminal_reason),
    });
    await run.ask("Reply with the single word: ok");
    await run.close();
  },

  // (f) background task 하나, perTaskStopAffordance로 interrupt해도 살아남고 stopTask로 끈다.
  async background_task({ rec, open }) {
    const run = open();
    run.send(
      run.user(
        "Run `sleep 120` as a background shell command (Bash with run_in_background true). Then write the numbers from 1 to 200, one per line.",
      ),
    );
    const seen = () =>
      run.messages.find(
        (m) =>
          m.subtype === "background_tasks_changed" &&
          (m.tasks?.length ?? 0) > 0,
      );
    await run.until("background task", () => seen() !== undefined, 120_000);
    await sleep(1500);
    await run.call("interrupt", {}, () => run.q.interrupt());
    await run.until("result", () => run.results() > 0, 60_000);
    await run.settle(3000);
    const taskId = seen()?.tasks?.[0]?.task_id;
    rec.write("lead_note", { taskId });
    if (taskId !== undefined) {
      await run.call("stopTask", taskId, () => run.q.stopTask(taskId));
      await run.until(
        "task_notification",
        () => run.messages.some((m) => m.subtype === "task_notification"),
        30_000,
      );
    }
    await run.settle(3000);
    await run.close();
  },

  // (g) Write 뒤 rewindFiles dry-run과 실제.
  async rewind_files({ rec, cwd, open }) {
    const run = open();
    const u1 = await run.ask(
      "Create a file named a.txt containing exactly: one",
    );
    const u2 = await run.ask("Overwrite a.txt so it contains exactly: two");
    rec.write("lead_note", {
      u1,
      u2,
      before: await textOfFile(resolve(cwd, "a.txt")),
    });
    await run.call("rewindFiles dry", u2, () =>
      run.q.rewindFiles(u2, { dryRun: true }),
    );
    await run.call("rewindFiles", u2, () => run.q.rewindFiles(u2));
    rec.write("lead_note", {
      afterRewindToU2: await textOfFile(resolve(cwd, "a.txt")),
    });
    await run.call("rewindFiles dry", u1, () =>
      run.q.rewindFiles(u1, { dryRun: true }),
    );
    await run.call("rewindFiles dry", "no-such-uuid", () =>
      run.q.rewindFiles(randomUUID(), { dryRun: true }),
    );
    await run.close();
  },

  // (h) 대화 rewind: resume + resumeSessionAt + forkSession + 새 sessionId.
  async rewind_conversation({ rec, cwd, open }) {
    const first = open();
    await first.ask(
      "My first secret word is ALPHA. Reply with the single word: ok",
    );
    const u2 = await first.ask(
      "My second secret word is BETA. Reply with the single word: ok",
    );
    const id = first.sessionId();
    if (id === undefined) return rec.write("lead_note", "no session id");
    const at = await assistantBefore(rec, cwd, id, u2);
    rec.write("lead_note", { id, userUuid: u2, resumeSessionAt: at });
    await first.close();
    const sessionId = randomUUID();
    const second = open({
      resume: id,
      resumeSessionAt: at,
      forkSession: true,
      sessionId,
    });
    await second.ask(
      "Which secret words did I tell you so far? Answer with the words only.",
    );
    rec.write("lead_note", {
      newId: sessionId,
      initSessionId: second.sessionId(),
    });
    const fresh = second.sessionId() ?? sessionId;
    await second.call("getSessionMessages new", fresh, () =>
      getSessionMessages(fresh, { dir: cwd }),
    );
    await second.call("getSessionMessages old", id, () =>
      getSessionMessages(id, { dir: cwd }),
    );
    await second.close();
  },

  // (i) library forkSession, listSessions, renameSession.
  async fork_list({ rec, cwd, open }) {
    const run = open();
    const u1 = await run.ask("Reply with the single word: one");
    const u2 = await run.ask("Reply with the single word: two");
    const id = run.sessionId();
    if (id === undefined) return rec.write("lead_note", "no session id");
    const at = await assistantBefore(rec, cwd, id, u2);
    rec.write("lead_note", { id, u1, u2, forkAt: at });
    await run.close();
    await run.call("forkSession", { upToMessageId: at }, () =>
      forkSession(id, {
        dir: cwd,
        ...(at === undefined ? {} : { upToMessageId: at }),
        title: "fork of one",
      }),
    );
    await run.call("forkSession whole", {}, () =>
      forkSession(id, { dir: cwd }),
    );
    await run.call("listSessions includeProgrammatic", {}, () =>
      listSessions({ dir: cwd, includeProgrammatic: true }),
    );
    await run.call("listSessions default", {}, () =>
      listSessions({ dir: cwd }),
    );
    await run.call("listSessions not programmatic", {}, () =>
      listSessions({ dir: cwd, includeProgrammatic: false }),
    );
    await run.call("renameSession", "Renamed by recorder", () =>
      renameSession(id, "Renamed by recorder", { dir: cwd }),
    );
    await run.call("getSessionInfo", id, () =>
      getSessionInfo(id, { dir: cwd }),
    );
  },

  // shell_append: `!` 출력을 `<bash-input>`·`<bash-stdout>` 사람 메시지 둘(shouldQuery false, client_composed)로 넣는다.
  // 첫 메시지로 넣을 때(init이 오는가)와 turn 뒤에 넣을 때 stream에 무엇이 오는지(result, turn), 다음 질문에서 model이
  // 출력을 보는지, transcript의 entry 모양을 남긴다.
  async shell_append({ rec, cwd, open }) {
    writeFileSync(resolve(cwd, "hello.txt"), "hi\n");
    const run = open();
    const formsFrom = (from: number) =>
      run.messages
        .slice(from)
        .filter((m) => m.type !== "stream_event")
        .map((m) => `${m.type}${m.subtype ? `/${m.subtype}` : ""}`);
    const pair = (command: string, out: string, err = "") => {
      run.send(
        run.user(`<bash-input>${command}</bash-input>`, {
          shouldQuery: false,
          clientComposed: true,
        }),
      );
      run.send(
        run.user(
          `<bash-stdout>${out}</bash-stdout><bash-stderr>${err}</bash-stderr>`,
          {
            shouldQuery: false,
            clientComposed: true,
          },
        ),
      );
    };
    // 1) 이 session의 첫 메시지들로.
    let from = run.messages.length;
    pair("ls", "hello.txt\n");
    await sleep(500);
    await run.settle(8000, 30_000);
    rec.write("lead_note", {
      phase: "first messages",
      forms: formsFrom(from),
      results: run.results(),
      sessionId: run.sessionId() ?? null,
    });
    from = run.messages.length;
    await run.ask("What did the ls output show? One line.");
    rec.write("lead_note", {
      phase: "ask after first shell",
      forms: formsFrom(from),
    });
    // 2) turn 뒤에.
    from = run.messages.length;
    pair("echo shell-two", "shell-two\n");
    await sleep(500);
    await run.settle(8000, 30_000);
    rec.write("lead_note", {
      phase: "after a turn",
      forms: formsFrom(from),
      results: run.results(),
    });
    await run.ask("What did the echo output show? One line.");
    const id = run.sessionId();
    if (id === undefined) return rec.write("lead_note", "no session id");
    await run.close();
    await run.call("getSessionMessages", id, () =>
      getSessionMessages(id, { dir: cwd }),
    );
  },

  // sessions: adapter가 부르는 `listSessions({dir, limit: 30, includeProgrammatic: true})`와 false를 읽어 GUI session이
  // 어느 쪽에 드는지, 칸이 무엇인지 남긴다(scratch dir 안 session만).
  async sessions({ rec, cwd, open }) {
    const first = open();
    await first.ask("Reply with the single word: one");
    const id = first.sessionId();
    await first.close();
    const second = open();
    await second.ask("Reply with the single word: two");
    const other = second.sessionId();
    await second.close();
    rec.write("lead_note", { sessions: [id, other] });
    await first.call("listSessions adapter", {}, () =>
      listSessions({ dir: cwd, limit: 30, includeProgrammatic: true }),
    );
    await first.call("listSessions not programmatic", {}, () =>
      listSessions({ dir: cwd, limit: 30, includeProgrammatic: false }),
    );
  },

  // rewind_preview: 파일을 고친 뒤 그 사람 메시지 uuid로 `rewindFiles(uuid, {dryRun: true})`만 읽는다(실제 rewind는 하지 않는다).
  async rewind_preview({ rec, cwd, open }) {
    const run = open();
    const u1 = await run.ask(
      "Create a file named a.txt containing exactly: one",
    );
    const u2 = await run.ask("Overwrite a.txt so it contains exactly: two");
    const u3 = await run.ask("Reply with the single word: ok");
    rec.write("lead_note", {
      u1,
      u2,
      u3,
      now: await textOfFile(resolve(cwd, "a.txt")),
    });
    for (const [label, uuid] of [
      ["u1", u1],
      ["u2", u2],
      ["u3", u3],
    ] as const)
      await run.call(`rewindFiles dry ${label}`, uuid, () =>
        run.q.rewindFiles(uuid, { dryRun: true }),
      );
    await run.call("rewindFiles dry unknown", "no-such-uuid", () =>
      run.q.rewindFiles(randomUUID(), { dryRun: true }),
    );
    rec.write("lead_note", {
      still: await textOfFile(resolve(cwd, "a.txt")),
    });
    await run.close();
  },

  // fork_title: 한 turn 뒤 `forkSession(id, {dir})`과 새 id의 제목(`getSessionInfo`). SDK가 "… (fork)"로 짓는가.
  async fork_title({ rec, cwd, open }) {
    const run = open();
    await run.ask("Reply with the single word: one");
    const id = run.sessionId();
    if (id === undefined) return rec.write("lead_note", "no session id");
    await run.close();
    await run.call("getSessionInfo original", id, () =>
      getSessionInfo(id, { dir: cwd }),
    );
    const made = await run.call("forkSession", { dir: cwd }, () =>
      forkSession(id, { dir: cwd }),
    );
    if (made === undefined) return;
    await run.call("getSessionInfo fork", made.sessionId, () =>
      getSessionInfo(made.sessionId, { dir: cwd }),
    );
    await run.call("getSessionInfo original after", id, () =>
      getSessionInfo(id, { dir: cwd }),
    );
  },

  // (j) /compact.
  async compact({ open }) {
    const run = open();
    await run.ask("My secret word is ALPHA. Reply with the single word: ok");
    await run.ask("Reply with the single word: ok");
    run.send(run.user("/compact"));
    await run.until(
      "compact_boundary",
      () => run.messages.some((m) => m.subtype === "compact_boundary"),
      120_000,
    );
    await run.settle(6000);
    await run.close();
  },

  // (k) 명령 출력. 출력마다 어느 꼴(local_command_run / local-command-stdout / local_command_output)로 오는지 남긴다.
  async commands({ rec, open }) {
    const run = open();
    await run.call("supportedCommands", {}, () => run.q.supportedCommands());
    await run.ask("Reply with the single word: ok");
    await run.command("/context");
    await run.call("getContextUsage full", {}, () =>
      run.q.getContextUsage({ detail: "full" }),
    );
    await run.command("/usage", 30_000, 180_000);
    await run.command("/cost", 8000);
    await run.command("/effort");
    await run.command("/model");
    await run.command("/config");
    await run.command("/mcp");
    await run.command("/recap");
    await run.command(
      "/goal the file goal.txt exists and contains the word done",
    );
    await run.until(
      "active_goal",
      () => run.messages.some((m) => m.type === "active_goal"),
      30_000,
    );
    await run.settle(15_000);
    // goal을 지우는 말은 CLI가 정한다. 후보를 차례로 보낸다.
    await run.command("/goal clear");
    await run.command("/goal");
    rec.write("lead_note", {
      activeGoals: run.messages
        .filter((m) => m.type === "active_goal")
        .map((m) => JSON.stringify(m)),
    });
    await run.close();
  },

  // (l) image 하나.
  async image({ open }) {
    const run = open();
    await run.ask([
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: png(16, [255, 0, 0]),
        },
      },
      {
        type: "text",
        text: "What is the main color of this image? Answer with one word.",
      },
    ]);
    await run.close();
  },

  // (m) SDK session을 print mode로 이어 받기와 그 반대. TUI 쪽 이어 받기의 대신이다.
  async print_handoff({ rec, cwd, open }) {
    const first = open();
    await first.ask("My secret word is ALPHA. Reply with the single word: ok");
    const id = first.sessionId();
    await first.close();
    if (id === undefined) return rec.write("lead_note", "no session id");
    // tuiCommand와 같은 flag를 print mode에서 확인한다.
    await claudeP(rec, cwd, [
      "-p",
      "What is my secret word? One word.",
      "--resume",
      id,
      "--output-format",
      "json",
      "--permission-mode",
      "acceptEdits",
      "--model",
      "haiku",
      "--allowedTools",
      "Bash(echo:*)",
    ]);
    await claudeP(rec, cwd, [
      "-p",
      "Reply with the single word: ok",
      "--resume",
      id,
      "--output-format",
      "json",
      "--model",
      "sonnet",
      "--effort",
      "low",
    ]);
    // 반대: print mode로 만든 session을 SDK가 resume.
    const printed = randomUUID();
    await claudeP(rec, cwd, [
      "-p",
      "My other secret word is BETA. Reply with the single word: ok",
      "--output-format",
      "json",
      "--model",
      "haiku",
      "--session-id",
      printed,
    ]);
    const second = open({ resume: printed });
    await second.ask("What is my other secret word? Answer with one word.");
    await second.call("getSessionMessages", printed, () =>
      getSessionMessages(printed, { dir: cwd }),
    );
    await second.close();
  },

  // todo 목록: TodoWrite인지 Task tool(TaskCreate/TaskUpdate)인지, resume하면 어떻게 다시 오는지.
  async todo({ rec, cwd, open }) {
    // adapter와 같이 todo tool을 켠다(CLI는 SDK mode에서 이 flag가 있어야 TaskCreate 등을 낸다).
    const run = open({
      env: { ...process.env, CLAUDE_CODE_ENABLE_TODO_TOOLS: "1" },
    });
    await run.ask(
      "Make a todo list with three items (create a.txt, b.txt, c.txt, each containing its own letter). Then do them one at a time and mark each completed right after you finish it.",
    );
    const tools = new Set<string>();
    for (const m of run.messages) {
      if (m.type !== "assistant") continue;
      for (const c of (m.message?.content ?? []) as {
        type?: string;
        name?: string;
      }[])
        if (c.type === "tool_use" && c.name !== undefined) tools.add(c.name);
    }
    rec.write("lead_note", { toolsUsed: [...tools] });
    const id = run.sessionId();
    await run.close();
    if (id !== undefined)
      await run.call("getSessionMessages", id, () =>
        getSessionMessages(id, { dir: cwd }),
      );
  },

  // foreground Agent: parent_tool_use_id 자식 메시지, task_* 순서, 끝난 뒤 getSubagentMessages·listSubagents.
  async subagent({ rec, cwd, open }) {
    const run = open();
    await run.ask(
      "Use the Agent tool with a general-purpose subagent to run `ls` in the current directory and report the result in one sentence. Wait for it, then tell me what it said.",
    );
    const id = run.sessionId();
    const taskIds = [
      ...new Set(
        run.messages
          .filter((m) => m.subtype === "task_started")
          .map((m) => m.task_id),
      ),
    ];
    rec.write("lead_note", {
      id,
      taskIds,
      children: run.messages.filter((m) => m.parent_tool_use_id).length,
    });
    if (id !== undefined) {
      const listed = await run.call("listSubagents", id, () =>
        listSubagents(id, { dir: cwd }),
      );
      for (const one of new Set([...taskIds, ...(listed ?? [])]))
        if (one !== undefined)
          await run.call("getSubagentMessages", one, () =>
            getSubagentMessages(id, one, { dir: cwd }),
          );
    }
    await run.close();
  },

  // run_in_background Agent를 stopTask로 끈다.
  async subagent_background({ rec, cwd, open }) {
    const run = open();
    run.send(
      run.user(
        "Use the Agent tool with run_in_background true and a general-purpose subagent that runs the shell command `sleep 90` and then reports done. After it is launched, just say: launched.",
      ),
    );
    const started = () =>
      run.messages.find((m) => m.subtype === "task_started");
    await run.until("task_started", () => started() !== undefined, 120_000);
    await run.until("result", () => run.results() > 0, 120_000);
    await sleep(3000);
    const taskId = started()?.task_id;
    rec.write("lead_note", {
      taskId,
      taskType: started()?.task_type,
      toolUseId: started()?.tool_use_id,
    });
    if (taskId !== undefined) {
      await run.call("stopTask", taskId, () => run.q.stopTask(taskId));
      await run.until(
        "task_notification",
        () => run.messages.some((m) => m.subtype === "task_notification"),
        30_000,
      );
    }
    await run.settle(4000);
    const id = run.sessionId();
    if (id !== undefined && taskId !== undefined) {
      await run.call("listSubagents", id, () =>
        listSubagents(id, { dir: cwd }),
      );
      await run.call("getSubagentMessages", taskId, () =>
        getSubagentMessages(id, taskId, { dir: cwd }),
      );
    }
    await run.close();
  },

  // fast mode와 thinking toggle. 설정 file은 건드리지 않는다(applyFlagSettings는 이 query 한정이다).
  async fast({ rec, open }) {
    const run = open();
    await run.ask("Reply with the single word: ok");
    const models = await run.call("supportedModels", {}, () =>
      run.q.supportedModels(),
    );
    rec.write("lead_note", {
      fastModels: models
        ?.filter((m) => m.supportsFastMode === true)
        .map((m) => m.value),
      adaptiveModels: models
        ?.filter((m) => m.supportsAdaptiveThinking === true)
        .map((m) => m.value),
    });
    await run.call("applyFlagSettings fastMode true", {}, () =>
      run.q.applyFlagSettings({ fastMode: true }),
    );
    await run.ask("Reply with the single word: ok");
    await run.call("applyFlagSettings fastMode false", {}, () =>
      run.q.applyFlagSettings({ fastMode: false }),
    );
    await run.call("setMaxThinkingTokens 2000", {}, () =>
      run.q.setMaxThinkingTokens(2000),
    );
    await run.ask("Reply with the single word: ok");
    await run.call("setMaxThinkingTokens null", {}, () =>
      run.q.setMaxThinkingTokens(null),
    );
    await run.close();
  },

  // /clear: 열린 query 안에서 오는 것, 그리고 메시지 없는 새 sessionId를 `claude -p --resume`이 받는지.
  async clear_resume({ rec, cwd, open }) {
    const run = open();
    await run.ask("My secret word is ALPHA. Reply with the single word: ok");
    const before = run.sessionId();
    await run.command("/clear", 8000);
    await run.ask(
      "What is my secret word? Answer with one word, or say unknown.",
    );
    rec.write("lead_note", {
      before,
      sessionIds: [
        ...new Set(run.messages.map((m) => m.session_id).filter(Boolean)),
      ],
      inits: run.messages.filter((m) => m.subtype === "init").length,
    });
    await run.close();
    const empty = randomUUID();
    await claudeP(rec, cwd, [
      "-p",
      "Reply with the single word: ok",
      "--resume",
      empty,
      "--output-format",
      "json",
      "--model",
      "haiku",
    ]);
    await claudeP(rec, cwd, [
      "-p",
      "Reply with the single word: ok",
      "--session-id",
      empty,
      "--output-format",
      "json",
      "--model",
      "haiku",
    ]);
  },

  // origin: push한 uuid가 getSessionMessages의 uuid와 같고 resume해도 그대로인가.
  async origin({ rec, cwd, open }) {
    const first = open();
    const u1 = await first.ask("Reply with the single word: one");
    const id = first.sessionId();
    rec.write("lead_note", {
      pushed: u1,
      streamUserUuids: first.messages
        .filter((m) => m.type === "user")
        .map((m) => m.uuid),
      streamAssistantUuids: first.messages
        .filter((m) => m.type === "assistant")
        .map((m) => m.uuid),
    });
    await first.close();
    if (id === undefined) return rec.write("lead_note", "no session id");
    await first.call("getSessionMessages", id, () =>
      getSessionMessages(id, { dir: cwd }),
    );
    const second = open({ resume: id });
    const u2 = await second.ask("Reply with the single word: two");
    rec.write("lead_note", { pushedAfterResume: u2 });
    await second.close();
    await second.call("getSessionMessages after resume", id, () =>
      getSessionMessages(id, { dir: cwd }),
    );
  },

  // Edit·Write의 canUseTool 입력(old_string/new_string, 덮어쓰기와 새 file).
  async edit_approval({ cwd, open }) {
    writeFileSync(resolve(cwd, "f.txt"), "one\ntwo\nthree\n");
    writeFileSync(resolve(cwd, "g.txt"), "old\n");
    const run = open();
    await run.ask(
      "Do these in order: (1) use the Edit tool to change the line `two` to `TWO` in f.txt; (2) use the MultiEdit tool if you have it, otherwise Edit twice, to change `one` to `1` and `three` to `3` in f.txt; (3) use the Write tool to overwrite g.txt with the single line `new`; (4) use the Write tool to create h.txt containing `hello`.",
    );
    await run.close();
  },

  // 허락 규칙: "이 session 동안" 규칙이 같은 query 안에서는 먹고, 다시 열 때 allowedTools로 넣으면 먹고, 안 넣으면 잃는다.
  async rules_reopen({ rec, open }) {
    const rules: string[] = [];
    const learn: Decide = (tool, input, options) => {
      for (const one of options.suggestions ?? []) {
        if (one.type !== "addRules") continue;
        for (const rule of one.rules)
          rules.push(
            rule.ruleContent === undefined
              ? rule.toolName
              : `${rule.toolName}(${rule.ruleContent})`,
          );
      }
      return allowSession(tool, input, options);
    };
    const first = open({}, learn);
    await first.ask("Run the shell command `echo first` and show its output.");
    await first.ask("Run the shell command `echo second` and show its output.");
    const id = first.sessionId();
    rec.write("lead_note", { id, rules });
    await first.close();
    if (id === undefined) return;
    const second = open({ resume: id, allowedTools: rules }, allowOnce);
    await second.ask("Run the shell command `echo third` and show its output.");
    await second.close();
    const third = open({ resume: id }, allowOnce);
    await third.ask("Run the shell command `echo fourth` and show its output.");
    await third.close();
  },
};

async function main() {
  const names = process.argv.slice(2);
  const run = names.length === 0 ? Object.keys(SCENARIOS) : names;
  await mkdir(OUT, { recursive: true });
  for (const name of run) {
    const scenario = SCENARIOS[name];
    if (scenario === undefined) {
      console.error(`unknown scenario: ${name}`);
      continue;
    }
    const cwd = resolve(OUT, `${name}-cwd`);
    await rm(cwd, { recursive: true, force: true });
    await mkdir(cwd, { recursive: true });
    const rec = new Recorder(resolve(OUT, `${name}.jsonl`));
    const runs: Run[] = [];
    console.log(`scenario ${name} ...`);
    try {
      await scenario({
        rec,
        cwd,
        open(options = {}, decide = allowOnce) {
          const one = new Run(rec, cwd, options, decide);
          runs.push(one);
          return one;
        },
      });
    } catch (cause) {
      rec.write("lead_note", `scenario threw: ${String(cause)}`);
    }
    for (const one of runs) await one.close();
    console.log(`scenario ${name} done -> ${rec.path}`);
  }
}

await main();
process.exit(0);
