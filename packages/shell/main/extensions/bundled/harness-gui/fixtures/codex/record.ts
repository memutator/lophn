// Codex app-server 녹화 script. 실제 model을 부르므로 사람의 허락 아래에서만 돌린다(lead가 돈다). test는 이 file을 부르지 않는다.
//
//   node packages/shell/main/extensions/bundled/harness-gui/fixtures/codex/record.ts [scenario ...]
//
// scenario마다 `.dev-data/adapter-codex/rec/<scenario>/`(0700, 이 폴더가 thread의 cwd)에서 adapter와 같은 탭 전용
// app-server(`codex app-server --listen unix://<tmp>/codex.sock`)를 띄우고, unix socket 위 WebSocket client 둘로 몬다.
// A는 GUI(adapter), B는 TUI 대신이다. 줄은 `.dev-data/adapter-codex/rec/<scenario>.jsonl`에 `{t, kind, data}`로 쓴다.
// kind: send / recv = A의 줄, send.b / recv.b = B의 줄, note = 이 script의 메모, stderr = server의 stderr.
// 영구 규칙이 되는 결정(acceptWithExecpolicyAmendment, applyNetworkPolicyAmendment)은 보내지 않는다(~/.codex/rules에 남는다).
// 환경: LOPHN_REC_OUT(출력 폴더), CODEX_BIN(codex 대신 쓸 실행 파일. script 자체를 시험할 때만).
import { spawn } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";

const OUT = process.env.LOPHN_REC_OUT ?? ".dev-data/adapter-codex/rec";
const CODEX = process.env.CODEX_BIN ?? "codex";
const WAIT_MS = 120_000;

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
          model: plan?.model ?? s.opened.model,
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
          model: plan?.model ?? s.opened.model,
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

  // `!` shell: thread/shellCommand. turn이 생기는지, 어떤 item이 오는지.
  async shell(s) {
    await s.open();
    await s.start("on-request");
    const from = s.a.log.length;
    await s.a.attempt("thread/shellCommand", {
      threadId: s.thread,
      command: "echo shell-ok",
    });
    await s.a
      .until((m) => m.method === "turn/completed", from, 30_000)
      .catch(() => s.rec.note("no turn/completed after thread/shellCommand"));
    await sleep(1000);
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
};

async function main() {
  mkdirSync(OUT, { recursive: true, mode: 0o700 });
  const wanted = process.argv.slice(2);
  const names = wanted.length === 0 ? Object.keys(scenarios) : wanted;
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
