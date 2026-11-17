// Codex app-server 녹화 script. 실제 model을 부르므로 사람의 허락 아래에서만 돌린다(lead가 돈다). test는 이 file을 부르지 않는다.
//
//   LOPHN_REC_OUT=<dir> CODEX_MODEL=<model> node packages/shell/main/extensions/bundled/harness-gui/fixtures/codex/record.ts [scenario ...]
//
// scenario를 안 주면 아래 DEFAULT의 열 개를 돈다. 다른 것은 이름으로 준다.
// scenario마다 `<LOPHN_REC_OUT>/<scenario>/`(0700, 이 폴더가 thread의 cwd이고 쓰기 scratch다)에서 adapter와 같은 탭 전용
// app-server(`codex app-server --listen unix://<tmp>/codex.sock`)를 띄우고, unix socket 위 WebSocket client 둘로 몬다.
// A는 GUI(adapter), B는 TUI 대신이다. 줄은 `<LOPHN_REC_OUT>/<scenario>.jsonl`에 `{t, kind, data}`로 쓴다.
// kind: send / recv = A의 줄, send.b / recv.b = B의 줄, note = 이 script의 메모, stderr = server의 stderr.
// 영구 규칙이 되는 결정(acceptWithExecpolicyAmendment, applyNetworkPolicyAmendment)과 설정·계정 쓰기는 보내지 않는다
// (~/.codex/rules, config.toml에 남는다). 아래 guard가 막는다. 승인 요청은 기본 거절이라 sandbox 밖에는 아무것도 쓰이지 않는다.
// 환경: LOPHN_REC_OUT(출력 폴더, 꼭 필요), CODEX_MODEL(thread의 model, 꼭 필요. 가장 싼 것을 준다),
// CODEX_BIN(codex 대신 쓸 실행 파일. script 자체를 시험할 때만).
import { execFileSync, spawn } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WebSocket } from "ws";

// 터미널 탭 안에서(`!`나 Bash tool로) 돌린 녹화의 CLI가 탭의 hook env를 물려받으면 그 hook이 탭으로 가 녹화 session이
// 그 탭의 session과 recent에 들어간다.
delete process.env.LPN_TERMINAL_HOOK;

// worktree 안 .dev-data는 merge 때 지워지므로 출력 폴더를 기본값 없이 받는다.
const OUT_ENV = process.env.LOPHN_REC_OUT;
const MODEL = process.env.CODEX_MODEL;
if (OUT_ENV === undefined || OUT_ENV === "" || !MODEL) {
  console.log(
    "set LOPHN_REC_OUT (output folder) and CODEX_MODEL (cheapest model)",
  );
  process.exit(2);
}
const OUT = resolve(OUT_ENV);
const CODEX = process.env.CODEX_BIN ?? "codex";
const WAIT_MS = 120_000;

// 설정·계정·skill 쓰기와 영구 규칙 결정은 사람의 ~/.codex에 남으므로 이 script는 보내지 못한다.
const FORBIDDEN_METHODS = new Set([
  "config/value/write",
  "config/batchWrite",
  "skills/config/write",
  "experimentalFeature/enablement/set",
]);
const ACCOUNT_READS = new Set(["account/rateLimits/read", "account/read"]);
const FORBIDDEN_DECISIONS =
  /acceptWithExecpolicyAmendment|applyNetworkPolicyAmendment/;

function guard(message: unknown) {
  const line = JSON.stringify(message);
  const method = (message as { method?: string }).method;
  if (
    method !== undefined &&
    (FORBIDDEN_METHODS.has(method) ||
      (method.startsWith("account/") && !ACCOUNT_READS.has(method)))
  )
    throw new Error(`the recorder must not call ${method}`);
  if (FORBIDDEN_DECISIONS.test(line))
    throw new Error("the recorder must not send a persistent-rule decision");
}

// biome-ignore lint/suspicious/noExplicitAny: 받은 JSON-RPC 줄의 모양은 scenario가 필요한 칸만 읽는다.
type Json = any;
type Msg = { id?: number | string; method?: string } & Record<string, Json>;

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

class Rec {
  readonly started = Date.now();
  readonly file: string;
  constructor(file: string) {
    this.file = file;
    writeFileSync(file, "");
  }
  push(kind: string, data: unknown) {
    appendFileSync(
      this.file,
      `${JSON.stringify({ t: Date.now() - this.started, kind, data })}\n`,
    );
  }
  note(text: string) {
    this.push("note", text);
    console.log(`  note: ${text}`);
  }
}

class Server {
  readonly dir: string;
  readonly socket: string;
  readonly pid: number;
  readonly exited: Promise<void>;

  private constructor(
    dir: string,
    socket: string,
    pid: number,
    exited: Promise<void>,
  ) {
    this.dir = dir;
    this.socket = socket;
    this.pid = pid;
    this.exited = exited;
  }

  static start(rec: Rec, cwd: string): Server {
    // socket path는 108자를 넘으면 안 되어 짧은 tmp 폴더(mkdtemp 0700)에 둔다.
    const dir = mkdtempSync(join(tmpdir(), "lophn-rec-"));
    const socket = join(dir, "codex.sock");
    const child = spawn(CODEX, ["app-server", "--listen", `unix://${socket}`], {
      cwd,
      detached: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    child.stderr.setEncoding("utf8").on("data", (text: string) => {
      rec.push("stderr", text);
    });
    const exited = new Promise<void>((done) => {
      child.on("exit", () => done());
      child.on("error", () => done());
    });
    return new Server(dir, socket, child.pid ?? 0, exited);
  }

  async stop() {
    try {
      process.kill(-this.pid, "SIGTERM");
    } catch {
      // 이미 끝났다.
    }
    await Promise.race([this.exited, sleep(5000)]);
    rmSync(this.dir, { recursive: true, force: true });
  }
}

type Handler = (message: Msg) => Promise<Json | undefined> | Json | undefined;

class Client {
  readonly log: Msg[] = [];
  /** 받은 server 요청의 method(답을 만든 것과 안 한 것 모두). */
  readonly requests: string[] = [];
  private next: number;
  private pending = new Map<
    number | string,
    { resolve(value: Json): void; reject(cause: Error): void }
  >();
  private waiters: { test(m: Msg): boolean; resolve(m: Msg): void }[] = [];
  /** server 요청에 답을 만든다. undefined를 돌려주면 답하지 않는다(경합 scenario에서 A가 일부러 안 답한다). */
  onRequest: Handler = autoAnswer;

  private ws: WebSocket;
  private rec: Rec;
  private suffix: "" | ".b";

  private constructor(
    ws: WebSocket,
    rec: Rec,
    suffix: "" | ".b",
    start: number,
  ) {
    this.ws = ws;
    this.rec = rec;
    this.suffix = suffix;
    this.next = start;
    ws.on("message", (raw) => this.receive(JSON.parse(String(raw))));
  }

  static async connect(
    server: Server,
    rec: Rec,
    suffix: "" | ".b",
  ): Promise<Client> {
    // socket이 생길 때까지 다시 해 본다.
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const ws = await new Promise<WebSocket>((resolve, reject) => {
          const one = new WebSocket("ws://localhost/rpc", {
            createConnection: () => net.connect(server.socket),
            perMessageDeflate: false,
          });
          one.once("open", () => resolve(one));
          one.once("error", reject);
        });
        return new Client(ws, rec, suffix, suffix === "" ? 1 : 1000);
      } catch {
        await sleep(200);
      }
    }
    throw new Error("could not connect to the app-server socket");
  }

  private receive(message: Msg) {
    this.rec.push(`recv${this.suffix}`, message);
    if (message.method !== undefined && message.id !== undefined) {
      this.requests.push(message.method);
      void (async () => {
        const result = await this.onRequest(message);
        if (result === undefined) return;
        this.write(
          result.error === undefined
            ? { id: message.id, result }
            : { id: message.id, error: result.error },
        );
      })();
    } else if (message.method === undefined && message.id !== undefined) {
      const wait = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error !== undefined)
        wait?.reject(new Error(JSON.stringify(message.error)));
      else wait?.resolve(message.result);
    } else {
      this.log.push(message);
      for (const wait of [...this.waiters]) {
        if (!wait.test(message)) continue;
        this.waiters.splice(this.waiters.indexOf(wait), 1);
        wait.resolve(message);
      }
    }
  }

  private write(message: Msg) {
    guard(message);
    this.rec.push(`send${this.suffix}`, message);
    this.ws.send(JSON.stringify(message));
  }

  call(method: string, params?: Json): Promise<Json> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write(
        params === undefined ? { id, method } : { id, method, params },
      );
    });
  }

  /** 오류도 녹화에 남기고 scenario를 잇는다. */
  async attempt(
    method: string,
    params?: Json,
  ): Promise<{ result?: Json; error?: string }> {
    try {
      return { result: await this.call(method, params) };
    } catch (cause) {
      return { error: (cause as Error).message };
    }
  }

  notify(method: string, params?: Json) {
    this.write(params === undefined ? { method } : { method, params });
  }

  /** `from` 번째 이후 받은 알림 중 test에 맞는 첫 것. */
  until(test: (m: Msg) => boolean, from = 0, ms = WAIT_MS): Promise<Msg> {
    const found = this.log.slice(from).find(test);
    if (found !== undefined) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const wait = { test, resolve };
      this.waiters.push(wait);
      setTimeout(() => {
        const at = this.waiters.indexOf(wait);
        if (at < 0) return;
        this.waiters.splice(at, 1);
        reject(new Error("timed out waiting for a message"));
      }, ms);
    });
  }

  close() {
    this.ws.close();
  }
}

// 기본 답: 승인은 거절하고, 질문은 첫 선택지로 답하고, 나머지는 받지 않는다. 영구 규칙 결정은 어떤 scenario도 보내지 않는다.
function autoAnswer(message: Msg): Json {
  const params = message.params ?? {};
  switch (message.method) {
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval":
      return { decision: "decline" };
    case "item/tool/requestUserInput":
      return {
        answers: Object.fromEntries(
          (params.questions ?? []).map((q: Json) => [
            q.id,
            { answers: [q.options?.[0]?.label ?? "ok"] },
          ]),
        ),
      };
    case "mcpServer/elicitation/request":
      return { action: "decline", content: null, _meta: null };
    case "item/permissions/requestApproval":
      return { permissions: {}, scope: "turn" };
    default:
      return {
        error: { code: -32000, message: "the recorder does not handle this" },
      };
  }
}

const approve =
  (decision: "accept" | "acceptForSession" | "decline"): Handler =>
  (message) => {
    const available: Json[] | null | undefined =
      message.params?.availableDecisions;
    // 서버가 허락하지 않는 결정은 보내지 않는다.
    if (
      decision === "acceptForSession" &&
      available?.includes("acceptForSession") !== true
    )
      return { decision: "accept" };
    return { decision };
  };

type Policy = "untrusted" | "on-request";

class Scenario {
  readonly name: string;
  readonly dir: string;
  readonly rec: Rec;
  server!: Server;
  a!: Client;
  b: Client | null = null;
  thread = "";
  /** thread/start 응답. */
  opened: Json = {};
  private count = 0;

  constructor(name: string) {
    this.name = name;
    this.dir = join(OUT, name);
    rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    this.rec = new Rec(join(OUT, `${name}.jsonl`));
  }

  /** server와 A를 띄우고 initialize한다. */
  async open() {
    this.server = Server.start(this.rec, this.dir);
    this.a = await Client.connect(this.server, this.rec, "");
    await this.init(this.a);
  }

  /** TUI 대신 B를 같은 server에 붙인다. */
  async openB() {
    this.b = await Client.connect(this.server, this.rec, ".b");
    // B는 일부러 답하지 않는다. 답은 scenario가 정한다.
    this.b.onRequest = () => undefined;
    await this.init(this.b);
    return this.b;
  }

  private async init(client: Client) {
    // 알림을 하나도 빼지 않는다(adapter의 optOut 목록을 정하려면 전부 보여야 한다).
    await client.call("initialize", {
      clientInfo: { name: "lophn-rec", title: "lophn recorder", version: "0" },
      capabilities: { experimentalApi: true },
    });
    client.notify("initialized");
  }

  async start(policy: Policy, extra: Json = {}) {
    const reply = await this.a.attempt("thread/start", {
      cwd: this.dir,
      model: MODEL,
      approvalPolicy: policy,
      sandbox: "workspace-write",
      ...extra,
    });
    if (reply.result === undefined) throw new Error(reply.error);
    this.opened = reply.result;
    this.thread = reply.result.thread.id;
  }

  /** A가 turn을 시작하고 turn id를 돌려준다. */
  async send(text: string, extra: Json = {}, client: Client = this.a) {
    const reply = await client.call("turn/start", {
      threadId: this.thread,
      clientUserMessageId: `msg_${client === this.a ? "a" : "b"}${++this.count}`,
      input: [{ type: "text", text, text_elements: [] }],
      ...extra,
    });
    return reply.turn.id as string;
  }

  done(turn: string, client: Client = this.a): Promise<Msg> {
    return client.until(
      (m) => m.method === "turn/completed" && m.params?.turn?.id === turn,
    );
  }

  /** turn 하나를 끝까지 돈다. */
  async run(text: string, extra: Json = {}, client: Client = this.a) {
    const turn = await this.send(text, extra, client);
    await this.done(turn, client);
    return turn;
  }

  /** 첫 delta가 오면 돌려준다(도는 중에 steer·interrupt를 하려고). */
  async running(text: string) {
    const from = this.a.log.length;
    const turn = await this.send(text);
    await this.a.until((m) => m.method === "item/agentMessage/delta", from);
    return turn;
  }

  async close() {
    this.a?.close();
    this.b?.close();
    await this.server?.stop();
  }
}

const LONG =
  "Write the numbers from 1 to 150, one number per line, and nothing else.";
const SHELL = "Use the shell tool to run exactly this command: touch";

// 설정 알림을 기다린다. 오지 않으면 오지 않았다는 것이 녹화다.
async function seen(client: Client, test: (m: Msg) => boolean, ms = 10_000) {
  return await client.until(test, 0, ms).catch(() => null);
}

const scenarios: Record<string, (s: Scenario) => Promise<void>> = {
  // clientUserMessageId를 싣는 보통 turn. userMessage item의 clientId가 어떻게 오는지 본다.
  async text(s) {
    await s.open();
    await s.start("on-request");
    await s.run("Reply with exactly: ok");
  },

  // TUI가 아직 아무 말도 안 한 thread에 붙을 수 있는지(thread/resume이 되는지), B가 보낸 메시지가 A에 오는지.
  async "foreign-message"(s) {
    await s.open();
    await s.start("on-request");
    const b = await s.openB();
    const early = await b.attempt("thread/resume", { threadId: s.thread });
    if (early.error !== undefined) {
      s.rec.note(`resume of an empty thread failed: ${early.error}`);
      await s.run("Reply with exactly: ok");
      await b.attempt("thread/resume", { threadId: s.thread });
    }
    await s.run("Reply with exactly: from b", {}, b);
    await s.run("Reply with exactly: from a");
  },

  // A와 B 모두 승인 요청을 받고 B가 답한다. A는 serverRequest/resolved를 받아야 한다.
  async "approval-race"(s) {
    await s.open();
    await s.start("untrusted");
    await s.run("Reply with exactly: ok");
    const b = await s.openB();
    await b.call("thread/resume", { threadId: s.thread });
    s.a.onRequest = () => undefined;
    b.onRequest = async (message) => {
      await sleep(500);
      return approve("accept")(message);
    };
    await s.run(`${SHELL} race.txt. Then reply with exactly: done`);
  },

  // 거절하면 tool이 declined로 끝나고 turn은 이어 간다.
  async decline(s) {
    await s.open();
    await s.start("untrusted");
    s.a.onRequest = approve("decline");
    await s.run(`${SHELL} declined.txt. Then reply with exactly: done`);
  },

  // acceptForSession 뒤 같은 명령을 다시 묻지 않는지(두 번째 turn에 requestApproval이 오는지).
  async "accept-session"(s) {
    await s.open();
    await s.start("untrusted");
    s.a.onRequest = approve("acceptForSession");
    await s.run(`${SHELL} session.txt. Then reply with exactly: done`);
    s.rec.note(
      "second turn runs the same command; no requestApproval below means the session cache held",
    );
    await s.run(`${SHELL} session.txt. Then reply with exactly: done`);
  },

  // patch 승인(item/fileChange/requestApproval) accept.
  async patch(s) {
    await s.open();
    await s.start("untrusted");
    s.a.onRequest = approve("accept");
    await s.run(
      "Use apply_patch to create the file note.txt containing the single line hello. Then reply with exactly: done",
    );
  },

  // model/list, thread/settings/update {model, effort}. B가 thread/settings/updated를 받는지.
  async "model-settings"(s) {
    await s.open();
    await s.start("on-request");
    await s.run("Reply with exactly: ok");
    const b = await s.openB();
    await b.call("thread/resume", { threadId: s.thread });
    const listed = await s.a.call("model/list", {});
    const models: Json[] = (listed.data ?? []).filter((m: Json) => !m.hidden);
    const other = models.find((m) => m.model !== s.opened.model) ?? models[0];
    const effort =
      other?.supportedReasoningEfforts?.[0]?.reasoningEffort ?? null;
    await s.a.attempt("thread/settings/update", {
      threadId: s.thread,
      model: other?.model,
      effort,
    });
    await seen(b, (m) => m.method === "thread/settings/updated");
    await seen(s.a, (m) => m.method === "thread/settings/updated");
  },

  // 권한 mode 바꾸기(desktop의 read-only, auto, full-access). 이 thread에서는 turn을 돌리지 않는다.
  async "permission-mode"(s) {
    await s.open();
    await s.start("on-request");
    await s.run("Reply with exactly: ok");
    const b = await s.openB();
    await b.call("thread/resume", { threadId: s.thread });
    const modes = [
      [":read-only", "on-request"],
      [":danger-full-access", "never"],
      [":workspace", "on-request"],
    ];
    for (const [permissions, approvalPolicy] of modes) {
      const from = b.log.length;
      await s.a.attempt("thread/settings/update", {
        threadId: s.thread,
        permissions,
        approvalPolicy,
        approvalsReviewer: "user",
      });
      await b
        .until((m) => m.method === "thread/settings/updated", from, 10_000)
        .catch(() => null);
    }
    // guardian 쪽도 알림이 어떻게 오는지 본다.
    await s.a.attempt("thread/settings/update", {
      threadId: s.thread,
      permissions: ":workspace",
      approvalPolicy: "on-request",
      approvalsReviewer: "guardian_subagent",
    });
    await seen(b, (m) => m.method === "thread/settings/updated");
    await s.a.attempt("thread/settings/update", {
      threadId: s.thread,
      permissions: ":workspace",
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
    });
  },

  // 읽기 호출 모음: config/read, model/list, collaborationMode/list, skills/list, permissionProfile/list.
  async config(s) {
    await s.open();
    await s.start("on-request");
    await s.a.attempt("config/read", { cwd: s.dir });
    await s.a.attempt("model/list", {});
    await s.a.attempt("model/list", { includeHidden: true });
    await s.a.attempt("collaborationMode/list", {});
    await s.a.attempt("skills/list", { cwds: [s.dir] });
    await s.a.attempt("permissionProfile/list", {});
    await s.a.attempt("thread/loaded/list", {});
  },

  // plan mode: collaborationMode/list, plan mode로 바꾸고 plan turn(turn/plan/updated, item/plan/delta).
  async plan(s) {
    await s.open();
    await s.start("on-request");
    const b = await s.openB();
    const listed = await s.a.call("collaborationMode/list", {});
    const plan = (listed.data ?? []).find((m: Json) => m.mode === "plan");
    await s.a.attempt("thread/settings/update", {
      threadId: s.thread,
      collaborationMode: {
        mode: "plan",
        settings: {
          model: s.opened.model,
          reasoning_effort: plan?.reasoning_effort ?? s.opened.reasoningEffort,
          developer_instructions: null,
        },
      },
    });
    await seen(s.a, (m) => m.method === "thread/settings/updated");
    await s.run(
      "Plan, in two short steps, how you would create a file named hello.txt. Do not run anything.",
    );
    // B가 늦게 붙어도 되는지 보려고 plan 뒤에 resume한다.
    await b.attempt("thread/resume", { threadId: s.thread });
    // TUI의 "Implement this plan?" 대신: default mode로 돌리고 같은 thread에서 구현 메시지를 보낸다.
    // 승인 요청은 기본 거절이다. 구현은 scratch cwd 안의 file 하나다.
    const fromBack = s.a.log.length;
    const normal = (listed.data ?? []).find((m: Json) => m.mode === "default");
    await s.a.attempt("thread/settings/update", {
      threadId: s.thread,
      collaborationMode: {
        mode: "default",
        settings: {
          model: s.opened.model,
          reasoning_effort:
            normal?.reasoning_effort ?? s.opened.reasoningEffort,
          developer_instructions: null,
        },
      },
    });
    await s.a
      .until((m) => m.method === "thread/settings/updated", fromBack, 10_000)
      .catch(() =>
        s.rec.note("no thread/settings/updated after leaving plan mode"),
      );
    await s.run("Implement the plan.");
  },

  // item/tool/requestUserInput 질문과 답(plan mode에서 질문 도구가 켜진다).
  async question(s) {
    await s.open();
    await s.start("on-request");
    const listed = await s.a.call("collaborationMode/list", {});
    const plan = (listed.data ?? []).find((m: Json) => m.mode === "plan");
    await s.a.attempt("thread/settings/update", {
      threadId: s.thread,
      collaborationMode: {
        mode: "plan",
        settings: {
          model: s.opened.model,
          reasoning_effort: plan?.reasoning_effort ?? s.opened.reasoningEffort,
          developer_instructions: null,
        },
      },
    });
    await seen(s.a, (m) => m.method === "thread/settings/updated");
    await s.run(
      "Use the request_user_input tool to ask me one question, my favorite color, with the options Red and Blue. Then reply with the color I chose.",
    );
  },

  // thread/revert 뒤 새 turn(데스크톱의 마지막 메시지 고치기).
  async revert(s) {
    await s.open();
    await s.start("on-request");
    const b = await s.openB();
    await s.run("Reply with exactly: first");
    await b.attempt("thread/resume", { threadId: s.thread });
    const second = await s.run("Reply with exactly: second");
    const from = b.log.length;
    await s.a.attempt("thread/revert", {
      threadId: s.thread,
      beforeTurnId: second,
    });
    await b
      .until((m) => m.method === "thread/reverted", from, 10_000)
      .catch(() => null);
    await s.a.attempt("thread/turns/list", {
      threadId: s.thread,
      sortDirection: "asc",
      itemsView: "full",
    });
    await s.run("Reply with exactly: third");
  },

  // thread/fork. 새 thread에 resume 없이 turn을 돌려 fork 응답이 구독까지 하는지 본다.
  async fork(s) {
    await s.open();
    await s.start("on-request");
    const first = await s.run("Reply with exactly: first");
    await s.run("Reply with exactly: second");
    const before = await s.a.attempt("thread/fork", {
      threadId: s.thread,
      beforeTurnId: first,
      excludeTurns: true,
    });
    s.rec.note(`fork beforeTurnId: ${before.error ?? "ok"}`);
    const forked = await s.a.attempt("thread/fork", {
      threadId: s.thread,
      lastTurnId: first,
      excludeTurns: true,
    });
    if (forked.result === undefined) return;
    const child = forked.result.thread.id as string;
    s.rec.note("turn on the fork without thread/resume first");
    const reply = await s.a.call("turn/start", {
      threadId: child,
      input: [
        { type: "text", text: "Reply with exactly: forked", text_elements: [] },
      ],
    });
    await s.a.until(
      (m) =>
        m.method === "turn/completed" && m.params?.turn?.id === reply.turn.id,
    );
    await s.a.attempt("thread/resume", { threadId: child, excludeTurns: true });
    await s.a.attempt("thread/turns/list", {
      threadId: child,
      sortDirection: "asc",
      itemsView: "full",
    });
  },

  // thread/compact/start. 알림과 thread/tokenUsage/updated.
  async compact(s) {
    await s.open();
    await s.start("on-request");
    await s.run("Reply with exactly: first");
    await s.run("Reply with exactly: second");
    const from = s.a.log.length;
    await s.a.attempt("thread/compact/start", { threadId: s.thread });
    await s.a
      .until(
        (m) =>
          m.method === "item/completed" &&
          m.params?.item?.type === "contextCompaction",
        from,
        60_000,
      )
      .catch(() => null);
    await sleep(1000);
  },

  // thread/name/set과 thread/name/updated.
  async rename(s) {
    await s.open();
    await s.start("on-request");
    await s.run("Reply with exactly: ok");
    const b = await s.openB();
    await b.call("thread/resume", { threadId: s.thread });
    await s.a.attempt("thread/name/set", {
      threadId: s.thread,
      name: "recorded name",
    });
    await seen(b, (m) => m.method === "thread/name/updated");
    await seen(s.a, (m) => m.method === "thread/name/updated");
  },

  // 도는 turn에 turn/steer.
  async steer(s) {
    await s.open();
    await s.start("on-request");
    const turn = await s.running(LONG);
    await s.a.attempt("turn/steer", {
      threadId: s.thread,
      expectedTurnId: turn,
      clientUserMessageId: "msg_steer",
      input: [
        {
          type: "text",
          text: "Also add the final line: steered",
          text_elements: [],
        },
      ],
    });
    await s.done(turn);
  },

  // turn/interrupt.
  async interrupt(s) {
    await s.open();
    await s.start("on-request");
    const turn = await s.running(LONG);
    await s.a.attempt("turn/interrupt", { threadId: s.thread, turnId: turn });
    await s.done(turn);
  },

  // 새 process의 excludeTurns resume과 thread/turns/list(처음 넘김과 같은 길).
  async resume(s) {
    await s.open();
    await s.start("on-request");
    await s.run("Reply with exactly: first");
    await s.run("Reply with exactly: second");
    s.a.close();
    await s.server.stop();
    s.rec.note("server restarted; the thread is not loaded");
    await s.open();
    await s.a.attempt("thread/loaded/list", {});
    const reply = await s.a.attempt("thread/resume", {
      threadId: s.thread,
      excludeTurns: true,
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
    });
    if (reply.result === undefined) return;
    await s.a.attempt("thread/turns/list", {
      threadId: s.thread,
      sortDirection: "asc",
      itemsView: "full",
      limit: 20,
    });
    await s.run("Reply with exactly: third");
  },

  // TUI가 아직 아무 말도 안 한 thread에 B가 붙는다. model은 부르지 않는다.
  async "attach-empty"(s) {
    await s.open();
    await s.start("on-request");
    const b = await s.openB();
    await b.attempt("thread/resume", { threadId: s.thread });
    await b.attempt("thread/loaded/list", {});
    await s.a.attempt("thread/loaded/list", {});
  },

  // file chip: UserInput mention.
  async mention(s) {
    await s.open();
    await s.start("on-request");
    const file = join(s.dir, "hello.txt");
    writeFileSync(file, "pineapple\n");
    await s.run(
      "What is the word in the mentioned file? Answer with just that word.",
      {
        input: [
          {
            type: "text",
            text: "What is the word in the mentioned file? Answer with just that word.",
            text_elements: [],
          },
          { type: "mention", name: "hello.txt", path: file },
        ],
      },
    );
  },

  // review/start {uncommittedChanges}. 끝에 exitedReviewMode.review 글이 오는지. review model도 싼 것으로 못 박는다.
  async review(s) {
    await s.open();
    await s.start("on-request", { config: { review_model: MODEL } });
    const git = (...args: string[]) =>
      execFileSync(
        "git",
        ["-c", "user.name=rec", "-c", "user.email=rec@example.com", ...args],
        { cwd: s.dir, stdio: "ignore" },
      );
    git("init", "-q");
    writeFileSync(
      join(s.dir, "sum.js"),
      "export const sum = (a, b) => a + b;\n",
    );
    git("add", ".");
    git("commit", "-q", "-m", "first");
    writeFileSync(
      join(s.dir, "sum.js"),
      "export const sum = (a, b) => a - b;\n",
    );
    const from = s.a.log.length;
    const reply = await s.a.call("review/start", {
      threadId: s.thread,
      target: { type: "uncommittedChanges" },
    });
    await s.done(reply.turn.id);
    s.rec.note(
      `review turn ${reply.turn.id}, notifications after start: ${s.a.log.length - from}`,
    );
  },

  // thread/goal/set(active, 작은 tokenBudget) → updated, get, paused, clear → cleared. goal이 turn을 스스로 시작하면 끊는다.
  async goal(s) {
    await s.open();
    await s.start("on-request");
    const from = s.a.log.length;
    await s.a.attempt("thread/goal/set", {
      threadId: s.thread,
      origin: "user",
      objective: "Reply with exactly: ok. Then mark the goal complete.",
      status: "active",
      tokenBudget: 5000,
    });
    await seen(s.a, (m) => m.method === "thread/goal/updated");
    const turn = await s.a
      .until((m) => m.method === "turn/started", from, 20_000)
      .catch(() => null);
    if (turn === null) s.rec.note("setting a goal started no turn");
    else {
      s.rec.note("the goal started a turn on its own; interrupting it");
      await s.a.attempt("turn/interrupt", {
        threadId: s.thread,
        turnId: turn.params.turn.id,
      });
      await s.done(turn.params.turn.id);
    }
    await s.a.attempt("thread/goal/get", { threadId: s.thread });
    await s.a.attempt("thread/goal/set", {
      threadId: s.thread,
      origin: "user",
      status: "paused",
    });
    await s.a.attempt("thread/goal/get", { threadId: s.thread });
    const fromClear = s.a.log.length;
    await s.a.attempt("thread/goal/clear", { threadId: s.thread });
    await s.a
      .until((m) => m.method === "thread/goal/cleared", fromClear, 10_000)
      .catch(() => s.rec.note("no thread/goal/cleared after clear"));
    await s.a.attempt("thread/goal/get", { threadId: s.thread });
  },

  // collab: 자식 하나를 spawn → 자식 thread 이벤트가 A에 오는지, 자식 turn에 steer·interrupt·turn/start → wait → close.
  async collab(s) {
    await s.open();
    await s.start("on-request");
    const turn = await s.send(
      "Spawn one sub-agent with your spawn_agent tool. Its task: write the numbers 1 to 150, one per line, and nothing else. Do not wait for it. Reply with exactly: spawned",
    );
    const started = await seen(
      s.a,
      (m) => m.method === "turn/started" && m.params?.threadId !== s.thread,
      90_000,
    );
    if (started === null) {
      s.rec.note("no turn/started from a child thread reached A");
    } else {
      const child = started.params.threadId as string;
      const childTurn = started.params.turn.id as string;
      s.rec.note(`child thread ${child}, turn ${childTurn}`);
      await s.a.attempt("turn/steer", {
        threadId: child,
        expectedTurnId: childTurn,
        input: [
          {
            type: "text",
            text: "Also add the final line: steered",
            text_elements: [],
          },
        ],
      });
      await sleep(2000);
      await s.a.attempt("turn/interrupt", {
        threadId: child,
        turnId: childTurn,
      });
      await seen(
        s.a,
        (m) =>
          m.method === "turn/completed" &&
          m.params?.threadId === child &&
          m.params?.turn?.id === childTurn,
        30_000,
      );
      const again = await s.a.attempt("turn/start", {
        threadId: child,
        input: [
          {
            type: "text",
            text: "Reply with exactly: again",
            text_elements: [],
          },
        ],
      });
      if (again.result !== undefined)
        await seen(
          s.a,
          (m) =>
            m.method === "turn/completed" &&
            m.params?.threadId === child &&
            m.params?.turn?.id === again.result.turn.id,
          60_000,
        );
    }
    await s.done(turn);
    await s.run(
      "If a sub-agent exists, wait for it with your wait_agent tool, then close it with your close_agent tool. Then reply with exactly: closed",
    );
  },

  // account/rateLimits/read, 그리고 turn 뒤 account/rateLimits/updated가 오는지.
  async rate_limits(s) {
    await s.open();
    await s.start("on-request");
    await s.a.attempt("account/rateLimits/read");
    await s.run("Reply with exactly: ok");
    await sleep(2000);
    await s.a.attempt("account/rateLimits/read");
  },

  // background terminal 하나 → thread/backgroundTerminals/list → terminate → clean.
  async background(s) {
    await s.open();
    await s.start("on-request");
    await s.run(
      "Use the shell tool to run `sleep 240` as a background process: set yield_time_ms to 1000 so the tool returns while the command keeps running. Do not wait for it. Reply with exactly: started",
    );
    const list = () =>
      s.a.attempt("thread/backgroundTerminals/list", { threadId: s.thread });
    const first = (await list()).result?.data?.[0];
    if (first === undefined) s.rec.note("no background terminal was listed");
    else {
      await s.a.attempt("thread/backgroundTerminals/terminate", {
        threadId: s.thread,
        processId: first.processId,
      });
      await sleep(1000);
      await list();
    }
    await s.a.attempt("thread/backgroundTerminals/clean", {
      threadId: s.thread,
    });
    await sleep(1000);
    await list();
  },

  // mcpServerStatus/list. model을 부르지 않는다. 사람의 MCP server 이름이 들어오므로 scrub한다.
  async mcp_status(s) {
    await s.open();
    await s.start("on-request");
    await s.a.attempt("mcpServerStatus/list", {});
    await s.a.attempt("mcpServerStatus/list", {
      threadId: s.thread,
      detail: "toolsAndAuthOnly",
    });
  },

  // 두 turn(우리가 clientUserMessageId를 줌) → 새 process에서 thread/resume과 thread/turns/list.
  // userMessage의 clientId와 item id가 처음과 같은지 본다.
  async origin(s) {
    await s.open();
    await s.start("on-request");
    await s.run("Reply with exactly: first");
    await s.run("Reply with exactly: second");
    s.a.close();
    await s.server.stop();
    s.rec.note("server restarted; the thread is not loaded");
    await s.open();
    await s.a.attempt("thread/turns/list", {
      threadId: s.thread,
      sortDirection: "asc",
      itemsView: "full",
      limit: 20,
    });
    await s.a.attempt("thread/resume", {
      threadId: s.thread,
      excludeTurns: true,
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
    });
    await s.a.attempt("thread/turns/list", {
      threadId: s.thread,
      sortDirection: "asc",
      itemsView: "full",
      limit: 20,
    });
  },

  // item/permissions/requestApproval이 오는지. request_permissions tool은 기본으로 꺼져 있어 thread config로만 켠다.
  // 안 오면 sandbox 밖 쓰기 승인으로 넘어간다. 답은 전부 거절(빈 권한)이다.
  async permissions(s) {
    await s.open();
    await s.start("on-request", {
      config: { "features.request_permissions_tool": true },
    });
    await s.run(
      "Call your request_permissions tool to ask for write access to the folder /var/tmp/lophn-rec-outside with the reason: recording. Then reply with exactly: done",
    );
    if (!s.a.requests.includes("item/permissions/requestApproval")) {
      s.rec.note(
        "no item/permissions/requestApproval arrived; trying a write outside the sandbox",
      );
      await s.run(
        "Use the shell tool, with escalated permissions if the sandbox blocks it, to run exactly: touch /var/tmp/lophn-rec-outside.txt. Then reply with exactly: done",
      );
    }
    s.rec.note(
      `server requests seen: ${[...new Set(s.a.requests)].join(", ") || "none"}`,
    );
  },

  // web search item. 사람의 web_search 설정이 꺼져 있으면 검색 없이 끝난다.
  async websearch(s) {
    await s.open();
    try {
      await s.start("on-request", { config: { web_search: "live" } });
    } catch (cause) {
      s.rec.note(`config override refused: ${(cause as Error).message}`);
      await s.start("on-request");
    }
    await s.run(
      "Search the web for the latest stable Node.js release and answer in one short line.",
    );
  },

  // thread/shellCommand: turn이 없을 때(app-server가 제 turn을 연다)와 도는 turn 중(그 turn에 붙는다). 끝난 뒤 history에
  // userShell item이 어떻게 남는지(thread/turns/list). model을 부르는 것은 도는 turn 하나뿐이다.
  async shell(s) {
    await s.open();
    await s.start("on-request");
    const from = s.a.log.length;
    await s.a.attempt("thread/shellCommand", {
      threadId: s.thread,
      command: "ls",
    });
    await s.a.until((m) => m.method === "turn/completed", from);
    const turn = await s.running(LONG);
    await s.a.attempt("thread/shellCommand", {
      threadId: s.thread,
      command: "echo hi",
    });
    await s.done(turn);
    await s.a.attempt("thread/turns/list", {
      threadId: s.thread,
      sortDirection: "asc",
      itemsView: "full",
      limit: 50,
    });
  },

  // service tier: model/list의 serviceTiers(scrub 전 원본), thread/settings/update {serviceTier: "priority"} 뒤
  // thread/settings/updated, 짧은 turn 하나, 새 process에서 thread/resume의 serviceTier(resume 뒤 남는지).
  async speed(s) {
    await s.open();
    await s.start("on-request");
    await s.a.call("model/list", {});
    const from = s.a.log.length;
    await s.a.attempt("thread/settings/update", {
      threadId: s.thread,
      serviceTier: "priority",
    });
    await s.a
      .until((m) => m.method === "thread/settings/updated", from, 10_000)
      .catch(() => {});
    await s.run("Reply with exactly: ok");
    s.a.close();
    await s.server.stop();
    await s.open();
    const resumed = await s.a.attempt("thread/resume", {
      threadId: s.thread,
      cwd: s.dir,
      excludeTurns: true,
    });
    s.rec.note(
      `serviceTier after resume: ${JSON.stringify(resumed.result?.serviceTier)}`,
    );
  },

  // thread/list: resume 목록. model을 부르지 않는다.
  async list(s) {
    await s.open();
    await s.a.call("thread/list", {
      cwd: s.dir,
      sortKey: "updated_at",
      limit: 5,
    });
    await s.start("on-request");
    await s.a.call("thread/list", {
      cwd: s.dir,
      sortKey: "updated_at",
      limit: 5,
    });
  },
};

const DEFAULT = [
  "review",
  "compact",
  "goal",
  "plan",
  "collab",
  "rate_limits",
  "background",
  "mcp_status",
  "origin",
  "permissions",
];

async function main() {
  mkdirSync(OUT, { recursive: true, mode: 0o700 });
  const wanted = process.argv.slice(2);
  const names = wanted.length === 0 ? DEFAULT : wanted;
  for (const name of names) {
    const run = scenarios[name];
    if (run === undefined) {
      console.log(`unknown scenario: ${name}`);
      continue;
    }
    console.log(`scenario ${name}`);
    const s = new Scenario(name);
    try {
      await run(s);
      console.log("  done");
    } catch (cause) {
      s.rec.note(`scenario stopped: ${(cause as Error).message}`);
    } finally {
      await s.close();
    }
  }
}

await main();
process.exit(0);
