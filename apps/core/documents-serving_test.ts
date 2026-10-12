// documents coordinator 요청 통로: coordinator를 바꾸는 동안의 요청 처리. 실제 process 없이 보낸
// 요청과 child 응답을 시험이 직접 흉내 낸다.
import { assert, assertEquals } from "@std/assert";
import { ok } from "../../packages/base/mod.ts";
import type {
  ChildMessage,
  RequestContext,
  WorkerRequest,
} from "../../packages/protocol/server/mod.ts";
import { createDocumentsChannel, servedWorkers } from "./documents-serving.ts";

type Sent = { request_id: string; op: string };

// 보낸 요청을 모으는 가짜 pipe. 응답은 시험이 respond로 돌려준다.
function fakePipe() {
  const sent: Sent[] = [];
  return {
    sent,
    send: (payload: unknown) => {
      sent.push(payload as Sent);
      return Promise.resolve(true);
    },
  };
}

function reply(id: string, payload: unknown): ChildMessage {
  return { type: "worker_response", request_id: id, ok: true, payload };
}

async function settled<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | "late"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<"late">((resolve) => {
        timer = setTimeout(() => resolve("late"), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

Deno.test("platform/responsiveness#R3: coordinator를 바꾸면 옛 child에 남은 요청은 기한까지 기다리지 않고 바로 unavailable로 끝난다", async () => {
  const channel = createDocumentsChannel({ drainMs: 30 });
  const pipe = fakePipe();
  channel.bind(pipe.send);
  // 옛 child는 이 요청에 끝내 답하지 않는다(멈추면서 응답을 잃는다). 기한은 60초다.
  const lost = channel.request("project.preview_tracking", {}, 60_000);
  const replaced = channel.replacing(() => Promise.resolve("replaced"));
  const outcome = await settled(lost, 5_000);
  assert(outcome !== "late", "the lost request waited for its own deadline");
  assert(!outcome.ok);
  assertEquals(outcome.error.code, "unavailable");
  assertEquals(await replaced, "replaced");
});

Deno.test("platform/responsiveness#R3: 바꾸기 전에 보낸 요청은 옛 child가 잠깐 안에 답하면 그 답을 받는다", async () => {
  const channel = createDocumentsChannel({ drainMs: 5_000 });
  const pipe = fakePipe();
  channel.bind(pipe.send);
  const inflight = channel.request("project.preview_tracking", {}, 60_000);
  const replaced = channel.replacing(() => Promise.resolve("replaced"));
  channel.onMessage(reply(pipe.sent[0].request_id, { preview: true }));
  const answer = await inflight;
  assert(answer.ok);
  assertEquals(answer.value, { preview: true });
  await replaced;
});

Deno.test("platform/responsiveness#R3: 바꾸는 동안 온 요청은 새 child가 뜬 뒤에 보내고, 그 child의 답을 받는다", async () => {
  const channel = createDocumentsChannel({ drainMs: 10 });
  const pipe = fakePipe();
  channel.bind(pipe.send);
  let finish: () => void = () => {};
  const swap = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const replaced = channel.replacing(() => swap);
  const held = channel.request("project.preview_tracking", {}, 60_000);
  // 교체가 끝나기 전에는 pipe에 아무것도 나가지 않는다.
  await new Promise((resolve) => setTimeout(resolve, 60));
  assertEquals(pipe.sent.length, 0);
  finish();
  await replaced;
  await new Promise((resolve) => setTimeout(resolve, 10));
  assertEquals(pipe.sent.length, 1);
  channel.onMessage(reply(pipe.sent[0].request_id, "new child"));
  const answer = await held;
  assert(answer.ok);
  assertEquals(answer.value, "new child");
});

Deno.test("platform/responsiveness#R3: 교체가 요청의 기한보다 오래 걸리면 그 요청은 보내지 않고 unavailable이다", async () => {
  const channel = createDocumentsChannel({ drainMs: 10 });
  const pipe = fakePipe();
  channel.bind(pipe.send);
  let finish: () => void = () => {};
  const replaced = channel.replacing(() =>
    new Promise<void>((resolve) => {
      finish = resolve;
    })
  );
  const answer = await channel.request("documents.search_ledger", {}, 50);
  assert(!answer.ok);
  assertEquals(answer.error.code, "unavailable");
  assertEquals(pipe.sent.length, 0);
  finish();
  await replaced;
});

Deno.test("platform/responsiveness#R3: 교체가 실패해 던져도 기다리던 요청은 풀려 보내진다", async () => {
  const channel = createDocumentsChannel({ drainMs: 10 });
  const pipe = fakePipe();
  channel.bind(pipe.send);
  const replaced = channel.replacing(() => Promise.reject(new Error("boom")));
  const held = channel.request("documents.search_ledger", {}, 5_000);
  await replaced.catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assertEquals(pipe.sent.length, 1);
  channel.onMessage(reply(pipe.sent[0].request_id, 1));
  assert((await held).ok);
});

Deno.test("platform/responsiveness#R3: coordinator가 끝나면(crash) 보낸 요청은 기한까지 기다리지 않고 바로 unavailable로 끝난다", async () => {
  const channel = createDocumentsChannel({ drainMs: 30 });
  const pipe = fakePipe();
  channel.bind(pipe.send);
  const lost = channel.request("documents.search_ledger", {}, 60_000);
  const other = channel.request("project.preview_tracking", {}, 60_000);
  channel.failPending("worker ended");
  for (const pendingRequest of [lost, other]) {
    const outcome = await settled(pendingRequest, 5_000);
    assert(outcome !== "late", "the request waited for its own deadline");
    assert(!outcome.ok);
    assertEquals(outcome.error.code, "unavailable");
  }
  // 끝난 요청의 늦은 응답은 버리고, 그 뒤 새 요청은 평소처럼 통한다.
  channel.onMessage(reply(pipe.sent[0].request_id, "late"));
  const next = channel.request("documents.search_ledger", {}, 5_000);
  await new Promise((resolve) => setTimeout(resolve, 10));
  channel.onMessage(reply(pipe.sent[2].request_id, "fresh"));
  const answer = await next;
  assert(answer.ok);
  assertEquals(answer.value, "fresh");
});

Deno.test("platform/responsiveness#R3: 교체가 겹쳐도 한 번에 하나씩 돈다", async () => {
  const channel = createDocumentsChannel({ drainMs: 10 });
  const pipe = fakePipe();
  channel.bind(pipe.send);
  const order: string[] = [];
  let finishFirst: () => void = () => {};
  const first = channel.replacing(() =>
    new Promise<void>((resolve) => {
      order.push("first start");
      finishFirst = () => {
        order.push("first end");
        resolve();
      };
    })
  );
  const second = channel.replacing(() => {
    order.push("second start");
    return Promise.resolve();
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assertEquals(order, ["first start"]);
  finishFirst();
  await Promise.all([first, second]);
  assertEquals(order, ["first start", "first end", "second start"]);
});

const CONTEXT: RequestContext = {
  principal: "user-1",
  actor: "user",
  scope: { operations: ["search.query", "search.status"], targets: {} },
  conditions: {},
  credential_ref: "cred-1",
};

// search 답 하나를 reader 대신 돌려주는 서빙 대상으로 forward 한 번을 보낸다.
async function searchOnce(
  key: "search/query" | "search/status",
  coverage: { lagging: boolean },
): Promise<number> {
  let woke = 0;
  const targets = servedWorkers({
    readers: {
      read: () => Promise.resolve(ok({ coverage, next_cursor: null })),
      health: () => ["healthy"],
    },
    current: () => ok(CONTEXT),
    observedAt: () => "2026-10-10T00:00:00.000Z",
    wakeSearch: () => {
      woke += 1;
    },
  });
  const target = targets.get(key);
  assert(target !== undefined);
  const answered = await target.handle.forward({
    type: "worker_request",
    request_id: "cred-1/1",
    op: key,
    payload: {},
  } as WorkerRequest);
  assert(answered.ok);
  assert(answered.value.ok);
  return woke;
}

Deno.test("documents/outline-and-search#R14: 뒤처진 search 답을 낸 읽기는 index를 깨우고 따라잡은 답은 깨우지 않는다", async () => {
  // feed는 documents event만 받아서 그 밖의 ledger 쓰기로 head가 앞서간 index는 읽기가 깨운다.
  assertEquals(await searchOnce("search/query", { lagging: true }), 1);
  assertEquals(await searchOnce("search/status", { lagging: true }), 1);
  assertEquals(await searchOnce("search/query", { lagging: false }), 0);
});
