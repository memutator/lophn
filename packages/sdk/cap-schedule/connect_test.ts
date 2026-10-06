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
};

function install(port: Partial<PairPort> & { sent?: Sent }): Sent {
  const sent: Sent = port.sent ?? { connect: [], direct: [] };
  (globalThis as Record<symbol, unknown>)[PAIR_PORT] = {
    connect: (request: ConnectRequest) => {
      sent.connect.push(request);
      return port.connect!(request);
    },
    direct: (endpoint: string, request: DirectRequest) => {
      sent.direct.push({ ...request, endpoint });
      return port.direct!(endpoint, request);
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
