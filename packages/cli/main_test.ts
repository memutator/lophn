import assert from "node:assert/strict";
import { test } from "node:test";

// 제품 판은 root package.json 하나다. identify가 알리는 판도 같다.
import productPackage from "../../package.json" with { type: "json" };
import { err, ok, type Result } from "../base/mod.ts";
import type {
  ControlDial,
  RpcFetch,
  SpawnDetached,
} from "../protocol/client/mod.ts";
import { CORE_CONTROL_PROTOCOL_VERSION } from "../protocol/supervision/mod.ts";
import { cliMain } from "./main.ts";

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
const RUN_ID = "run_00000000000000000000000000";
const CORE_A = "http://127.0.0.1:51001";
const CORE_B = "http://127.0.0.1:51002";

function runRecord(result: string) {
  return {
    id: RUN_ID,
    kind: "agent",
    target: { agent: { agent: "lophn", workspace: null } },
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
    env: { LOPHN_AGENT_CREDENTIAL: AGENT_TOKEN },
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
      LOPHN_AGENT_CREDENTIAL: AGENT_TOKEN,
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
      LOPHN_AGENT_CREDENTIAL: AGENT_TOKEN,
      LOPHN_DAEMON_URL: CORE_B,
    },
    control: { identify: { apiUrl: CORE_A } },
    expect: { exit: 5, calls: ["identify"], secret: AGENT_TOKEN },
  },
  {
    name: "core가 없으면 agent 자격으로 user connect를 하지 않는다",
    argv: ["run", "show", RUN_ID],
    env: { LOPHN_AGENT_CREDENTIAL: AGENT_TOKEN },
    control: {},
    expect: { exit: 5, calls: ["identify"], secret: AGENT_TOKEN },
  },
  {
    name: "agent 자격이 거절돼도 user 자격을 받지 않는다",
    argv: ["run", "show", RUN_ID],
    env: { LOPHN_AGENT_CREDENTIAL: AGENT_TOKEN },
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
    env: { LOPHN_AGENT_CREDENTIAL: AGENT_TOKEN },
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
