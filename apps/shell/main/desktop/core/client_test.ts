import assert from "node:assert/strict";
import { test } from "node:test";

import type { RpcFetch } from "../../../../../packages/contracts/platform/mod.ts";

import { CONNECTION_INTENT } from "./allowlist.ts";
import { openSession } from "./client.ts";
import { type EventSocket, type ReconnectPolicy, subscribe } from "./events.ts";

const TOKEN = "user-token-value";

function fetchOf(
  status: number,
  body: unknown,
): RpcFetch & { calls: string[] } {
  const fetch = ((input: string) => {
    recorded.push(input);
    return Promise.resolve({
      status,
      headers: new Headers({ "content-type": "application/json" }),
      bytes: new TextEncoder().encode(JSON.stringify(body)),
    });
  }) as unknown as RpcFetch & { calls: string[] };
  const recorded: string[] = [];
  fetch.calls = recorded;
  return fetch;
}

test("shell/desktop#R15: read는 사람 token을 Authorization에만 싣고 본문에는 없다", async () => {
  let authorization = "";
  const fetch: RpcFetch = (_input, init) => {
    authorization = init.headers.authorization ?? "";
    assert.equal(init.body?.includes(TOKEN), false);
    return Promise.resolve({
      status: 200,
      headers: new Headers(),
      bytes: new TextEncoder().encode(JSON.stringify({
        ready: true,
        schema: 1,
        data_root: "/data",
        ledger_id: "ledger-1",
        components: [],
        as_of_seq: "0",
        next_cursor: null,
      })),
    });
  };
  const session = openSession({
    apiPort: 7431,
    coreEpoch: "epoch-1",
    userToken: TOKEN,
    fetch,
  });
  const result = await session.call("read", "platform", "status", {});
  assert.equal(result.ok, true);
  assert.equal(authorization, `Bearer ${TOKEN}`);
  assert.equal(JSON.stringify(session).includes(TOKEN), false);
});

test("shell/desktop#R19: allowlist 밖 호출은 나가지 않고 거절한다", async () => {
  const fetch = fetchOf(200, {});
  const session = openSession({
    apiPort: 7431,
    coreEpoch: "epoch-1",
    userToken: TOKEN,
    fetch,
  });
  for (
    const call of [
      ["command", "identity", "issue"],
      ["command", "platform", "shutdown"],
      ["read", "not", "a-route"],
    ]
  ) {
    const result = await session.call(call[0]!, call[1]!, call[2]!, {});
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "forbidden");
  }
  assert.deepEqual(fetch.calls, []);
});

test("shell/desktop#R19: 연결 생성 command와 연결 intent route는 renderer allowlist에 없다", async () => {
  const fetch = fetchOf(200, { id: "cac_1" });
  const session = openSession({
    apiPort: 1,
    coreEpoch: "epoch-1",
    userToken: TOKEN,
    fetch,
  });
  for (
    const call of [
      ["command", "coding_agent_connections", "create"],
      ["memory", "coding_agent_connections", "connect"],
      ["command", "coding_agent_connections", "connect"],
    ]
  ) {
    const denied = await session.call(call[0]!, call[1]!, call[2]!, {});
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.error.code, "forbidden");
  }
  assert.deepEqual(fetch.calls, []);
});

test("shell/desktop#R19: 고정 연결 intent route는 main 안 통로(internal)만 부른다", async () => {
  const fetch = fetchOf(200, { connection: "cac_01arz3ndektsv4rrffq69g5fav" });
  const session = openSession({
    apiPort: 1,
    coreEpoch: "epoch-1",
    userToken: TOKEN,
    fetch,
  });
  assert.equal(CONNECTION_INTENT, "memory:coding_agent_connections/connect");
  const result = await session.internal(
    "memory",
    "coding_agent_connections",
    "connect",
    { label: "desk", scope: { kind: "all", app: null } },
  );
  assert.equal(result.ok, true);
  assert.equal(fetch.calls.length, 1);
  assert.equal(
    fetch.calls[0]!.endsWith("/v1/coding_agent_connections/connect"),
    true,
  );
});

function socket(): EventSocket & {
  sent: string[];
  drop(): void;
  open(): void;
  receive(text: string): void;
} {
  const messages: ((text: string) => void)[] = [];
  const opens: (() => void)[] = [];
  const closes: (() => void)[] = [];
  return {
    sent: [],
    send(text) {
      this.sent.push(text);
    },
    close() {},
    onOpen(listener) {
      opens.push(listener);
    },
    onMessage(listener) {
      messages.push(listener);
    },
    onClose(listener) {
      closes.push(listener);
    },
    drop() {
      for (const listener of closes) listener();
    },
    open() {
      for (const listener of opens) listener();
    },
    receive(text) {
      for (const listener of messages) listener(text);
    },
  };
}

test("shell/desktop#R7: 구독이 끊기면 마지막 확인 시각과 함께 최신 확인 못함을 알린다", async () => {
  const notices: { state: string; confirmedAt: number | null }[] = [];
  const session = openSession({
    apiPort: 7431,
    coreEpoch: "epoch-1",
    userToken: TOKEN,
    fetch: fetchOf(200, {
      events: [],
      scanned_through_seq: "4",
      head_seq: "4",
      as_of_seq: "4",
      next_cursor: null,
    }),
  });
  let opened: ReturnType<typeof socket> | undefined;
  const sub = subscribe({
    session,
    epoch: "epoch-1",
    clock: { now: () => 1_700_000_000_000 },
    sink: {
      stale: (notice) => notices.push(notice),
      caughtUp: () => {},
    },
    socket: {
      open() {
        opened = socket();
        return opened;
      },
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(sub.cursor, "4");
  assert.ok(opened);
  // open되기 전에는 subscribe를 보내지 않는다.
  assert.equal(opened.sent.length, 0);
  opened.open();
  assert.equal(JSON.parse(opened.sent[0]!).from_seq, "5");
  assert.equal(JSON.stringify(opened.sent).includes(TOKEN), false);
  opened.drop();
  assert.deepEqual(notices, [{
    state: "stale",
    confirmedAt: 1_700_000_000_000,
  }]);
});

test("shell/desktop#R7: 다시 붙으면 cursor 다음부터 따라잡고 epoch가 바뀌면 옛 응답을 버린다", async () => {
  const session = openSession({
    apiPort: 7431,
    coreEpoch: "epoch-1",
    userToken: TOKEN,
    fetch: fetchOf(200, {
      events: [],
      scanned_through_seq: "4",
      head_seq: "9",
      as_of_seq: "9",
      next_cursor: null,
    }),
  });
  const opened: ReturnType<typeof socket>[] = [];
  const sub = subscribe({
    session,
    epoch: "epoch-1",
    generation: 1,
    clock: { now: () => 5 },
    sink: { stale: () => {}, caughtUp: () => {} },
    socket: {
      open() {
        const next = socket();
        opened.push(next);
        return next;
      },
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  opened[0]!.open();
  assert.equal(JSON.parse(opened[0]!.sent[0]!).from_seq, "5");
  sub.reconnect("epoch-2");
  const before = opened.length;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(opened.length, before);
  assert.equal(sub.generation, 1);
});

// ntf_ 뒤 ULID 26자. 끝 글자만 다르게 둔다.
const ntf = (last: string) => `ntf_01j0000000000000000000000${last}`;

function envelope(seq: string, type: string, subject: string) {
  return {
    seq,
    type,
    subject,
    actor: "machine",
    run: null,
    payload: { source_seq: "1" },
    at: "2026-10-06T00:00:00.000Z",
  };
}

test("shell/desktop#R7: 붙을 때 따라잡은 backlog는 지금 도착한 event로 보내지 않고 head 뒤의 것만 보낸다", async () => {
  const backlog = envelope("3", "NotificationCreated", ntf("0"));
  const session = openSession({
    apiPort: 7431,
    coreEpoch: "epoch-1",
    userToken: TOKEN,
    // 한 page는 4까지 훑었고 head는 6이다. 5·6은 socket으로 오지만 아직 backlog다.
    fetch: fetchOf(200, {
      events: [backlog],
      scanned_through_seq: "4",
      head_seq: "6",
      as_of_seq: "6",
      next_cursor: null,
    }),
  });
  const arrived: (string | null)[] = [];
  let opened: ReturnType<typeof socket> | undefined;
  subscribe({
    session,
    epoch: "epoch-1",
    clock: { now: () => 1 },
    sink: {
      stale: () => {},
      caughtUp: () => {},
      arrived: (events) => {
        for (const event of events) arrived.push(event.subject);
      },
    },
    socket: {
      open() {
        opened = socket();
        return opened;
      },
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(opened);
  opened.open();
  opened.receive(JSON.stringify({
    type: "events",
    events: [
      envelope("5", "NotificationCreated", ntf("1")),
      envelope("6", "NotificationCreated", ntf("2")),
      envelope("7", "NotificationCreated", ntf("3")),
    ],
    scanned_through_seq: "7",
    head_seq: "7",
  }));
  assert.deepEqual(arrived, [ntf("3")]);
});

function manualPolicy(allowed: () => boolean = () => true) {
  const waits: number[] = [];
  const pending: (() => void)[] = [];
  const policy: ReconnectPolicy = {
    delay: (attempt) => 1000 * 2 ** attempt,
    after(ms, run) {
      waits.push(ms);
      pending.push(run);
      return () => {
        const at = pending.indexOf(run);
        if (at >= 0) pending.splice(at, 1);
      };
    },
    allowed,
  };
  return { policy, waits, pending };
}

const later = () => new Promise((resolve) => setTimeout(resolve, 10));

test("shell/desktop#R7: socket이 닫히면 backoff로 스스로 다시 붙어 현재 기록으로 맞추고 끊긴 사이 진행은 다시 알리지 않는다", async () => {
  // 처음엔 head 4. 끊긴 사이 5·6이 생겨 다시 붙을 때 head는 6이다.
  let page = { scanned: "4", head: "4", events: [] as unknown[] };
  const fetch: RpcFetch = () =>
    Promise.resolve({
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      bytes: new TextEncoder().encode(JSON.stringify({
        events: page.events,
        scanned_through_seq: page.scanned,
        head_seq: page.head,
        as_of_seq: page.head,
        next_cursor: null,
      })),
    });
  const session = openSession({
    apiPort: 7431,
    coreEpoch: "epoch-1",
    userToken: TOKEN,
    fetch,
  });
  const opened: ReturnType<typeof socket>[] = [];
  const log: string[] = [];
  const arrived: (string | null)[] = [];
  const { policy, waits, pending } = manualPolicy();
  subscribe({
    session,
    epoch: "epoch-1",
    clock: { now: () => 1 },
    reconnectPolicy: policy,
    sink: {
      stale: () => log.push("stale"),
      caughtUp: () => log.push("caughtUp"),
      arrived: (events) => {
        for (const event of events) arrived.push(event.subject);
      },
    },
    socket: {
      open() {
        const next = socket();
        opened.push(next);
        return next;
      },
    },
  });
  await later();
  opened[0]!.open();
  opened[0]!.drop();
  assert.deepEqual(log, ["caughtUp", "stale"]);
  assert.deepEqual(waits, [1000]);
  assert.equal(opened.length, 1);

  page = {
    scanned: "6",
    head: "6",
    events: [envelope("5", "NotificationCreated", ntf("1"))],
  };
  pending.shift()!();
  await later();
  // 현재 기록을 읽어 맞추고 cursor 다음부터 다시 구독한다. 따라잡은 목록은 알리지 않는다.
  assert.deepEqual(log, ["caughtUp", "stale", "caughtUp"]);
  assert.equal(opened.length, 2);
  opened[1]!.open();
  assert.equal(JSON.parse(opened[1]!.sent[0]!).from_seq, "7");
  opened[1]!.receive(JSON.stringify({
    type: "events",
    events: [envelope("7", "NotificationCreated", ntf("2"))],
    scanned_through_seq: "7",
    head_seq: "7",
  }));
  assert.deepEqual(arrived, [ntf("2")]);
});

test("shell/desktop#R7: 다시 붙지 못하면 대기를 늘리며 계속 시도하고 붙으면 처음으로 되돌린다", async () => {
  let reachable = false;
  const fetch: RpcFetch = () =>
    reachable
      ? Promise.resolve({
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        bytes: new TextEncoder().encode(JSON.stringify({
          events: [],
          scanned_through_seq: "4",
          head_seq: "4",
          as_of_seq: "4",
          next_cursor: null,
        })),
      })
      : Promise.reject(new Error("refused"));
  const session = openSession({
    apiPort: 7431,
    coreEpoch: "epoch-1",
    userToken: TOKEN,
    fetch,
  });
  const opened: ReturnType<typeof socket>[] = [];
  const stales: (number | null)[] = [];
  const { policy, waits, pending } = manualPolicy();
  subscribe({
    session,
    epoch: "epoch-1",
    clock: { now: () => 1 },
    reconnectPolicy: policy,
    sink: {
      stale: (notice) => stales.push(notice.confirmedAt),
      caughtUp: () => {},
    },
    socket: {
      open() {
        const next = socket();
        opened.push(next);
        return next;
      },
    },
  });
  await later();
  // core가 없으니 읽기가 실패한다. 마지막 확인 시각이 없는 stale을 알리고 계속 시도한다.
  assert.deepEqual(stales, [null]);
  pending.shift()!();
  await later();
  pending.shift()!();
  await later();
  assert.deepEqual(waits, [1000, 2000, 4000]);
  assert.equal(pending.length, 1);
  reachable = true;
  pending.shift()!();
  await later();
  opened[0]!.open();
  opened[0]!.drop();
  // 한 번 정상으로 붙었으니 대기는 처음부터 다시 센다.
  assert.equal(waits.at(-1), 1000);
});

test("shell/desktop#R7: core 프로세스가 끝났거나 구독을 멈췄으면 다시 붙지 않는다", async () => {
  const fetch = fetchOf(200, {
    events: [],
    scanned_through_seq: "4",
    head_seq: "4",
    as_of_seq: "4",
    next_cursor: null,
  });
  const session = openSession({
    apiPort: 7431,
    coreEpoch: "epoch-1",
    userToken: TOKEN,
    fetch,
  });
  const opened: ReturnType<typeof socket>[] = [];
  let alive = true;
  const { policy, pending } = manualPolicy(() => alive);
  const sub = subscribe({
    session,
    epoch: "epoch-1",
    clock: { now: () => 1 },
    reconnectPolicy: policy,
    sink: { stale: () => {}, caughtUp: () => {} },
    socket: {
      open() {
        const next = socket();
        opened.push(next);
        return next;
      },
    },
  });
  await later();
  opened[0]!.drop();
  alive = false;
  const reads = fetch.calls.length;
  pending.shift()!();
  await later();
  assert.equal(fetch.calls.length, reads);

  alive = true;
  opened[0]!.drop();
  opened[0]!.drop();
  assert.equal(pending.length, 1);
  sub.stop();
  assert.equal(pending.length, 0);
});
