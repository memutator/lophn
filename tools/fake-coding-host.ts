// 실제 desktop(shell main) 대신 개발 core의 `/host-link`에 붙는 가짜 host다. 폰과 core의 coding session 개발에 쓴다.
// 실행: node tools/fake-coding-host.ts [--project prj_…]  (먼저 `npm run dev:core`가 떠 있어야 한다. Ctrl+C로 끝낸다)
// 개발 core(.dev-data)에 사람 자격으로 붙어 coding session 둘을 올린다: chat(GUI)으로 도는 Claude Code(도는 turn과 승인 card)와
// 터미널(TUI)로 도는 Codex. `coding_input`을 받으면 `send`는 사람 말 하나를 더하고 `decide`는 card를 닫는다. `coding_switch`를
// 받으면 view를 바꿔 다시 올린다. `coding_open`을 받으면 그 harness의 빈 GUI session 하나를 새 터미널로 더해 올리고 그 터미널로
// 답한다. `terminal_stream`을 받으면 그 터미널의 canned 화면(색 있는 줄 몇 개와 입력 줄)을 올리고,
// `terminal_input`을 받으면 그 글을 입력 줄에 더해 다시 올린다. 그 밖의 요청(탭, tool, browser)은 `unavailable`로 답한다.
// project를 주지 않으면 첫 project다.
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
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
  type TerminalLine,
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

const SCREEN_COLUMNS = 80;
const SCREEN_ROWS = 8;
const SCROLLBACK: TerminalLine[] = [1, 2, 3].map((n) => ({
  runs: [{ text: `$ make step-${n}`, fg: "p8" }],
  wrapped: false,
}));
const BLANK: TerminalLine = { runs: [], wrapped: false };

// 제어 글자는 `^C`처럼 보이게 한다. 화면에 그대로 두면 줄이 깨진다.
const visible = (text: string) =>
  [...text]
    .map((char) => {
      const code = char.codePointAt(0)!;
      if (code === 0x7f) return "^?";
      return code < 0x20 ? `^${String.fromCharCode(code + 64)}` : char;
    })
    .join("");

type FakeTerminal = { typed: string; seq: number; tail: number | null };

// 가짜 host 하나. `send`로 frame을 올리고 core의 `request` frame을 `request`로 받는다. 연결과 상관없어 core 없이도 돌려 볼 수 있다.
export function fakeCodingHost(
  project: string,
  send: (frame: HostFrame) => void,
) {
  const fakes = cannedSessions(project);
  // 터미널마다 폰이 친 글과 화면 seq. tail이 null이면 보는 폰이 없다.
  const terminals = new Map<string, FakeTerminal>(
    fakes.map((fake) => [
      fake.report.terminal_ref,
      { typed: "", seq: 0, tail: null },
    ]),
  );

  function screen(ref: string, terminal: FakeTerminal) {
    if (terminal.tail === null) return;
    terminal.seq += 1;
    const prompt = `› ${visible(terminal.typed)}`;
    const lines: TerminalLine[] = [
      {
        runs: [
          { text: ">_ ", fg: "p6", bold: true },
          { text: "fake terminal ", bold: true },
          { text: ref, fg: "p8" },
        ],
        wrapped: false,
      },
      BLANK,
      {
        runs: [{ text: "✓", fg: "p2" }, { text: " tests passed (12)" }],
        wrapped: false,
      },
      {
        runs: [{ text: "✗", fg: "#ff5f5f" }, { text: " lint: 1 warning" }],
        wrapped: false,
      },
      BLANK,
      { runs: [{ text: prompt }], wrapped: false },
    ];
    while (lines.length < SCREEN_ROWS) lines.push(BLANK);
    send({
      type: "terminal_screen",
      terminal_ref: ref,
      generation: 1,
      seq: terminal.seq,
      columns: SCREEN_COLUMNS,
      rows: SCREEN_ROWS,
      cursor: {
        x: Math.min([...prompt].length, SCREEN_COLUMNS - 1),
        y: 5,
        hidden: false,
      },
      scrollback: terminal.tail === 0 ? [] : SCROLLBACK.slice(-terminal.tail),
      lines,
    });
  }

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

  // 새 터미널에 그 harness의 빈 GUI session을 연다. resume이면 그 CLI session을 이어 연 것으로 친다.
  function openSession(
    harness: string,
    resume: { session: string; cli_session: string } | undefined,
  ): HostToolOutput {
    const ref = `trm_01${String(fakes.length).padStart(24, "0")}`;
    const fake: Fake = {
      report: {
        terminal_ref: ref,
        project: project as never,
        harness,
        state: "idle",
        cli_session: resume?.cli_session ?? null,
        title: resume === undefined ? null : `Continued ${resume.session}`,
        cwd: null,
        shell_pid: null,
        view: "gui",
        handoff:
          harness === "codex" || harness === "opencode" ? "shared" : "restart",
        foreground: false,
      },
      state: plainState(),
    };
    fakes.push(fake);
    terminals.set(ref, { typed: "", seq: 0, tail: null });
    report();
    snapshot(fake);
    console.log(`fake-coding-host: opened ${harness} in ${ref}`);
    return done(JSON.stringify({ terminal_ref: ref }));
  }

  function answer(request: CoreFrame): HostToolOutput {
    switch (request.kind) {
      case "coding_open":
        return openSession(request.payload.harness, request.payload.resume);
      case "coding_input":
        return input(request.payload.input);
      case "coding_switch":
        return switchView(request.payload.terminal_ref, request.payload.to);
      case "terminal_stream": {
        const { terminal_ref: ref, on, tail } = request.payload;
        const terminal = terminals.get(ref);
        if (terminal === undefined)
          return failed("not_found", "no such terminal");
        terminal.tail = on ? tail : null;
        screen(ref, terminal);
        console.log(`fake-coding-host: ${ref} stream ${on ? "on" : "off"}`);
        return done("ok");
      }
      case "terminal_input": {
        const { terminal_ref: ref, text } = request.payload;
        const terminal = terminals.get(ref);
        if (terminal === undefined)
          return failed("not_found", "no such terminal");
        terminal.typed += text;
        screen(ref, terminal);
        console.log(`fake-coding-host: ${ref} typed ${JSON.stringify(text)}`);
        return done("ok");
      }
      default:
        return failed("unavailable", `fake host does not do ${request.kind}`);
    }
  }

  return {
    sessions: () =>
      fakes.map((fake) => ({ session: sessionOf(fake), ...fake.report })),
    // 연결이 열렸다. 연결을 열 때마다 처음부터 다시 보낸다.
    open() {
      // core가 살아 있는 lease마다 `terminal_stream`을 다시 보낸다. 그 전에는 화면을 올리지 않는다.
      for (const terminal of terminals.values()) terminal.tail = null;
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
