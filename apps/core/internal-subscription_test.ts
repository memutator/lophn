// platform/api#R5, platform/ledger#R15: core 안 구독자는 바깥 구독자와 같은 session을 쓴다. 열린 뒤의
// event만 받고(그 전 변화는 onSubscribed가 따라잡는다), session이 닫히면 backoff 뒤 다시 열고
// 열 때마다 onSubscribed를 부른다.
import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../packages/base/mod.ts";
import type {
  EventEnvelope,
  RequestContext,
} from "../../packages/contracts/platform/mod.ts";
import type {
  EventBackend,
  EventSession,
} from "../../packages/platform/ledger/mod.ts";
import { openInternalSubscription } from "./internal-subscription.ts";

const CONTEXT: RequestContext = {
  principal: "machine:test-feed",
  actor: "machine",
  scope: { operations: ["ListEvents"], targets: {} },
  conditions: {},
  credential_ref: "machine:test-feed",
};

function envelope(seq: number): EventEnvelope {
  return {
    seq: String(seq),
    type: "ProjectCreated",
    subject: "prj_01kq12a1pha000000000000000",
    actor: "user",
    run: null,
    payload: {},
    at: "2026-10-06T00:00:00.000Z",
  };
}

function fakeBackend() {
  const log: EventEnvelope[] = [];
  const state = { failReads: false, reads: 0 };
  const backend: EventBackend = {
    current: () => Promise.resolve(ok(CONTEXT)),
    read(_ctx, scan) {
      state.reads += 1;
      if (state.failReads) {
        return Promise.resolve(
          err({ code: "unavailable", message: "reader down" }),
        );
      }
      const from = BigInt(scan.position) + (scan.inclusive ? 0n : 1n);
      const events = log.filter((event) => BigInt(event.seq) >= from);
      const head = log.at(-1)?.seq ?? "0";
      return Promise.resolve(ok({
        events: scan.limit === 1 ? [] : events,
        scanned_through_seq: scan.limit === 1 ? "0" : head,
        head_seq: head,
      }));
    },
  };
  return { backend, log, state };
}

async function until(what: string, ready: () => boolean): Promise<void> {
  for (let waited = 0; waited < 200 && !ready(); waited++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert(ready(), `timed out: ${what}`);
}

Deno.test("platform/api#R5: 내부 구독은 열린 뒤의 event만 받고 열릴 때 onSubscribed를 부른다", async () => {
  const { backend, log } = fakeBackend();
  log.push(envelope(1));
  const sessions = new Set<EventSession>();
  const batches: string[][] = [];
  let subscribed = 0;
  const subscription = openInternalSubscription({
    context: CONTEXT,
    backend,
    track: (session) => {
      sessions.add(session);
      return () => sessions.delete(session);
    },
    onSubscribed: () => {
      subscribed += 1;
    },
    onEvents: (events) => {
      batches.push(events.map((event) => event.seq));
    },
    retryMs: 10,
  });
  try {
    await until("open", () => subscription.open && subscribed === 1);
    // 열리기 전 event(1)는 오지 않는다. 그 사이 변화는 onSubscribed의 snapshot 읽기 몫이다.
    assertEquals(batches, []);
    log.push(envelope(2));
    for (const session of sessions) session.catchUp();
    await until("event 2", () => batches.length === 1);
    assertEquals(batches, [["2"]]);
  } finally {
    subscription.stop();
  }
  // 멈춘 뒤에는 dispatcher에서 빠지고 다시 열지 않는다.
  assertEquals(sessions.size, 0);
  assertEquals(subscription.open, false);
});

Deno.test("platform/api#R5: session이 닫히면 backoff 뒤 다시 열고 다시 onSubscribed를 부른다", async () => {
  const { backend, log, state } = fakeBackend();
  const sessions = new Set<EventSession>();
  let subscribed = 0;
  const heard: string[] = [];
  const subscription = openInternalSubscription({
    context: CONTEXT,
    backend,
    track: (session) => {
      sessions.add(session);
      return () => sessions.delete(session);
    },
    onSubscribed: () => {
      subscribed += 1;
    },
    onEvents: (events) => {
      heard.push(...events.map((event) => event.seq));
    },
    retryMs: 10,
    maxRetryMs: 20,
  });
  try {
    await until("first open", () => subscription.open && subscribed === 1);
    // reader가 잠시 죽으면 session은 안전하게 닫힌다.
    state.failReads = true;
    for (const session of sessions) session.catchUp();
    await until("closed", () => !subscription.open);
    // 닫혀 있는 동안 생긴 event는 전달되지 않는다. 다시 열 때의 head 다음부터다.
    log.push(envelope(5));
    state.failReads = false;
    await until("reopened", () => subscription.open && subscribed === 2);
    assertEquals(heard, []);
    log.push(envelope(6));
    for (const session of sessions) session.catchUp();
    await until("event 6", () => heard.length === 1);
    assertEquals(heard, ["6"]);
  } finally {
    subscription.stop();
  }
});
