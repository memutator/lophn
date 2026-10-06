import { assert, assertEquals } from "@std/assert";
import {
  connectAppCommands,
  PAIR_PORT,
  type PairPort,
  runWith,
} from "./mod.ts";

const TARGET = "app_01h455vb4pex5v6nkc6gd5fdw2";
const PARENT = "inv_01h455vb4pex5v6nkc6gd5fdw1";

type ConnectRequest = Parameters<PairPort["connect"]>[0];
type DirectRequest = Parameters<PairPort["direct"]>[1];

type Sent = {
  connect: ConnectRequest[];
  direct: (DirectRequest & { endpoint: string })[];
  confirm: { kind: "request" | "poll"; body: Record<string, unknown> }[];
};

function install(port: Partial<PairPort> & { sent?: Sent }): Sent {
  const sent: Sent = port.sent ?? { connect: [], direct: [], confirm: [] };
  (globalThis as Record<symbol, unknown>)[PAIR_PORT] = {
    connect: (request: ConnectRequest) => {
      sent.connect.push(request);
      return port.connect!(request);
    },
    direct: (endpoint: string, request: DirectRequest) => {
      sent.direct.push({ ...request, endpoint });
      return port.direct!(endpoint, request);
    },
    confirmRequest: (body: Record<string, unknown>) => {
      sent.confirm.push({ kind: "request", body });
      return port.confirmRequest!(body);
    },
    confirmPoll: (body: Record<string, unknown>) => {
      sent.confirm.push({ kind: "poll", body });
      return port.confirmPoll!(body);
    },
  };
  return sent;
}

function uninstall() {
  delete (globalThis as Record<symbol, unknown>)[PAIR_PORT];
}

const granted = {
  status: 200,
  body: {
    endpoint: "/run/lophn/a-2.sock",
    connection: {
      app: TARGET,
      release: "rel_01h455vb4pex5v6nkc6gd5fdw2",
      commands: ["usage.read"],
    },
    signature: "S".repeat(86),
  },
};

Deno.test("apps/sdk#R40: import만으로는 연결 통로가 없어 다른 앱을 부를 수 없다", async () => {
  uninstall();
  const result = await connectAppCommands(TARGET, ["usage.read"]);
  assert(!result.ok);
  assertEquals(result.error.code, "unavailable");
});

Deno.test("apps/sdk#R40: 현재 invocation 문맥이 부모로 전달되고 허락된 command만 같은 direct 요청으로 간다", async () => {
  const sent = install({
    connect: () => Promise.resolve(granted),
    direct: () =>
      Promise.resolve({
        status: 200,
        body: {
          result: { result: { rows: 2 } },
          invocation: "inv_01h455vb4pex5v6nkc6gd5fdw3",
          mode: "live",
        },
      }),
  });
  try {
    const connected = await runWith(
      { app: "app_a", release: "rel_a", mode: "live", invocation: PARENT },
      () => connectAppCommands(TARGET, ["usage.read", "usage.save"]),
    );
    assert(connected.ok);
    // 본문에는 앱 신원·caller 주장이 없다. 요청 command와 부모만 간다.
    assertEquals(sent.connect, [{
      app: TARGET,
      commands: ["usage.read", "usage.save"],
      parent_invocation: PARENT,
    }]);
    // 허락·서명으로 줄어든 command만 부를 수 있다.
    assertEquals(connected.value.commands, ["usage.read"]);
    const outside = await connected.value.call("usage.save");
    assert(!outside.ok);
    assertEquals(outside.error.code, "forbidden");
    assertEquals(sent.direct.length, 0);

    const called = await connected.value.call("usage.read", { limit: 3 }, {
      requestKey: "key-1",
    });
    assert(called.ok);
    assertEquals(called.value, {
      kind: "result",
      result: { rows: 2 },
      invocation: "inv_01h455vb4pex5v6nkc6gd5fdw3",
    });
    assertEquals(sent.direct.length, 1);
    assertEquals(sent.direct[0].endpoint, "/run/lophn/a-2.sock");
    assertEquals(sent.direct[0].path, "/_lophn/commands/invoke");
    assertEquals(sent.direct[0].body, {
      request_key: "key-1",
      release: "rel_01h455vb4pex5v6nkc6gd5fdw2",
      command: "usage.read",
      input: { limit: 3 },
    });
    // Authorization은 서명된 connection envelope이다.
    assertEquals(JSON.parse(sent.direct[0].authorization), {
      payload: granted.body.connection,
      signature: granted.body.signature,
    });
  } finally {
    uninstall();
  }
});

Deno.test("apps/sdk#R40: 문맥 밖에서 부르면 부모 없음이고 허락 없는 연결·위조 거절은 오류 그대로 돌려준다", async () => {
  const sent = install({
    connect: () =>
      Promise.resolve({
        status: 404,
        body: { error: { code: "not_found", message: "app not found" } },
      }),
    direct: () => Promise.reject(new Error("must not be called")),
  });
  try {
    const refused = await connectAppCommands(TARGET, ["usage.read"]);
    assert(!refused.ok);
    assertEquals(refused.error, {
      code: "not_found",
      message: "app not found",
    });
    assertEquals(sent.connect[0].parent_invocation, null);
    // 자식 신원을 맞추지 못한 요청도 같은 오류 envelope로 온다.
    install({
      sent,
      connect: () =>
        Promise.resolve({
          status: 403,
          body: {
            error: {
              code: "forbidden",
              message: "app.call is not permitted for these commands",
              details: { permission: "app.call", scope: { app: TARGET } },
            },
          },
        }),
      direct: () => Promise.reject(new Error("must not be called")),
    });
    const denied = await connectAppCommands(TARGET, ["usage.admin"]);
    assert(!denied.ok);
    assertEquals(denied.error.code, "forbidden");
    assertEquals(denied.error.details?.["permission"], "app.call");
    // 알 수 없는 응답은 성공으로 읽지 않는다.
    install({
      connect: () => Promise.resolve({ status: 200, body: { endpoint: 1 } }),
      direct: () => Promise.reject(new Error("must not be called")),
    });
    const garbled = await connectAppCommands(TARGET, ["usage.read"]);
    assert(!garbled.ok);
    assertEquals(garbled.error.code, "unavailable");
  } finally {
    uninstall();
  }
});

Deno.test("apps/connections#R6: 보내지 못한 요청은 unavailable, 보낸 뒤 끊기면 결과 모름이고 자동으로 다시 부르지 않는다", async () => {
  const lost = Object.assign(new Error("lost"), { name: "ResultLost" });
  const notSent = Object.assign(new Error("closed"), { name: "NotSent" });
  let failure: Error = lost;
  const sent = install({
    connect: () => Promise.resolve(granted),
    direct: () => Promise.reject(failure),
  });
  try {
    const connected = await connectAppCommands(TARGET, ["usage.read"]);
    assert(connected.ok);
    const unknown = await connected.value.call("usage.read", undefined, {
      requestKey: "key-2",
    });
    assert(unknown.ok);
    assertEquals(unknown.value, { kind: "unknown", requestKey: "key-2" });
    // 한 번만 보냈다. 같은 key로 다시 부르는 것은 호출한 앱이 정한다.
    assertEquals(sent.direct.length, 1);

    failure = notSent;
    const unreachable = await connected.value.call("usage.read");
    assert(!unreachable.ok);
    assertEquals(unreachable.error.code, "unavailable");
    assertEquals(sent.direct.length, 2);
  } finally {
    uninstall();
  }
});

Deno.test("apps/connections#R3: confirm proof는 호출에 그대로 붙고 대상 앱이 보낸 오류 envelope는 그대로 전해진다", async () => {
  let reply: { status: number; body: unknown } = {
    status: 403,
    body: {
      error: { code: "forbidden", message: "confirm command needs a proof" },
    },
  };
  const sent = install({
    connect: () =>
      Promise.resolve({
        ...granted,
        body: {
          ...granted.body,
          connection: { ...granted.body.connection, commands: ["usage.purge"] },
        },
      }),
    direct: () => Promise.resolve(reply),
  });
  try {
    const connected = await connectAppCommands(TARGET, ["usage.purge"]);
    assert(connected.ok);
    const without = await connected.value.call("usage.purge", { amount: 1 });
    assert(!without.ok);
    assertEquals(without.error.code, "forbidden");
    const proof = {
      payload: { invocation: PARENT },
      signature: "P".repeat(86),
    };
    reply = { status: 200, body: { result: { result: null }, mode: "live" } };
    const accepted = await connected.value.call("usage.purge", { amount: 1 }, {
      proof,
    });
    assert(accepted.ok);
    assertEquals(
      (sent.direct[1].body as { proof: unknown }).proof,
      proof,
    );
  } finally {
    uninstall();
  }
});

const APPROVAL = "apr_01h455vb4pex5v6nkc6gd5fdw1";
const PROOF = { payload: { invocation: PARENT }, signature: "P".repeat(86) };
const NEEDS_CONFIRM = {
  status: 403,
  body: {
    error: {
      code: "forbidden",
      message: "confirm command needs a proof",
      details: { confirm_required: true },
    },
  },
};
const connectedToPurge = {
  ...granted,
  body: {
    ...granted.body,
    connection: {
      ...granted.body.connection,
      process_nonce: "target-nonce",
      caller: { kind: "app", parent_invocation: PARENT },
      commands: ["usage.purge"],
    },
  },
};

function confirmPort(polls: { status: number; body: unknown }[]) {
  const replies = [...polls];
  const port = {
    connect: () => Promise.resolve(connectedToPurge),
    // proof가 있어야 handler가 실행된다.
    direct: (_endpoint: string, request: { body?: unknown }) =>
      Promise.resolve(
        (request.body as { proof?: unknown }).proof === undefined
          ? NEEDS_CONFIRM
          : {
            status: 200,
            body: { result: { result: "purged" }, mode: "live" },
          },
      ),
    confirmRequest: () =>
      Promise.resolve({
        status: 200,
        body: {
          approval: APPROVAL,
          input_hash: "ab".repeat(32),
          state: "pending",
        },
      }),
    confirmPoll: () => Promise.resolve(replies.shift() ?? replies[0]),
  };
  return port;
}

Deno.test("apps/connections#R3: 대상 앱이 확인을 요구하면 approval을 요청해 poll로 기다리고 받은 proof를 같은 입력·같은 request_key로 붙인다", async () => {
  const sent = install(confirmPort([
    { status: 200, body: { state: "pending" } },
    { status: 200, body: { state: "pending" } },
    {
      status: 200,
      body: { state: "granted", invocation: PARENT, proof: PROOF },
    },
  ]));
  try {
    const connected = await connectAppCommands(TARGET, ["usage.purge"]);
    assert(connected.ok);
    const done = await connected.value.call("usage.purge", { amount: 1 }, {
      requestKey: "k-1",
    });
    assert(done.ok);
    assertEquals(done.value, { kind: "result", result: "purged" });
    // 요청에는 대상·command·입력·연결의 대상 프로세스와 부모만 있고 신원·입력 지문은 없다.
    assertEquals(sent.confirm[0], {
      kind: "request",
      body: {
        app: TARGET,
        command: "usage.purge",
        input: { amount: 1 },
        target_release: "rel_01h455vb4pex5v6nkc6gd5fdw2",
        target_process_nonce: "target-nonce",
        parent_invocation: PARENT,
      },
    });
    // 소켓을 오래 잡지 않도록 poll은 짧은 기다림 단위로 반복한다.
    const polls = sent.confirm.filter((item) => item.kind === "poll");
    assertEquals(polls.length, 3);
    for (const poll of polls) {
      assertEquals(poll.body, { approval: APPROVAL, wait_ms: 3000 });
    }
    // 처음 거절된 호출과 proof를 붙인 호출은 같은 입력·같은 request_key다.
    assertEquals(sent.direct.length, 2);
    assertEquals(sent.direct[0].body, {
      request_key: "k-1",
      release: "rel_01h455vb4pex5v6nkc6gd5fdw2",
      command: "usage.purge",
      input: { amount: 1 },
    });
    assertEquals(sent.direct[1].body, {
      ...(sent.direct[0].body as object),
      proof: PROOF,
    });
  } finally {
    uninstall();
  }
});

Deno.test("apps/connections#R3: confirm 옵션이 켜지면 처음부터 확인 흐름이고 거절·만료·시간 초과는 proof 없이 오류로 끝난다", async () => {
  try {
    const sent = install(confirmPort([
      {
        status: 200,
        body: { state: "granted", invocation: PARENT, proof: PROOF },
      },
    ]));
    const connected = await connectAppCommands(TARGET, ["usage.purge"]);
    assert(connected.ok);
    const first = await connected.value.call("usage.purge", { amount: 1 }, {
      confirm: true,
    });
    assert(first.ok);
    // 거절된 호출을 먼저 보내지 않고 proof를 붙인 한 번만 보낸다.
    assertEquals(sent.direct.length, 1);
    assertEquals(
      (sent.direct[0].body as { proof: unknown }).proof,
      PROOF,
    );

    for (
      const [reply, code, message] of [
        [{ state: "rejected" }, "forbidden", "confirmation was rejected"],
        [{ state: "expired" }, "unavailable", "confirmation expired"],
      ] as const
    ) {
      const refused = install(confirmPort([{ status: 200, body: reply }]));
      const client = await connectAppCommands(TARGET, ["usage.purge"]);
      assert(client.ok);
      const result = await client.value.call("usage.purge", { amount: 1 });
      assert(!result.ok);
      assertEquals(result.error.code, code);
      assertEquals(result.error.message, message);
      // proof 없이 handler 호출을 다시 보내지 않았다(처음 거절된 한 번뿐).
      assertEquals(refused.direct.length, 1);
    }

    // 결정이 늦으면 한도에서 멈추고 approval을 알려 준다. 자동으로 실행하지 않는다.
    const waiting = install(
      confirmPort([{ status: 200, body: { state: "pending" } }]),
    );
    const client = await connectAppCommands(TARGET, ["usage.purge"]);
    assert(client.ok);
    const timeout = await client.value.call("usage.purge", { amount: 1 }, {
      confirmTimeoutMs: 0,
    });
    assert(!timeout.ok);
    assertEquals(timeout.error.code, "unavailable");
    assertEquals(timeout.error.details, { approval: APPROVAL });
    assertEquals(waiting.direct.length, 1);

    // confirm: false면 확인 흐름으로 가지 않고 대상 앱의 거절 그대로다.
    const off = install(confirmPort([]));
    const manual = await connectAppCommands(TARGET, ["usage.purge"]);
    assert(manual.ok);
    const refused = await manual.value.call("usage.purge", { amount: 1 }, {
      confirm: false,
    });
    assert(!refused.ok);
    assertEquals(refused.error.code, "forbidden");
    assertEquals(off.confirm.length, 0);
  } finally {
    uninstall();
  }
});

Deno.test("apps/connections#R7: 다른 앱에게서 받은 호출의 문맥이면 출처 식별만 준비 요청에 싣는다", async () => {
  const sent = install({
    connect: () => Promise.resolve(granted),
    direct: () => Promise.reject(new Error("must not be called")),
  });
  try {
    const caller = { app: TARGET, release: "rel_a", parent_invocation: null };
    await runWith(
      {
        app: "app_b",
        release: "rel_b",
        mode: "live",
        invocation: PARENT,
        caller,
      },
      () => connectAppCommands(TARGET, ["usage.read"]),
    );
    assertEquals(sent.connect[0].incoming, caller);
    assertEquals(sent.connect[0].parent_invocation, PARENT);
    // 직접 받은 호출이면 싣지 않는다.
    await runWith(
      {
        app: "app_b",
        release: "rel_b",
        mode: "live",
        invocation: PARENT,
        caller: null,
      },
      () => connectAppCommands(TARGET, ["usage.read"]),
    );
    assertEquals("incoming" in sent.connect[1], false);
  } finally {
    uninstall();
  }
});
