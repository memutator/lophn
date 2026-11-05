// Claude adapter가 쓰는 SDK 동작을 진짜 `claude`로 녹화한다. 실제 model을 부르니 사람의 허락 아래 lead가 돌린다.
//
//   node packages/shell/main/extensions/bundled/harness-gui/fixtures/claude/record.ts [scenario ...]
//
// scenario를 안 주면 전부 차례로 돈다. scenario마다 `.dev-data/adapter-claude/<scenario>.jsonl`에 한 줄씩
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
  listSessions,
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

const OUT = resolve(process.env.RECORD_OUT ?? ".dev-data/adapter-claude");
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
  status?: string;
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
    extra: { priority?: "now" | "next" | "later"; uuid?: string } = {},
  ): SDKUserMessage {
    return {
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
      uuid: (extra.uuid ?? randomUUID()) as SDKUserMessage["uuid"],
      ...(extra.priority === undefined ? {} : { priority: extra.priority }),
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

  // (k) 명령 출력(local_command_output).
  async context_command({ open }) {
    const run = open();
    await run.ask("Reply with the single word: ok");
    run.send(run.user("/context"));
    await run.settle(8000);
    run.send(run.user("/usage"));
    await run.settle(8000);
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
