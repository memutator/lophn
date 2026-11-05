// OpenCode server 녹화 script. 실제 `opencode serve`를 띄워 model을 부르므로 lead가 사람 허락 아래에서만 돌린다.
// worker와 test는 돌리지 않는다.
//
//   node packages/shell/main/extensions/bundled/harness-gui/fixtures/opencode/record.ts [scenario ...]
//
// scenario마다 새 server process를 `.dev-data/adapter-opencode/rec/<scenario>/`(0700) cwd에서 띄우고, HTTP+SSE client 둘
// (A = GUI, B = TUI 대신)로 몰아 `.dev-data/adapter-opencode/rec/<scenario>.jsonl`에 `{t, kind, data}` 줄로 쓴다.
// kind: http(요청과 응답 한 쌍), event(SSE event), note(scenario가 한 일). password와 url은 쓰지 않는다.
// `always` 승인은 보내지 않는다(사람의 OpenCode DB에 project 규칙이 남는다). session은 scenario가 끝나면 지운다.
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createApi,
  fetchTransport,
  type OpencodeApi,
  type OpencodeTransport,
} from "../../opencode.ts";

type Json = Record<string, unknown>;
const rec = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : {};
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown) => (typeof value === "string" ? value : "");
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

const ROOT = resolve(".dev-data/adapter-opencode/rec");
const WAIT_MS = 150_000;
// 싼 model. 다른 것을 쓰려면 `RECORD_MODEL=<provider>/<model>`(model id에도 "/"가 든다).
const MODEL =
  process.env.RECORD_MODEL ?? "openrouter/deepseek/deepseek-v4.1-flash-1017";
// 첫 판 녹화와 같다: shell과 edit에 ask를 걸어 승인 요청이 뜨게 한다. adapter 자신은 사람 설정을 바꾸지 않는다.
const ASK_CONFIG = JSON.stringify({
  permissions: [
    { action: "shell", resource: "*", effect: "ask" },
    { action: "edit", resource: "*", effect: "ask" },
  ],
});

type Server = {
  url: string;
  password: string;
  /** stdin을 닫아(lease) 끝내고, 안 끝나면 process group째 끈다. */
  stop(): Promise<void>;
};

function startServer(
  cwd: string,
  extraEnv: Record<string, string>,
): Promise<Server> {
  const password = randomBytes(16).toString("hex");
  const child: ChildProcess = spawn(
    "opencode",
    ["serve", "--stdio", "--port", "0"],
    {
      cwd,
      env: { ...process.env, ...extraEnv, OPENCODE_PASSWORD: password },
      stdio: ["pipe", "pipe", "ignore"],
      detached: true,
    },
  );
  const exited = new Promise<void>((done) => child.once("exit", () => done()));
  return new Promise((ready, fail) => {
    let buffer = "";
    child.once("error", fail);
    child.once("exit", () => fail(new Error("opencode serve exited early")));
    child.stdout?.setEncoding("utf8").on("data", (text: string) => {
      buffer += text;
      const line = buffer.split("\n").find((one) => one.startsWith("{"));
      if (line === undefined) return;
      ready({
        url: str((JSON.parse(line) as Json).url),
        password,
        async stop() {
          child.stdin?.end();
          await Promise.race([exited, sleep(5000)]);
          if (child.pid !== undefined && child.exitCode === null) {
            try {
              process.kill(-child.pid, "SIGTERM");
            } catch {
              // 이미 끝났다.
            }
          }
        },
      });
    });
  });
}

type Client = {
  api: OpencodeApi;
  events: Json[];
  /** 지금까지 받은 event 수. `until`의 `from`으로 쓴다. */
  mark(): number;
  until(
    predicate: (event: Json) => boolean,
    from?: number,
    ms?: number,
  ): Promise<Json | undefined>;
  close(): void;
};

function connect(
  label: string,
  server: Server,
  log: (kind: string, data: unknown) => void,
): Client {
  const base = fetchTransport(server);
  const transport: OpencodeTransport = {
    async request(method, path, options) {
      const call = { client: label, method, path, ...options };
      try {
        const response = await base.request(method, path, options);
        log("http", {
          ...call,
          status: response === undefined ? 204 : 200,
          response,
        });
        return response;
      } catch (cause) {
        const error = cause as Error & { status?: number };
        log("http", {
          ...call,
          status: error.status ?? 0,
          error: error.message,
        });
        throw cause;
      }
    },
    events: (onEvent, onEnd) =>
      base.events((event) => {
        log("event", { client: label, event });
        onEvent(event);
      }, onEnd),
  };
  const events: Json[] = [];
  const subscription = transport.events(
    (event) => events.push(event),
    (error) =>
      log("note", {
        client: label,
        text: `event stream ended: ${error.message}`,
      }),
  );
  return {
    api: createApi(transport),
    events,
    mark: () => events.length,
    async until(predicate, from = 0, ms = WAIT_MS) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const found = events.slice(from).find(predicate);
        if (found !== undefined) return found;
        await sleep(50);
      }
      log("note", { client: label, text: "timed out waiting for an event" });
      return undefined;
    },
    close: subscription.close,
  };
}

// 오류로 끝난 turn은 녹화로 쓸 수 없다. 150초를 더 기다리지 않고 scenario를 멈춘다.
function failed(events: Json[]) {
  const event = events.find((one) => one.type === "session.execution.failed");
  if (event !== undefined)
    throw new Error(
      `the turn failed: ${str(rec(rec(event.data).error).message).slice(0, 200)}`,
    );
}
const typeIs =
  (...types: string[]) =>
  (event: Json) =>
    types.includes(str(event.type));
const END = [
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
];

type Context = {
  cwd: string;
  a: Client;
  /** 두 번째 client. 처음 부를 때 연결한다. */
  b(): Client;
  note(text: string): void;
  /** adapter의 시작과 같은 호출. session을 만들고 id를 돌려준다. */
  begin(): Promise<string>;
  /** `type` event를 기다린다. 그 전에 turn이 끝나면(model 오류 등) 기다리지 않고 오류로 끝낸다. */
  expect(type: string, from: number): Promise<Json>;
  /** 한 turn이 끝날 때까지(`count`번째 끝 event까지). */
  idle(from: number, count?: number): Promise<void>;
  prompt(sid: string, text: string, extra?: Json): Promise<Json | undefined>;
  restart(): Promise<Client>;
};

type Scenario = {
  name: string;
  /** 승인 scenario만 ask 규칙을 건다. */
  ask?: boolean;
  run(c: Context): Promise<void>;
};

const SHELL_ONCE =
  "Use your shell tool to run exactly this command: touch once.txt . Then say done.";

function askedOf(event: Json) {
  return rec(event.data);
}

const scenarios: Scenario[] = [
  {
    name: "text",
    async run(c) {
      const sid = await c.begin();
      const mark = c.a.mark();
      await c.prompt(
        sid,
        "Reply with exactly this sentence and nothing else: Hello from the GUI fixture.",
      );
      await c.idle(mark);
      await c.a.api.get(sid);
      await c.a.api.context(sid);
      await c.a.api.messages(sid, { limit: 200, order: "asc" });
    },
  },
  {
    name: "steer",
    async run(c) {
      const sid = await c.begin();
      const mark = c.a.mark();
      await c.prompt(
        sid,
        "Count from 1 to 60, one number per line, then write the word done.",
        { delivery: "steer" },
      );
      await c.expect("session.text.delta", mark);
      c.note("steer while running");
      await c.prompt(sid, "Stop counting. Reply with exactly: STEERED.", {
        delivery: "steer",
      });
      await c.idle(mark);
    },
  },
  {
    name: "queue",
    async run(c) {
      const sid = await c.begin();
      const mark = c.a.mark();
      await c.prompt(sid, "Count from 1 to 40, one number per line.", {
        delivery: "queue",
      });
      await c.expect("session.text.delta", mark);
      c.note("queue three messages while running");
      await c.prompt(sid, "Reply with exactly: Q1.", { delivery: "queue" });
      const second = rec(
        (await c.prompt(sid, "Reply with exactly: Q2.", { delivery: "queue" }))
          ?.data,
      );
      const third = rec(
        (await c.prompt(sid, "Reply with exactly: Q3.", { delivery: "queue" }))
          ?.data,
      );
      await c.a.api.inbox(sid);
      c.note("second to steer, third cancelled");
      await c.a.api.inboxUpdate(sid, str(second.id), { delivery: "steer" });
      await c.a.api.inboxCancel(sid, str(third.id));
      await c.a.api.inbox(sid);
      await c.idle(mark, 2);
      await c.a.api.messages(sid, { limit: 200, order: "asc" });
    },
  },
  {
    name: "interrupt",
    async run(c) {
      const sid = await c.begin();
      const mark = c.a.mark();
      await c.prompt(sid, "Count from 1 to 200, one number per line.");
      await c.expect("session.text.delta", mark);
      await c.a.api.interrupt(sid);
      await c.idle(mark);
      await c.a.api.messages(sid, { limit: 200, order: "asc" });
    },
  },
  {
    name: "approve_once",
    ask: true,
    async run(c) {
      const sid = await c.begin();
      const mark = c.a.mark();
      await c.prompt(sid, SHELL_ONCE);
      const asked = askedOf(await c.expect("permission.asked", mark));
      await c.a.api.permissionReply(sid, str(asked.id), { decision: "once" });
      await c.idle(mark);
    },
  },
  {
    name: "approve_session",
    ask: true,
    async run(c) {
      const sid = await c.begin();
      const mark = c.a.mark();
      await c.prompt(sid, SHELL_ONCE);
      const asked = askedOf(await c.expect("permission.asked", mark));
      // 이 session 동안: session 규칙을 더하고 한 번만 허락한다. `always`는 보내지 않는다.
      const current = arr((await c.a.api.get(sid)).permissions);
      const rules = arr(asked.save).map((resource) => ({
        action: str(asked.action),
        resource: str(resource),
        effect: "allow",
      }));
      await c.a.api.update(sid, { permissions: [...current, ...rules] });
      await c.a.api.permissionReply(sid, str(asked.id), { decision: "once" });
      await c.idle(mark);
      c.note("same kind of command again: no permission.asked expected");
      const second = c.a.mark();
      await c.prompt(
        sid,
        "Use your shell tool to run exactly this command: touch twice.txt . Then say done.",
      );
      const again = await c.a.until(typeIs("permission.asked", ...END), second);
      if (str(again?.type) === "permission.asked") {
        c.note("asked again");
        await c.a.api.permissionReply(sid, str(askedOf(again ?? {}).id), {
          decision: "once",
        });
      }
      await c.idle(second);
    },
  },
  {
    name: "deny_reason",
    ask: true,
    async run(c) {
      const sid = await c.begin();
      const mark = c.a.mark();
      await c.prompt(
        sid,
        "Use your shell tool to run exactly this command: touch denied.txt . If it is rejected, say what the person told you.",
      );
      const asked = askedOf(await c.expect("permission.asked", mark));
      await c.a.api.permissionReply(sid, str(asked.id), {
        decision: "reject",
        message:
          "Do not create files here. Explain what you would have done instead.",
      });
      await c.idle(mark);
      await c.a.api.messages(sid, { limit: 200, order: "asc" });
    },
  },
  {
    name: "approve_other",
    ask: true,
    async run(c) {
      const sid = await c.begin();
      const b = c.b();
      const mark = c.a.mark();
      await c.prompt(sid, SHELL_ONCE);
      const asked = askedOf(await c.expect("permission.asked", mark));
      c.note("B answers first");
      await b.api.permissionReply(sid, str(asked.id), { decision: "once" });
      await c.a.until(typeIs("permission.replied"), mark);
      await c.idle(mark);
    },
  },
  {
    name: "approve_edit",
    ask: true,
    async run(c) {
      const sid = await c.begin();
      const mark = c.a.mark();
      await c.prompt(
        sid,
        "Create a file named hello.txt containing the single word hello. Use your edit or write tool.",
      );
      const asked = askedOf(await c.expect("permission.asked", mark));
      await c.a.api.permissionReply(sid, str(asked.id), { decision: "once" });
      await c.idle(mark);
    },
  },
  {
    name: "question_answer",
    async run(c) {
      const sid = await c.begin();
      const mark = c.a.mark();
      await c.prompt(
        sid,
        "Use the question tool to ask me one question with the header Color and the options Red and Blue. Then tell me which one I chose.",
      );
      const created = askedOf(await c.expect("form.created", mark));
      const form = rec(created.form);
      const key = str(rec(arr(form.fields)[0]).key) || "q0";
      await c.a.api.formReply(sid, str(form.id), { answer: { [key]: "Red" } });
      await c.idle(mark);
    },
  },
  {
    name: "question_dismiss",
    async run(c) {
      const sid = await c.begin();
      const mark = c.a.mark();
      await c.prompt(
        sid,
        "Use the question tool to ask me one question with the header Color and the options Red and Blue. Then tell me which one I chose.",
      );
      const created = askedOf(await c.expect("form.created", mark));
      await c.a.api.formCancel(sid, str(rec(created.form).id));
      await c.idle(mark);
    },
  },
  {
    name: "model_agent",
    async run(c) {
      const sid = await c.begin();
      const models = (await c.a.api.models()).map(rec);
      // 고른 model의 variant로 바꾼다. variant가 없으면 variant가 있는 아무 model로 바꾼다.
      const chosen = models.find(
        (one) => `${str(one.providerID)}/${str(one.modelID)}` === MODEL,
      );
      const withVariants =
        chosen !== undefined && arr(chosen.variants).length > 0
          ? chosen
          : models.find(
              (one) => one.enabled !== false && arr(one.variants).length > 0,
            );
      if (withVariants !== undefined) {
        c.note("switch model with a variant");
        const variants = arr(withVariants.variants).map((one) =>
          str(rec(one).id),
        );
        const variant = variants.at(-1) ?? "";
        await c.a.api.switchModel(sid, {
          model: {
            id: str(withVariants.modelID) || str(withVariants.id),
            providerID: str(withVariants.providerID),
            variant,
          },
        });
        await c.a.api.get(sid);
      }
      await c.a.api.agents();
      await c.a.api.switchAgent(sid, { agent: "plan" });
      await c.a.api.get(sid);
      const commands = (await c.a.api.commands()).map(rec);
      const command =
        commands.find((one) => str(one.name) === "init") ?? commands[0];
      if (command !== undefined) {
        c.note("run one server command");
        const mark = c.a.mark();
        await c.a.api.switchAgent(sid, { agent: "build" });
        await c.a.api.command(sid, { name: str(command.name), text: "" });
        await c.idle(mark);
      }
    },
  },
  {
    name: "revert_commit",
    async run(c) {
      const sid = await c.begin();
      let mark = c.a.mark();
      await c.prompt(
        sid,
        "Create a file named a.txt containing the word alpha.",
      );
      await c.idle(mark);
      mark = c.a.mark();
      await c.prompt(
        sid,
        "Create a file named b.txt containing the word beta.",
      );
      await c.idle(mark);
      const users = arr(
        rec(await c.a.api.messages(sid, { limit: 200, order: "asc" })).data,
      )
        .map(rec)
        .filter((one) => one.type === "user");
      c.note("rewind to the second message, files included");
      await c.a.api.interrupt(sid);
      await c.a.api.wait(sid);
      await c.a.api.revertStage(sid, {
        messageID: str(users[1]?.id),
        files: true,
      });
      await c.a.api.get(sid);
      c.note("commit on the next send");
      await c.a.api.revertCommit(sid);
      mark = c.a.mark();
      await c.prompt(sid, "Reply with exactly: OK.");
      await c.idle(mark);
      await c.a.api.messages(sid, { limit: 200, order: "asc" });
    },
  },
  {
    name: "revert_clear",
    async run(c) {
      const sid = await c.begin();
      let mark = c.a.mark();
      await c.prompt(
        sid,
        "Create a file named a.txt containing the word alpha.",
      );
      await c.idle(mark);
      mark = c.a.mark();
      await c.prompt(
        sid,
        "Create a file named b.txt containing the word beta.",
      );
      await c.idle(mark);
      const users = arr(
        rec(await c.a.api.messages(sid, { limit: 200, order: "asc" })).data,
      )
        .map(rec)
        .filter((one) => one.type === "user");
      await c.a.api.interrupt(sid);
      await c.a.api.wait(sid);
      await c.a.api.revertStage(sid, {
        messageID: str(users[1]?.id),
        files: false,
      });
      c.note("redo: clear the staged revert");
      await c.a.api.revertClear(sid);
      await c.a.api.get(sid);
    },
  },
  {
    name: "fork",
    async run(c) {
      const sid = await c.begin();
      let mark = c.a.mark();
      await c.prompt(sid, "Reply with exactly: ONE.");
      await c.idle(mark);
      mark = c.a.mark();
      await c.prompt(sid, "Reply with exactly: TWO.");
      await c.idle(mark);
      const users = arr(
        rec(await c.a.api.messages(sid, { limit: 200, order: "asc" })).data,
      )
        .map(rec)
        .filter((one) => one.type === "user");
      c.note("fork before the second message");
      const forked = await c.a.api.fork(sid, { before: str(users[1]?.id) });
      await c.a.api.messages(str(forked.id), { limit: 200, order: "asc" });
      c.note("fork the whole session");
      const whole = await c.a.api.fork(sid, {});
      await c.a.api.messages(str(whole.id), { limit: 200, order: "asc" });
      await c.a.api.remove(str(forked.id));
      await c.a.api.remove(str(whole.id));
    },
  },
  {
    name: "compact",
    async run(c) {
      const sid = await c.begin();
      let mark = c.a.mark();
      await c.prompt(sid, "Reply with exactly: ONE.");
      await c.idle(mark);
      mark = c.a.mark();
      await c.prompt(sid, "Reply with exactly: TWO.");
      await c.idle(mark);
      await c.a.api.context(sid);
      c.note("compact");
      mark = c.a.mark();
      await c.a.api.compact(sid);
      await c.a.until(
        typeIs("session.compaction.ended", "session.compaction.failed"),
        mark,
      );
      await c.idle(mark);
      c.note("rename");
      await c.a.api.update(sid, { title: "Renamed by recorder" });
      await c.a.api.get(sid);
      await c.a.api.context(sid);
    },
  },
  {
    name: "attach_shell",
    async run(c) {
      writeFileSync(`${c.cwd}/note.txt`, "The secret word is pineapple.\n");
      const sid = await c.begin();
      let mark = c.a.mark();
      await c.prompt(
        sid,
        "What is the secret word in the attached file? Answer with the word only.",
        { files: [{ uri: `file://${c.cwd}/note.txt`, name: "note.txt" }] },
      );
      await c.idle(mark);
      c.note("! shell");
      mark = c.a.mark();
      await c.a.api.shell(sid, { command: "echo hello-from-shell" });
      await c.a.until(typeIs("session.shell.ended"), mark);
      await c.a.api.messages(sid, { limit: 200, order: "asc" });
    },
  },
  {
    name: "subagent",
    async run(c) {
      const sid = await c.begin();
      const agents = (await c.a.api.agents()).map(rec);
      const sub =
        agents.find((one) => one.mode === "subagent") ??
        agents.find((one) => one.mode === "all");
      const mark = c.a.mark();
      await c.prompt(
        sid,
        `Use the subagent tool with agent "${str(sub?.id) || "general"}" to work out what 2+2 is, then report the answer in one sentence.`,
      );
      await c.idle(mark);
      await c.a.api.messages(sid, { limit: 200, order: "asc" });
    },
  },
  {
    name: "resume",
    async run(c) {
      const sid = await c.begin();
      const mark = c.a.mark();
      await c.prompt(
        sid,
        "Reply with exactly this sentence and nothing else: Hello from the GUI fixture.",
      );
      await c.idle(mark);
      c.note("new server process, same data");
      const second = await c.restart();
      await second.api.info();
      await second.api.get(sid);
      await second.api.messages(sid, { limit: 200, order: "asc" });
      await second.api.models();
      await second.api.agents();
      await second.api.commands();
      await second.api.context(sid);
      second.close();
    },
  },
  {
    name: "restart",
    async run(c) {
      const sid = await c.begin();
      const mark = c.a.mark();
      await c.prompt(sid, "Count from 1 to 300, one number per line, slowly.");
      await c.expect("session.text.delta", mark);
      c.note("kill the server in the middle of the turn");
      const second = await c.restart();
      const from = second.mark();
      await second.api.info();
      await second.api.get(sid);
      await second.until(
        typeIs("session.execution.started", ...END),
        from,
        60_000,
      );
      await second.api.messages(sid, { limit: 200, order: "asc" });
      await second.api.interrupt(sid);
      await second.until(typeIs(...END), from, 60_000);
      second.close();
    },
  },
];

async function runScenario(scenario: Scenario) {
  const cwd = `${ROOT}/${scenario.name}`;
  const file = `${ROOT}/${scenario.name}.jsonl`;
  rmSync(cwd, { recursive: true, force: true });
  rmSync(file, { force: true });
  mkdirSync(cwd, { recursive: true, mode: 0o700 });
  const t0 = Date.now();
  const log = (kind: string, data: unknown) =>
    appendFileSync(
      file,
      `${JSON.stringify({ t: Date.now() - t0, kind, data })}\n`,
    );
  const env: Record<string, string> =
    scenario.ask === true ? { OPENCODE_CONFIG_CONTENT: ASK_CONFIG } : {};
  let server = await startServer(cwd, env);
  const clients: Client[] = [];
  const open = (label: string) => {
    const client = connect(label, server, log);
    clients.push(client);
    return client;
  };
  const a = open("A");
  let second: Client | undefined;
  const made: string[] = [];
  const context: Context = {
    cwd,
    a,
    b: () => (second ??= open("B")),
    note: (text) => log("note", { text }),
    async begin() {
      await a.api.info();
      const settled = a.mark();
      const created = rec(await a.api.create({ location: { directory: cwd } }));
      // location은 첫 session을 만들 때 올라온다. plugin이 자리 잡기 전에는 agent와 명령 목록이 비어 있다.
      await a.until(typeIs("plugin.updated"), settled, 10_000);
      const sid = str(created.id);
      made.push(sid);
      // 기본 model(openrouter의 작은 model)은 context 오류로 turn이 실패한다. 쓸 model을 정한다.
      const slash = MODEL.indexOf("/");
      const provider = MODEL.slice(0, slash);
      const id = MODEL.slice(slash + 1);
      await a.api.switchModel(sid, { model: { providerID: provider, id } });
      await Promise.all([
        a.api.models(),
        a.api.agents(),
        a.api.commands(),
        a.api.get(sid),
        a.api.defaultModel().catch(() => undefined),
      ]);
      return sid;
    },
    async idle(from, count = 1) {
      const ended = () => a.events.slice(from).filter(typeIs(...END)).length;
      const end = Date.now() + WAIT_MS;
      while (ended() < count && Date.now() < end) await sleep(50);
      if (ended() < count)
        log("note", { text: "timed out waiting for the turn to end" });
      failed(a.events.slice(from));
      // 끝 event 뒤의 event(usage, 제목)까지 받는다.
      await sleep(300);
    },
    // `metadata`로 adapter가 쓸 표지가 그대로 돌아오는지 본다.
    prompt: (sid, text, extra = {}) =>
      a.api.prompt(sid, { text, metadata: { lophn: "msg_rec" }, ...extra }),
    async expect(type, from) {
      const found = await a.until(typeIs(type, ...END), from);
      if (found === undefined) throw new Error(`timed out waiting for ${type}`);
      if (str(found.type) === type) return rec(found);
      failed([found]);
      throw new Error(`the turn ended without ${type}`);
    },
    async restart() {
      await server.stop();
      server = await startServer(cwd, env);
      return open("A2");
    },
  };
  log("note", { text: `scenario ${scenario.name}` });
  try {
    await scenario.run(context);
  } catch (cause) {
    log("note", {
      text: `scenario failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    });
  } finally {
    // 만든 session은 사람의 OpenCode 목록에 남기지 않는다.
    // restart한 scenario는 A의 server가 이미 없어서 지금 server에 새 client로 지운다.
    const last = createApi(fetchTransport(server));
    for (const sid of made) await last.remove(sid).catch(() => undefined);
    for (const client of clients) client.close();
    await server.stop();
  }
}

const wanted = process.argv.slice(2);
const names = new Set(scenarios.map((one) => one.name));
for (const name of wanted) {
  if (!names.has(name))
    throw new Error(
      `unknown scenario ${name}. Known: ${[...names].join(", ")}`,
    );
}
mkdirSync(ROOT, { recursive: true, mode: 0o700 });
for (const scenario of scenarios) {
  if (wanted.length > 0 && !wanted.includes(scenario.name)) continue;
  console.log(`recording ${scenario.name}`);
  await runScenario(scenario);
}
