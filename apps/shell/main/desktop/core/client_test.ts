import assert from "node:assert/strict";
import { test } from "node:test";

import type { RpcFetch } from "../../../../../packages/contracts/platform/mod.ts";

import { openSession } from "./client.ts";
import { type EventSocket, subscribe } from "./events.ts";

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

test("shell/desktop#R19: 고정 연결 intent는 연결 화면만 통과한다", async () => {
  const fetch = fetchOf(200, { id: "cac_1" });
  const blocked = openSession({
    apiPort: 1,
    coreEpoch: "epoch-1",
    userToken: TOKEN,
    fetch,
  });
  const denied = await blocked.call(
    "command",
    "coding_agent_connections",
    "create",
    {},
  );
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.error.code, "forbidden");
  const allowed = openSession({
    apiPort: 1,
    coreEpoch: "epoch-1",
    userToken: TOKEN,
    fetch,
    connectionIntent: () => true,
  });
  const result = await allowed.call(
    "command",
    "coding_agent_connections",
    "create",
    {
      input: {
        id: "cac_01arz3ndektsv4rrffq69g5fav",
        label: "desk",
        scope: { kind: "all", app: null },
        token_digest: "a".repeat(64),
      },
      idempotency_key: "k",
      compare: {},
      prepared: [],
    },
  );
  // 응답 schema는 가짜다. 호출이 나갔는지만 본다.
  assert.equal(result.ok, false);
  if (!result.ok) assert.notEqual(result.error.code, "forbidden");
  assert.equal(fetch.calls.length, 1);
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
