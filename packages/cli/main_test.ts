import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

// 제품 판은 root package.json 하나다. identify가 알리는 판도 같다.
import productPackage from "../../package.json" with { type: "json" };
import { err, ok, type Result } from "../base/mod.ts";
import type {
  ControlDial,
  RpcFetch,
  SpawnDetached,
} from "../protocol/client/mod.ts";
import { CORE_CONTROL_PROTOCOL_VERSION } from "../protocol/supervision/mod.ts";
import { ROSTER_CHANGING_COMMANDS } from "./commands/remote.ts";
import { cliMain } from "./main.ts";
import { wordsOf } from "./parser.ts";

function sink(): { stream: WritableStream<Uint8Array>; text(): string } {
  const chunks: string[] = [];
  const decoder = new TextDecoder();
  return {
    stream: new WritableStream({
      write(chunk) {
        chunks.push(decoder.decode(chunk));
      },
    }),
    text: () => chunks.join(""),
  };
}

test("hook CLI는 LPN_TERMINAL_HOOK이 없으면 아무것도 보내지 않고 stdin도 읽지 않고 조용히 성공한다", async () => {
  const stdout = sink();
  const stderr = sink();
  let sent = false;
  let read = false;
  let control = false;
  const code = await cliMain(["hook", "claude", "Stop"], {
    env: {
      get: (name) => (name === "LOPHN_HOME" ? "/nonexistent" : undefined),
    },
    fetch: () => {
      sent = true;
      return Promise.reject(new Error("must not send"));
    },
    dial: () => {
      control = true;
      return Promise.resolve(err({ code: "unavailable", message: "no core" }));
    },
    stdin: () => {
      read = true;
      return Promise.resolve("{}");
    },
    stdout: stdout.stream,
    stderr: stderr.stream,
  });
  assert.deepStrictEqual(code, 0);
  assert.deepStrictEqual([stdout.text(), stderr.text()], ["", ""]);
  assert.deepStrictEqual([sent, read, control], [false, false, false]);
});

test("lophn hook <harness> lophn-gui -- <args...> rejects invalid resume id without calling core", async () => {
  const stdout = sink();
  const stderr = sink();
  const code = await cliMain(
    [
      "hook",
      "antigravity",
      "lophn-gui",
      "--",
      "--dangerously-skip-permissions",
      "--conversation",
      "../etc",
    ],
    {
      env: {
        get: (name) =>
          name === "LPN_TERMINAL_HOOK"
            ? JSON.stringify({
                socket: "/nonexistent.sock",
                key: "a".repeat(64),
              })
            : undefined,
      },
      stdout: stdout.stream,
      stderr: stderr.stream,
    },
  );
  assert.equal(code, 2);
  assert.match(stderr.text(), /invalid session id/);
});

// --- control·fetch를 끼운 자격 경계 표 ---

type ControlPlan = {
  identify?: { apiUrl: string | null };
  connect?: { token: string; apiUrl: string } | "reject";
  stop?: "ok" | "missing";
};

type FetchPlan = { status: number; body: unknown };

function fakeControl(plan: ControlPlan): {
  dial: ControlDial;
  calls: string[];
} {
  const calls: string[] = [];
  const reply = (value: unknown): Result<string> =>
    ok(JSON.stringify({ ok: true, value }));
  const failure = (code: string, message: string): Result<string> =>
    ok(JSON.stringify({ ok: false, error: { code, message } }));
  const missing = (): Result<string> =>
    err({ code: "unavailable", message: "no core" });
  const dial: ControlDial = async (line) => {
    const request = JSON.parse(line) as { type: string; client?: string };
    calls.push(
      request.type === "connect" ? `connect:${request.client}` : request.type,
    );
    if (request.type === "identify") {
      if (plan.identify === undefined) return missing();
      return reply({
        product_version: productPackage.version,
        protocol_version: CORE_CONTROL_PROTOCOL_VERSION,
        core_epoch: "epoch-1",
        api_url: plan.identify.apiUrl,
        state: "ready",
      });
    }
    if (request.type === "connect") {
      if (plan.connect === undefined) return missing();
      if (plan.connect === "reject") return failure("conflict", "rejected");
      return reply({
        user_token: plan.connect.token,
        api_url: plan.connect.apiUrl,
        core_epoch: "epoch-1",
      });
    }
    if (request.type === "stop") {
      return plan.stop === "missing" ? missing() : reply(null);
    }
    return missing();
  };
  return { dial, calls };
}

type FetchCall = {
  url: string;
  authorization: string | undefined;
  body: string | undefined;
};

function fakeFetch(plan: FetchPlan): { fetch: RpcFetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const encoder = new TextEncoder();
  return {
    calls,
    fetch: (url, init) => {
      calls.push({
        url,
        authorization: init.headers.authorization,
        body: init.body,
      });
      return Promise.resolve({
        status: plan.status,
        headers: new Headers(),
        bytes: encoder.encode(JSON.stringify(plan.body)),
      });
    },
  };
}

const HOME = "/fake-home";
const USER_TOKEN = "user-token-secret";
const AGENT_TOKEN = "agent-token-secret";
const AGENT_CREDENTIAL_DIR = mkdtempSync(join(tmpdir(), "lophn-cli-cred-"));
const AGENT_CREDENTIAL_FILE = join(AGENT_CREDENTIAL_DIR, "cred");
writeFileSync(AGENT_CREDENTIAL_FILE, AGENT_TOKEN, "utf8");
after(() => rmSync(AGENT_CREDENTIAL_DIR, { recursive: true, force: true }));
const RUN_ID = "run_00000000000000000000000000";
const CORE_A = "http://127.0.0.1:51001";
const CORE_B = "http://127.0.0.1:51002";

function runRecord(result: string) {
  return {
    id: RUN_ID,
    kind: "agent",
    target: { agent: { agent: "lophn_home", workspace: null } },
    session: null,
    session_opened: false,
    input_message: null,
    turn: null,
    invocation: null,
    schema: null,
    state: "done",
    result,
    error: null,
    job: null,
    instance: null,
    created_at: "2026-10-22T00:00:00.000Z",
    finished_at: "2026-10-22T00:00:01.000Z",
    state_seq: "1",
  };
}

function runReply(result: string) {
  return {
    run: runRecord(result),
    as_of_seq: "1",
    next_cursor: null,
  };
}

type Case = {
  name: string;
  argv: string[];
  env?: Record<string, string>;
  control: ControlPlan;
  fetch?: FetchPlan;
  expect: {
    exit: number;
    calls: string[];
    url?: string;
    authorization?: string;
    // 출력에 있으면 안 되는 값과, 그 자리에 남아야 하는 표시.
    secret?: string;
    // fetch 결과에 이 값이 되비쳐지면 [redacted]가 남는다.
    echoed?: string;
  };
};

const cases: readonly Case[] = [
  {
    name: "agent 자격은 identify가 알린 core에만 그 자격으로 보낸다",
    argv: ["run", "show", RUN_ID],
    env: { LOPHN_AGENT_CREDENTIAL_FILE: AGENT_CREDENTIAL_FILE },
    control: { identify: { apiUrl: CORE_A } },
    fetch: { status: 200, body: runReply(`echo ${AGENT_TOKEN}`) },
    expect: {
      exit: 0,
      calls: ["identify"],
      url: `${CORE_A}/runs/read`,
      authorization: `Bearer ${AGENT_TOKEN}`,
      secret: AGENT_TOKEN,
      echoed: "[redacted]",
    },
  },
  {
    name: "agent 자격의 명시 주소가 같은 core면 그 이름으로 부른다",
    argv: ["run", "show", RUN_ID],
    env: {
      LOPHN_AGENT_CREDENTIAL_FILE: AGENT_CREDENTIAL_FILE,
      LOPHN_DAEMON_URL: "http://localhost:51001",
    },
    control: { identify: { apiUrl: CORE_A } },
    fetch: { status: 200, body: runReply("done") },
    expect: {
      exit: 0,
      calls: ["identify"],
      url: "http://localhost:51001/runs/read",
      authorization: `Bearer ${AGENT_TOKEN}`,
    },
  },
  {
    name: "agent 자격의 명시 주소가 다른 core면 자격을 보내지 않는다",
    argv: ["run", "show", RUN_ID],
    env: {
      LOPHN_AGENT_CREDENTIAL_FILE: AGENT_CREDENTIAL_FILE,
      LOPHN_DAEMON_URL: CORE_B,
    },
    control: { identify: { apiUrl: CORE_A } },
    expect: { exit: 5, calls: ["identify"], secret: AGENT_TOKEN },
  },
  {
    name: "core가 없으면 agent 자격으로 user connect를 하지 않는다",
    argv: ["run", "show", RUN_ID],
    env: { LOPHN_AGENT_CREDENTIAL_FILE: AGENT_CREDENTIAL_FILE },
    control: {},
    expect: { exit: 5, calls: ["identify"], secret: AGENT_TOKEN },
  },
  {
    name: "agent 자격이 거절돼도 user 자격을 받지 않는다",
    argv: ["run", "show", RUN_ID],
    env: { LOPHN_AGENT_CREDENTIAL_FILE: AGENT_CREDENTIAL_FILE },
    control: { identify: { apiUrl: CORE_A } },
    fetch: {
      status: 401,
      body: { error: { code: "unauthorized", message: `bad ${AGENT_TOKEN}` } },
    },
    expect: {
      exit: 3,
      calls: ["identify"],
      url: `${CORE_A}/runs/read`,
      authorization: `Bearer ${AGENT_TOKEN}`,
      secret: AGENT_TOKEN,
      echoed: "[redacted]",
    },
  },
  {
    name: "사람 명령은 ensure 뒤 connect가 준 user 자격으로 core를 부른다",
    argv: ["run", "show", RUN_ID],
    control: {
      identify: { apiUrl: CORE_A },
      connect: { token: USER_TOKEN, apiUrl: CORE_A },
    },
    fetch: { status: 200, body: runReply(`echo ${USER_TOKEN}`) },
    expect: {
      exit: 0,
      calls: ["identify", "connect:cli"],
      url: `${CORE_A}/runs/read`,
      authorization: `Bearer ${USER_TOKEN}`,
      secret: USER_TOKEN,
      echoed: "[redacted]",
    },
  },
  {
    name: "사람 명령의 명시 주소가 같은 core면 그 core의 connect로 자격을 받는다",
    argv: ["run", "show", RUN_ID],
    env: { LOPHN_DAEMON_URL: "http://localhost:51001" },
    control: {
      identify: { apiUrl: CORE_A },
      connect: { token: USER_TOKEN, apiUrl: CORE_A },
    },
    fetch: { status: 200, body: runReply("done") },
    expect: {
      exit: 0,
      calls: ["identify", "connect:cli"],
      url: "http://localhost:51001/runs/read",
      authorization: `Bearer ${USER_TOKEN}`,
    },
  },
  {
    name: "사람 명령의 명시 주소가 core와 다르면 user 자격을 받지도 보내지도 않는다",
    argv: ["run", "show", RUN_ID],
    env: { LOPHN_DAEMON_URL: CORE_B },
    control: {
      identify: { apiUrl: CORE_A },
      connect: { token: USER_TOKEN, apiUrl: CORE_A },
    },
    expect: { exit: 5, calls: ["identify"], secret: USER_TOKEN },
  },
  {
    name: "core stop은 ensure·connect 없이 control stop만 보낸다",
    argv: ["core", "stop"],
    control: { stop: "ok" },
    expect: { exit: 0, calls: ["stop"] },
  },
  {
    name: "core stop은 core가 없으면 unavailable(exit 5)이고 띄우지 않는다",
    argv: ["core", "stop"],
    control: { stop: "missing" },
    expect: { exit: 5, calls: ["stop"] },
  },
  {
    name: "core stop은 agent 문맥에서 forbidden이다",
    argv: ["core", "stop"],
    env: { LOPHN_AGENT_CREDENTIAL_FILE: AGENT_CREDENTIAL_FILE },
    control: { stop: "ok" },
    expect: { exit: 3, calls: [], secret: AGENT_TOKEN },
  },
  {
    name: "core help는 core를 띄우지 않는다",
    argv: ["core", "--help"],
    control: {},
    expect: { exit: 0, calls: [] },
  },
];

for (const item of cases) {
  test(item.name, async () => {
    const stdout = sink();
    const stderr = sink();
    const control = fakeControl(item.control);
    const fetcher = fakeFetch(item.fetch ?? { status: 200, body: {} });
    const spawned: number[] = [];
    const spawnDetached: SpawnDetached = () => {
      spawned.push(1);
      return Promise.resolve({ outcome: "unavailable" });
    };
    const code = await cliMain(item.argv, {
      env: { get: (name) => item.env?.[name] },
      home: HOME,
      fetch: fetcher.fetch,
      dial: control.dial,
      spawnDetached,
      stdout: stdout.stream,
      stderr: stderr.stream,
    });
    const printed = stdout.text() + stderr.text();
    assert.deepStrictEqual(code, item.expect.exit);
    assert.deepStrictEqual(control.calls, item.expect.calls);
    assert.deepStrictEqual(spawned, []);
    if (item.expect.url === undefined) {
      assert.deepStrictEqual(fetcher.calls, []);
    } else {
      assert.deepStrictEqual(fetcher.calls.length, 1);
      assert.deepStrictEqual(fetcher.calls[0]?.url, item.expect.url);
      assert.deepStrictEqual(
        fetcher.calls[0]?.authorization,
        item.expect.authorization,
      );
    }
    if (item.expect.secret !== undefined) {
      assert.deepStrictEqual(printed.includes(item.expect.secret), false);
    }
    if (item.expect.echoed !== undefined) {
      assert.deepStrictEqual(printed.includes(item.expect.echoed), true);
    }
  });
}

// lophn 터미널 탭의 coding agent는 사람 token을 받는다. 명단을 바꾸는 명령(허락 켜기 포함)은 core에 붙기 전에 거절된다.
test("명단을 바꾸는 명령은 lophn 터미널 탭 안에서 core에 붙기 전에 forbidden이다", async () => {
  const args: Record<string, string[]> = {
    "remote.invite": ["computer"],
    "remote.join": ["x"],
    "remote.terminal_input": ["dev_00000000000000000000000000"],
    "remote.remove": ["dev_00000000000000000000000000"],
  };
  assert.deepStrictEqual(
    [...ROSTER_CHANGING_COMMANDS].sort(),
    Object.keys(args).sort(),
  );
  for (const name of ROSTER_CHANGING_COMMANDS) {
    const control = fakeControl({
      identify: { apiUrl: CORE_A },
      connect: { token: USER_TOKEN, apiUrl: CORE_A },
    });
    const fetcher = fakeFetch({ status: 200, body: {} });
    const code = await cliMain([...wordsOf(name), ...args[name]!], {
      env: {
        get: (key) => (key === "LOPHN_SESSION_ID" ? "term:t1" : undefined),
      },
      home: HOME,
      fetch: fetcher.fetch,
      dial: control.dial,
      stdout: sink().stream,
      stderr: sink().stream,
    });
    assert.deepStrictEqual(code, 3, name);
    assert.deepStrictEqual(control.calls, [], name);
    assert.deepStrictEqual(fetcher.calls, [], name);
  }
});

// --- `--on <기계>`: 사람의 터미널이 다른 기계에 보낸다 ---

type SentCall = { path: string; body: Record<string, unknown> };

// `machines/call`의 답은 그 기계의 값이라 route output 검사가 없다. 요청을 그대로 모으고 path별 값을 돌려준다.
function machineFetch(values: Record<string, unknown>): {
  fetch: RpcFetch;
  sent: SentCall[];
} {
  const sent: SentCall[] = [];
  const encoder = new TextEncoder();
  return {
    sent,
    fetch: (url, init) => {
      const body = JSON.parse(init.body ?? "{}") as Record<string, unknown>;
      const path = new URL(url).pathname;
      sent.push({ path, body });
      const inner = `${String(body.resource)}/${String(body.method)}`;
      return Promise.resolve({
        status: 200,
        headers: new Headers(),
        bytes: encoder.encode(JSON.stringify(values[inner] ?? {})),
      });
    },
  };
}

async function runOn(
  argv: string[],
  fetch: RpcFetch,
  env: Record<string, string> = {},
): Promise<{ code: number; calls: string[]; printed: string }> {
  const control = fakeControl({
    identify: { apiUrl: CORE_A },
    connect: { token: USER_TOKEN, apiUrl: CORE_A },
  });
  const stdout = sink();
  const stderr = sink();
  const code = await cliMain(argv, {
    env: { get: (name) => env[name] },
    home: HOME,
    fetch,
    dial: control.dial,
    stdout: stdout.stream,
    stderr: stderr.stream,
  });
  return { code, calls: control.calls, printed: stdout.text() + stderr.text() };
}

test("--on은 이 core의 machines/call로만 가고 capability 칸을 싣지 않는다", async () => {
  const machine = machineFetch({ "runs/read": runReply("remote answer") });
  const ran = await runOn(
    ["run", "show", RUN_ID, "--on", "laptop"],
    machine.fetch,
    {
      LOPHN_WORKSPACE: "project:/tmp/here",
      LOPHN_SHELL_CAPABILITY: "cap-from-env",
    },
  );
  assert.deepStrictEqual(ran.code, 0);
  // 칸이 정확히 이 넷이다: `shell_capability`가 있으면 core가 화면(`screen`)으로 정해 사람의 화면이 하는 일이 된다.
  assert.deepStrictEqual(machine.sent, [
    {
      path: "/machines/call",
      body: {
        machine: "laptop",
        resource: "runs",
        method: "read",
        body: { run: RUN_ID },
      },
    },
  ]);
});

test("--on은 binary 명령, 빈 값, `--on=x`를 core에 붙기 전에 invalid_input으로 거절한다", async () => {
  for (const argv of [
    ["version", "--on", "laptop"],
    ["core", "stop", "--on", "laptop"],
    ["hook", "claude", "Stop", "--on", "laptop"],
    ["run", "show", RUN_ID, "--on", ""],
    ["run", "show", RUN_ID, "--on=laptop"],
  ]) {
    const machine = machineFetch({});
    const ran = await runOn(argv, machine.fetch);
    assert.deepStrictEqual(ran.code, 2, argv.join(" "));
    assert.deepStrictEqual(ran.calls, [], argv.join(" "));
    assert.deepStrictEqual(machine.sent, [], argv.join(" "));
  }
});

test("--on으로 다른 기계의 앱 command를 부르면 그 기계의 선언을 읽고 apps/remote_call 하나로 부르며 실패는 exit 4다", async () => {
  const APP = "app_00000000000000000000000000";
  const machine = machineFetch({
    "apps/list": {
      apps: [{ id: APP, slug: "notes" }],
      next_cursor: null,
    },
    "apps/tools": {
      tools: [
        {
          name: "add",
          description: "Add a note",
          effect: "write",
          inputSchema: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
            additionalProperties: false,
          },
        },
      ],
    },
    "apps/remote_call": {
      invocation: null,
      outcome: {
        status: "denied",
        denial: { code: "gate_blocked", message: "no" },
      },
    },
  });
  const ran = await runOn(
    ["notes", "add", "--text", "hi", "--on", "laptop"],
    machine.fetch,
  );
  assert.deepStrictEqual(ran.code, 4);
  assert.deepStrictEqual(
    machine.sent.map((call) => [
      call.body.machine,
      call.body.resource,
      call.body.method,
    ]),
    [
      ["laptop", "apps", "list"],
      ["laptop", "apps", "tools"],
      ["laptop", "apps", "remote_call"],
    ],
  );
  assert.deepStrictEqual(machine.sent[2]?.body.body, {
    app: APP,
    command: "add",
    input: { text: "hi" },
  });
});

// harness agent는 agent 자격이라 machines/call(사람 자격만)을 쓰지 못한다. `on` 칸을 가진 명령은 `--on`을 그 칸으로 보내고,
// 그 밖의 명령에 붙은 `--on`은 core에 붙기 전에 거절한다. 사람의 `--on`은 그대로 machines/call이다.
test("agent 자격의 call send --on은 calls/send_remote로 가고, 다른 명령의 --on은 forbidden이며, 사람의 --on은 machines/call이다", async () => {
  const CALL = "cal_00000000000000000000000001";
  const send = [
    "call",
    "send",
    "--to",
    '{"agent":"reviewer"}',
    "--reply",
    "result",
    "--body",
    "look",
    "--on",
    "laptop",
  ];
  const sent = { call: CALL, state: "accepted", fail_reason: null };
  const agent = { LOPHN_AGENT_CREDENTIAL_FILE: AGENT_CREDENTIAL_FILE };

  // machines/call을 거치지 않은 요청은 body에 resource·method가 없어 그 key로 답한다.
  const direct = machineFetch({ "undefined/undefined": sent });
  const ran = await runOn(send, direct.fetch, agent);
  assert.deepStrictEqual(ran.code, 0, ran.printed);
  assert.deepStrictEqual(
    direct.sent.map((call) => [call.path, call.body.to]),
    [["/calls/send_remote", { agent: "reviewer", machine: "laptop" }]],
  );

  // `--on`을 명령 낱말 앞에 써도 같다.
  const listed = machineFetch({
    "undefined/undefined": {
      machine: { machine: "mch_0aaaaaaaaaaaaaaaaaaaaaaaaa", name: "laptop" },
      sessions: [],
    },
  });
  const before = await runOn(
    ["--on", "laptop", "session", "list"],
    listed.fetch,
    agent,
  );
  assert.deepStrictEqual(before.code, 0, before.printed);
  assert.deepStrictEqual(listed.sent, [
    { path: "/machines/sessions", body: { machine: "laptop" } },
  ]);

  const refused = machineFetch({});
  const tab = await runOn(
    ["tab", "open", "--url", "https://example.com", "--on", "laptop"],
    refused.fetch,
    agent,
  );
  assert.deepStrictEqual(tab.code, 3, tab.printed);
  assert.match(tab.printed, /call send/);
  assert.deepStrictEqual(refused.sent, []);

  const person = machineFetch({ "calls/send": sent });
  const human = await runOn(send, person.fetch);
  assert.deepStrictEqual(human.code, 0, human.printed);
  assert.deepStrictEqual(
    person.sent.map((call) => [
      call.path,
      call.body.machine,
      call.body.resource,
      call.body.method,
    ]),
    [["/machines/call", "laptop", "calls", "send"]],
  );
});

test("lophn send와 lophn settings export의 --on은 machines/call이 아니라 이 컴퓨터 core의 route로 간다", async () => {
  const TRF = "trf_01hzzzzzzzzzzzzzzzzzzzzzza";
  const STG = "stg_01hzzzzzzzzzzzzzzzzzzzzzza";
  const MCH = "mch_01hzzzzzzzzzzzzzzzzzzzzzzb";
  const SHA = "c".repeat(64);

  const sendFetch = machineFetch({
    "undefined/undefined": {
      transfer: TRF,
      to_machine: MCH,
      to_name: "VM",
      state: "held_at_hub",
      files: [{ name: "a.txt", rel_path: "a.txt", size: 4, sha256: SHA }],
      created_at: "2026-11-26T00:00:00.000Z",
      expires_at: "2026-12-03T00:00:00.000Z",
    },
  });
  const humanSend = await runOn(
    ["send", "a.txt", "b.txt", "--on", "VM"],
    sendFetch.fetch,
  );
  assert.deepStrictEqual(humanSend.code, 0, humanSend.printed);
  assert.deepStrictEqual(
    sendFetch.sent.map((c) => [c.path, c.body.to]),
    [["/transfers/send", "VM"]],
  );

  const agentSendFetch = machineFetch({
    "undefined/undefined": {
      transfer: TRF,
      to_machine: MCH,
      to_name: "VM",
      state: "delivered",
      files: [{ name: "a.txt", rel_path: "a.txt", size: 4, sha256: SHA }],
      created_at: "2026-11-26T00:00:00.000Z",
      expires_at: "2026-12-03T00:00:00.000Z",
    },
  });
  const agentSend = await runOn(
    ["send", "a.txt", "--on", "VM"],
    agentSendFetch.fetch,
    {
      LOPHN_AGENT_CREDENTIAL_FILE: AGENT_CREDENTIAL_FILE,
    },
  );
  assert.deepStrictEqual(agentSend.code, 0, agentSend.printed);
  assert.deepStrictEqual(
    agentSendFetch.sent.map((c) => [c.path, c.body.to]),
    [["/transfers/send", "VM"]],
  );

  const exportFetch = machineFetch({
    "undefined/undefined": {
      batch: STG,
      to_machine: MCH,
      delivery_state: "held_at_hub",
      item_count: 1,
    },
  });
  const humanExport = await runOn(
    ["settings", "export", "agent", "reviewer", "--on", "VM"],
    exportFetch.fetch,
  );
  assert.deepStrictEqual(humanExport.code, 0, humanExport.printed);
  assert.deepStrictEqual(
    exportFetch.sent.map((c) => [c.path, c.body.to, c.body.items]),
    [["/settings_export/send", "VM", [{ kind: "agent", id: "reviewer" }]]],
  );
});
