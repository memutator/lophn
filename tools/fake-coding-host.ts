// 실제 desktop(shell main) 대신 개발 core의 `/host-link`에 붙는 가짜 host다. 폰과 core의 coding session 개발에 쓴다.
// 실행: node tools/fake-coding-host.ts [--project prj_…]  (먼저 `npm run dev:core`가 떠 있어야 한다. Ctrl+C로 끝낸다)
// 개발 core(.dev-data)에 사람 자격으로 붙어 coding session 둘을 올린다: chat(GUI)으로 도는 Claude Code(도는 turn과 승인 card)와
// 터미널(TUI)로 도는 Codex. `coding_input`을 받으면 `send`는 사람 말 하나를 더하고 `decide`는 card를 닫는다. `coding_switch`를
// 받으면 view를 바꿔 다시 올린다. 그 밖의 요청(탭, tool, browser)은 `unavailable`로 답한다. project를 주지 않으면 첫 project다.
import { join } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { cliDial } from "../packages/cli/connection/client/node.ts";
import {
  type AcpInput,
  type AcpState,
  type AcpUpdate,
  acpInputSchema,
  EMPTY_ACP_STATE,
  reduceAcp,
} from "../packages/protocol/acp/mod.ts";
import {
  CONTROL_REQUEST_TIMEOUT_MS,
  controlConnect,
  createRpcClient,
} from "../packages/protocol/client/mod.ts";
import {
  type CoreFrame,
  HOST_LINK_PATH,
  HOST_LINK_SUBPROTOCOL,
  type HostFrame,
  hostFrameSchema,
} from "../packages/protocol/host-link/mod.ts";
import type { HostToolOutput } from "../packages/protocol/lophn-agent/host-queue.ts";
import type { TerminalSessionReport } from "../packages/protocol/lophn-agent/session-lifecycle.ts";
import { guiSessionId } from "../packages/protocol/lophn-agent/session-tag.ts";
import { projectApi } from "../packages/protocol/projects/project-api.ts";

const AT = () => new Date().toISOString();
const ULID = (char: string) => `01${char.repeat(24)}`;

type Fake = {
  report: TerminalSessionReport;
  // GUI view일 때의 ACP 상태. TUI면 null이다.
  state: AcpState | null;
};

function claudeState(): AcpState {
  const turn = `trn_${ULID("c")}`;
  const at = AT();
  return {
    ...EMPTY_ACP_STATE,
    seq: 2,
    items: [
      {
        kind: "message",
        id: "m1",
        seq: 1,
        at,
        actor: "user",
        sender: null,
        call: null,
        reply_to: null,
        delivery: "next_turn",
        turn,
        origin: null,
        content: [
          { type: "text", text: "Rename the config loader and fix its tests." },
        ],
        reasoning: null,
        cards: [],
        complete: true,
      },
      {
        kind: "tool",
        id: "t1",
        seq: 2,
        at,
        by: "agent",
        turn,
        tool: "file.read",
        category: "read",
        title: "Read src/config.ts",
        state: "ok",
        duration_ms: 12,
        detail: { kind: "generic" },
        body: {
          input: "src/config.ts",
          output: "export function load() {}",
          truncated: false,
        },
      },
    ],
    turn: { id: turn, phase: "waiting", started_at: at, elapsed: null },
    pending: {
      approval: {
        id: `apr_${ULID("a")}`,
        subject: {
          kind: "file_change",
          changes: [
            { path: "src/config.ts", change: "update", added: 3, removed: 1 },
          ],
        },
        choices: ["once", "session", "reject"],
        always_patterns: [],
      },
      question: null,
    },
    session: null,
  } as AcpState;
}

function plainState(): AcpState {
  return { ...EMPTY_ACP_STATE };
}

function cannedSessions(project: string): Fake[] {
  return [
    {
      report: {
        terminal_ref: `trm_${ULID("c")}`,
        project: project as never,
        harness: "claude",
        state: "waiting",
        cli_session: "fake-claude-session",
        title: "Rename the config loader",
        cwd: null,
        shell_pid: null,
        view: "gui",
        handoff: "restart",
        foreground: false,
      },
      state: claudeState(),
    },
    {
      report: {
        terminal_ref: `trm_${ULID("d")}`,
        project: project as never,
        harness: "codex",
        state: "idle",
        cli_session: "fake-codex-session",
        title: "Codex in the terminal",
        cwd: null,
        shell_pid: null,
        view: "tui",
        handoff: "shared",
        foreground: true,
      },
      state: null,
    },
  ];
}
const sessionOf = (fake: Fake) => guiSessionId(fake.report.terminal_ref);

// 가짜 host 하나. `send`로 frame을 올리고 core의 `request` frame을 `request`로 받는다. 연결과 상관없어 core 없이도 돌려 볼 수 있다.
export function fakeCodingHost(
  project: string,
  send: (frame: HostFrame) => void,
) {
  const fakes = cannedSessions(project);

  function report() {
    send({ type: "coding_report", sessions: fakes.map((fake) => fake.report) });
  }

  function snapshot(fake: Fake) {
    if (fake.state === null) return;
    send({
      type: "coding_sync",
      session: sessionOf(fake),
      snapshot: fake.state,
    });
  }

  function apply(fake: Fake, updates: AcpUpdate[]) {
    if (fake.state === null) return;
    for (const update of updates) fake.state = reduceAcp(fake.state, update);
    send({ type: "coding_sync", session: sessionOf(fake), updates });
  }

  const done = (content: string): HostToolOutput => ({
    content: [{ type: "text", text: content }],
  });
  const failed = (
    code: "not_found" | "conflict" | "unavailable" | "invalid_input",
    message: string,
  ): HostToolOutput => ({
    error: { code, message },
  });

  function input(raw: unknown): HostToolOutput {
    const parsed = acpInputSchema.safeParse(raw);
    if (!parsed.success) return failed("invalid_input", "invalid ACP input");
    const value: AcpInput = parsed.data;
    const fake = fakes.find((one) => sessionOf(one) === value.session);
    if (fake?.state === undefined || fake.state === null) {
      return failed("not_found", "no GUI handle for this session");
    }
    const seq = fake.state.seq + 1;
    if (value.type === "send") {
      apply(fake, [
        {
          type: "message_added",
          item: {
            kind: "message",
            id: value.id,
            seq,
            at: AT(),
            actor: "user",
            sender: null,
            call: null,
            reply_to: null,
            delivery: value.delivery,
            turn: null,
            origin: null,
            content: value.content,
            reasoning: null,
            cards: [],
            complete: true,
          },
        },
      ]);
    } else if (value.type === "decide") {
      const choice = value.choice;
      apply(fake, [
        {
          type: "approval_closed",
          request: value.request,
          outcome: choice.kind === "reject" ? "denied" : "allowed",
          choice:
            choice.kind === "once" ||
            choice.kind === "session" ||
            choice.kind === "always"
              ? choice.kind
              : null,
          reason: choice.kind === "reject" ? (choice.reason ?? null) : null,
          mode: choice.kind === "mode" ? choice.mode : null,
          seq,
          at: AT(),
        },
      ]);
    }
    console.log(`fake-coding-host: ${value.type} on ${value.session}`);
    return done("ok");
  }

  function switchView(terminalRef: string, to: "gui" | "tui"): HostToolOutput {
    const fake = fakes.find((one) => one.report.terminal_ref === terminalRef);
    if (fake === undefined) return failed("not_found", "no such terminal");
    if (fake.report.view === to) return failed("conflict", `already ${to}`);
    fake.report = { ...fake.report, view: to, foreground: to === "tui" };
    if (to === "gui") {
      fake.state = plainState();
      snapshot(fake);
    } else {
      fake.state = null;
      send({ type: "coding_closed", session: sessionOf(fake) });
    }
    report();
    console.log(`fake-coding-host: ${terminalRef} switched to ${to}`);
    return done("ok");
  }

  function answer(request: CoreFrame): HostToolOutput {
    switch (request.kind) {
      case "coding_input":
        return input(request.payload.input);
      case "coding_switch":
        return switchView(request.payload.terminal_ref, request.payload.to);
      default:
        return failed("unavailable", `fake host does not do ${request.kind}`);
    }
  }

  return {
    sessions: () =>
      fakes.map((fake) => ({ session: sessionOf(fake), ...fake.report })),
    // 연결이 열렸다. 연결을 열 때마다 처음부터 다시 보낸다.
    open() {
      send({ type: "hello", version: 1, workspaces: [], tui: [] });
      report();
      for (const fake of fakes) snapshot(fake);
    },
    request(request: CoreFrame) {
      send({
        type: "response",
        id: request.id,
        result: "done",
        output: answer(request),
      });
    },
  };
}

async function main() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const { values } = parseArgs({ options: { project: { type: "string" } } });

  const dial = cliDial({
    dataRoot: join(root, ".dev-data"),
    platform: process.platform,
    xdgRuntimeDir: process.env.XDG_RUNTIME_DIR,
  });
  if (!dial.ok) fail(dial.error.message);
  const connected = await controlConnect(
    { dial: dial.value, timeoutMs: CONTROL_REQUEST_TIMEOUT_MS },
    "cli",
  );
  if (!connected.ok) {
    fail(
      `개발 core에 붙지 못했다(${connected.error.code}). 먼저 \`npm run dev:core\`를 띄운다.`,
    );
  }
  const { api_url: apiUrl, user_token: token } = connected.value;

  async function firstProject(): Promise<string> {
    const core = createRpcClient({
      baseUrl: apiUrl,
      token,
      fetch: async (input, init) => {
        const response = await fetch(input, init);
        return {
          status: response.status,
          headers: response.headers,
          bytes: new Uint8Array(await response.arrayBuffer()),
        };
      },
    });
    const listed = await core.call(projectApi.list, {});
    if (!listed.ok) fail(`project를 읽지 못했다: ${listed.error.message}`);
    const found = listed.value.projects[0];
    if (found === undefined) {
      fail("project가 없다. 개발 desktop에서 하나 만들거나 --project를 준다.");
    }
    return found.id;
  }
  const project = values.project ?? (await firstProject());

  const socket = new WebSocket(
    apiUrl.replace(/^http/, "ws").replace(/\/$/, "") + HOST_LINK_PATH,
    HOST_LINK_SUBPROTOCOL,
    { headers: { authorization: `Bearer ${token}` } },
  );
  const host = fakeCodingHost(project, (frame) =>
    // 틀린 frame은 core가 연결을 닫는다. 보내기 전에 같은 schema로 본다.
    socket.send(JSON.stringify(hostFrameSchema.parse(frame))),
  );
  socket.on("open", () => {
    host.open();
    console.log(
      `fake-coding-host: attached to ${apiUrl} with coding sessions in ${project}:`,
    );
    for (const one of host.sessions()) {
      console.log(`  ${one.session} ${one.harness} (${one.view})`);
    }
  });
  socket.on("message", (data) =>
    host.request(JSON.parse(String(data)) as CoreFrame),
  );
  socket.on("close", (code) => {
    console.log(`fake-coding-host: closed (${code})`);
    process.exit(code === 1000 || code === 1001 ? 0 : 1);
  });
  socket.on("error", (error) => fail(error.message));
  process.on("SIGINT", () => socket.close(1000));
}

function fail(message: string): never {
  console.error(`fake-coding-host: ${message}`);
  process.exit(1);
}

if (import.meta.main) await main();
