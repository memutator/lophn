// 녹화 script. 사람 PATH의 `agy acp`(ACP stdio JSON-RPC)를 진짜 model로 띄워 scenario를 차례로 몰고, 보낸 줄(send)과 받은 줄(recv)을
// `<out>/<scenario>.jsonl`에 `{t, kind, data}`로 쓴다. test는 이것을 돌리지 않는다. 사람 허락 아래 사람이 돌린다.
//
// 저장소 root에서:
//   node --experimental-strip-types --no-warnings packages/core/extensions/bundled/harness-gui/fixtures/antigravity/record.ts --out <dir> [scenario ...]
// scenario를 안 주면 아래를 다 돈다. model은 늘 가장 싼 `gemini-3.8-flash` + thought_level `low`로 바꾼 뒤 보낸다.
// agy는 대화를 사람의 `~/.gemini/antigravity-cli/`에 쓴다(auth도 거기 있어 따로 둘 수 없다). 그래서 녹화가 만든 대화 id를
// `<out>/created.txt`에 적고 끝날 때 그 대화의 `conversations/<id>.db*`와 `brain/<id>/`만 지운다.
// scenario cwd는 os.tmpdir() 아래 mkdtemp 폴더이고 끝나면 지운다. 상위 lophn 터미널 env(`LPN_*`, `LOPHN_*`)는 빼고 띄운다.
// 영구 승인(allow_always)은 보내지 않는다.
import { type ChildProcess, spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

type Msg = {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
};
type Update = { sessionUpdate?: string; [key: string]: unknown };

const SECOND = 1000;
const MODEL = "gemini-3.8-flash";
const STORE = join(homedir(), ".gemini", "antigravity-cli");
// 1x1 빨간 PNG.
const RED_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

const argv = process.argv.slice(2);
const outAt = argv.indexOf("--out");
const outArg = outAt >= 0 ? argv[outAt + 1] : undefined;
const wanted = argv.filter(
  (one, index) => !one.startsWith("--") && argv[index - 1] !== "--out",
);
if (outArg === undefined) {
  console.error("usage: record.ts --out <dir> [scenario ...]");
  process.exit(1);
}
const OUT = resolve(outArg);
mkdirSync(OUT, { recursive: true });
const created: string[] = [];

const baseEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined &&
      !entry[0].startsWith("LPN_") &&
      !entry[0].startsWith("LOPHN_"),
  ),
);

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

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

type Answer = (msg: Msg) => unknown;

/** 띄운 `agy acp` 하나. 받은 줄을 `msgs`에 쌓고, agent가 보낸 요청은 `answer`로 답한다. */
class Rec {
  msgs: Msg[] = [];
  exited = false;
  answer: Answer = () => ({ outcome: { outcome: "cancelled" } });
  private buffer = "";
  private counter = 0;
  readonly proc: ChildProcess;
  private log: Log;

  constructor(log: Log, cwd: string) {
    this.log = log;
    this.proc = spawn("agy", ["acp"], {
      cwd,
      env: baseEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc.stdout?.setEncoding("utf8");
    this.proc.stdout?.on("data", (text: string) => {
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
    this.proc.stderr?.setEncoding("utf8");
    this.proc.stderr?.on("data", (text: string) => log.write("stderr", text));
    this.proc.on("exit", (code) => {
      this.exited = true;
      log.write("lead_note", `agy exited with code ${code}`);
    });
  }

  private onLine(line: string) {
    let msg: Msg;
    try {
      msg = JSON.parse(line) as Msg;
    } catch {
      this.log.write("recv_raw", line);
      return;
    }
    this.log.write("recv", msg);
    this.msgs.push(msg);
    if (msg.method !== undefined && msg.id !== undefined) {
      const result = this.answer(msg);
      if (result !== undefined) this.reply(msg.id, result);
    }
  }

  note(text: string) {
    this.log.write("lead_note", text);
  }

  private write(body: Msg) {
    this.log.write("send", body);
    this.proc.stdin?.write(`${JSON.stringify(body)}\n`);
  }

  reply(id: number | string, result: unknown) {
    this.write({ jsonrpc: "2.0", id, result: result as Msg["result"] });
  }

  notify(method: string, params: Record<string, unknown>) {
    this.write({ jsonrpc: "2.0", method, params });
  }

  /** 요청을 보내고 답을 기다리지 않는다. 답은 `response(id)`로 받는다. */
  request(method: string, params: Record<string, unknown>): number {
    const id = ++this.counter;
    this.write({ jsonrpc: "2.0", id, method, params });
    return id;
  }

  async until(
    pred: (msg: Msg) => boolean,
    what: string,
    from = 0,
    ms = 180 * SECOND,
  ): Promise<Msg> {
    const end = Date.now() + ms;
    for (;;) {
      const found = this.msgs.slice(from).find(pred);
      if (found) return found;
      if (this.exited) throw new Error(`agy exited while waiting for ${what}`);
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await sleep(25);
    }
  }

  response(id: number, ms?: number) {
    return this.until(
      (msg) => msg.id === id && msg.method === undefined,
      `response ${id}`,
      0,
      ms,
    );
  }

  async call(method: string, params: Record<string, unknown>, ms?: number) {
    return this.response(this.request(method, params), ms);
  }

  updates(from = 0): Update[] {
    return this.msgs
      .slice(from)
      .filter((msg) => msg.method === "session/update")
      .map((msg) => (msg.params?.update ?? {}) as Update);
  }

  async stop() {
    if (this.exited) return;
    this.proc.stdin?.end();
    for (let i = 0; i < 40 && !this.exited; i++) await sleep(100);
    if (!this.exited) this.proc.kill("SIGTERM");
    for (let i = 0; i < 40 && !this.exited; i++) await sleep(100);
  }
}

const initialize = (rec: Rec, elicitation = false) =>
  rec.call("initialize", {
    protocolVersion: 1,
    clientCapabilities: {
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
      ...(elicitation ? { elicitation: { form: {} } } : {}),
    },
    clientInfo: { name: "lophn", version: "0.0.0" },
  });

/** 새 session을 열고 싼 model로 바꾼다. */
async function fresh(rec: Rec, cwd: string): Promise<string> {
  const opened = await rec.call("session/new", { cwd, mcpServers: [] });
  const session = String(opened.result?.sessionId);
  created.push(session);
  await rec.call("session/set_config_option", {
    sessionId: session,
    configId: "model",
    value: MODEL,
  });
  await rec.call("session/set_config_option", {
    sessionId: session,
    configId: "thought_level",
    value: "low",
  });
  return session;
}

const text = (body: string) => [{ type: "text", text: body }];

const prompt = (rec: Rec, session: string, blocks: unknown[]) =>
  rec.request("session/prompt", { sessionId: session, prompt: blocks });

const isQuestion = (msg: Msg) =>
  String(
    (msg.params?.toolCall as { toolCallId?: string } | undefined)?.toolCallId ??
      "",
  ).startsWith("interaction_");

const options = (msg: Msg) =>
  (msg.params?.options ?? []) as { optionId: string; kind?: string }[];

/** 질문은 첫 선택지, 승인은 `kind`가 맞는 선택지(없으면 취소)로 답한다. allow_always는 고르지 않는다. */
const answerWith =
  (kind: "allow_once" | "reject_once"): Answer =>
  (msg) => {
    if (msg.method === "session/request_permission") {
      const offered = options(msg);
      const pick = isQuestion(msg)
        ? offered[0]
        : offered.find((one) => one.kind === kind);
      return pick === undefined
        ? { outcome: { outcome: "cancelled" } }
        : { outcome: { outcome: "selected", optionId: pick.optionId } };
    }
    if (msg.method === "elicitation/create") {
      return { action: "accept", content: { answer: "tabs" } };
    }
    return undefined;
  };

type Scenario = (rec: Rec, cwd: string) => Promise<void>;

let toolsSession: string | null = null;

const SCENARIOS: Record<string, Scenario> = {
  async text(rec, cwd) {
    await initialize(rec);
    const session = await fresh(rec, cwd);
    await rec.response(
      prompt(rec, session, text("Reply with exactly: hello there")),
    );
  },

  async tools(rec, cwd) {
    rec.answer = answerWith("allow_once");
    await initialize(rec);
    const session = await fresh(rec, cwd);
    toolsSession = session;
    await rec.response(
      prompt(
        rec,
        session,
        text(
          "Run the shell command `ls -la`. Then create a file named notes.txt containing the single line 'hi'. Then edit notes.txt so the line reads 'hello'. Then read notes.txt back and tell me its contents.",
        ),
      ),
    );
  },

  async deny(rec, cwd) {
    rec.answer = answerWith("reject_once");
    await initialize(rec);
    const session = await fresh(rec, cwd);
    await rec.response(
      prompt(
        rec,
        session,
        text(
          "Run the shell command `echo denied-test` and show me the output.",
        ),
      ),
    );
  },

  async question(rec, cwd) {
    rec.answer = answerWith("allow_once");
    await initialize(rec);
    const session = await fresh(rec, cwd);
    await rec.response(
      prompt(
        rec,
        session,
        text(
          "Before doing anything else, use your tool for asking the user a question: ask whether I prefer tabs or spaces, offering exactly those two options. Then reply with one sentence naming my choice.",
        ),
      ),
    );
  },

  async question_form(rec, cwd) {
    rec.answer = answerWith("allow_once");
    await initialize(rec, true);
    const session = await fresh(rec, cwd);
    await rec.response(
      prompt(
        rec,
        session,
        text(
          "Before doing anything else, use your tool for asking the user a question: ask whether I prefer tabs or spaces, offering exactly those two options. Then reply with one sentence naming my choice.",
        ),
      ),
    );
  },

  async cancel(rec, cwd) {
    rec.answer = answerWith("allow_once");
    await initialize(rec);
    const session = await fresh(rec, cwd);
    const from = rec.msgs.length;
    const id = prompt(
      rec,
      session,
      text("Run the shell command `sleep 30` and then say done."),
    );
    await rec.until(
      (msg) =>
        msg.method === "session/update" &&
        (msg.params?.update as Update)?.sessionUpdate === "tool_call",
      "the sleep tool call",
      from,
    );
    await sleep(4 * SECOND);
    rec.note("sending session/cancel");
    rec.notify("session/cancel", { sessionId: session });
    await rec.response(id, 60 * SECOND);
    rec.note("prompt after cancel");
    await rec.response(prompt(rec, session, text("Reply with exactly: ok")));
  },

  async steer(rec, cwd) {
    rec.answer = answerWith("allow_once");
    await initialize(rec);
    const session = await fresh(rec, cwd);
    const from = rec.msgs.length;
    const first = prompt(
      rec,
      session,
      text("Run the shell command `sleep 10`, then reply 'first done'."),
    );
    await rec.until(
      (msg) =>
        msg.method === "session/update" &&
        (msg.params?.update as Update)?.sessionUpdate === "tool_call",
      "the sleep tool call",
      from,
    );
    await sleep(2 * SECOND);
    rec.note("sending a second prompt while the first turn runs");
    const second = prompt(
      rec,
      session,
      text("Also end your reply with the word banana."),
    );
    await rec.response(first);
    await rec.response(second);
  },

  async load(rec, cwd) {
    if (toolsSession === null) {
      rec.note("skipped: run together with `tools`");
      return;
    }
    await initialize(rec);
    await rec.call("session/list", { cwd });
    await rec.call("session/load", {
      sessionId: toolsSession,
      cwd,
      mcpServers: [],
    });
    await sleep(2 * SECOND);
  },

  async commands(rec, cwd) {
    await initialize(rec);
    const session = await fresh(rec, cwd);
    await rec.response(
      prompt(rec, session, text("Reply with exactly: first message")),
    );
    await rec.response(prompt(rec, session, text("/compact")));
  },

  async plan(rec, cwd) {
    rec.answer = answerWith("allow_once");
    await initialize(rec);
    const session = await fresh(rec, cwd);
    await rec.call("session/set_mode", { sessionId: session, modeId: "plan" });
    await rec.response(
      prompt(
        rec,
        session,
        text(
          "Plan how to add a README.md to this empty folder. Keep the plan to three short steps.",
        ),
      ),
    );
  },

  async image(rec, cwd) {
    await initialize(rec);
    const session = await fresh(rec, cwd);
    await rec.response(
      prompt(rec, session, [
        { type: "image", mimeType: "image/png", data: RED_PNG },
        { type: "text", text: "What single color is this image? One word." },
      ]),
    );
  },
};

// `load`는 `tools`가 만든 session을 다시 연다.
const ORDER = [
  "text",
  "tools",
  "load",
  "deny",
  "question",
  "question_form",
  "cancel",
  "steer",
  "commands",
  "plan",
  "image",
];

function forget(session: string) {
  for (const suffix of [".db", ".db-wal", ".db-shm"]) {
    rmSync(join(STORE, "conversations", `${session}${suffix}`), {
      force: true,
    });
  }
  const brain = join(STORE, "brain", session);
  if (existsSync(brain)) rmSync(brain, { recursive: true, force: true });
}

const picked = wanted.length > 0 ? wanted : ORDER;
for (const name of picked) {
  const run = SCENARIOS[name];
  if (run === undefined) {
    console.error(`unknown scenario ${name}`);
    continue;
  }
  const cwd = mkdtempSync(join(tmpdir(), "agy-rec-"));
  const log = new Log(join(OUT, `${name}.jsonl`));
  const rec = new Rec(log, cwd);
  console.log(`== ${name}`);
  try {
    await run(rec, cwd);
    console.log(`   ok`);
  } catch (error) {
    rec.note(`failed: ${String(error)}`);
    console.log(`   failed: ${String(error)}`);
  }
  await rec.stop();
  rmSync(cwd, { recursive: true, force: true });
}

writeFileSync(join(OUT, "created.txt"), `${created.join("\n")}\n`);
for (const session of created) forget(session);
console.log(`recorded to ${OUT}; removed ${created.length} conversations`);
