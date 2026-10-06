import { assert, assertEquals } from "@std/assert";
import type {
  ChildMessage,
  KindLaunchSpec,
} from "../../../packages/contracts/platform/mod.ts";
import type {
  ChildCallbacks,
  Supervisor,
} from "../../../packages/platform/responsiveness/mod.ts";
import { createPreparationPool, PREPARATION_KIND } from "./pool.ts";

function spec(name: string): KindLaunchSpec {
  return {
    kind: PREPARATION_KIND,
    entry: "/repo/preparation-entry.ts",
    allow_read: [name],
    allow_write: [],
    allow_net: [],
    allow_run: [],
    allow_sys: [],
    allow_env: [],
    policy: "on_request",
    memory_limit_bytes: 1,
  };
}

type Fake = {
  id: number;
  spec?: KindLaunchSpec;
  sent: { op: string; channel?: number; payload: unknown }[];
  bytes: { channel: number; length: number }[];
  stopped: boolean;
  callbacks?: ChildCallbacks;
};

type Behavior = {
  // 요청을 받았을 때. undefined를 돌려주면 답하지 않는다(기한 시험).
  answer?(fake: Fake, op: string, payload: unknown): unknown;
  startOk?: boolean;
  // 답을 늦춘다. 동시에 몇 개가 진행 중인지 본다.
  delayMs?: number;
};

function fakeSupervisors(behavior: Behavior = {}) {
  const supervisors: Fake[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const create = (() => {
    const fake: Fake = {
      id: supervisors.length,
      sent: [],
      bytes: [],
      stopped: false,
    };
    supervisors.push(fake);
    const supervisor = {
      start(
        launched: unknown,
        _hello: unknown,
        callbacks: ChildCallbacks,
      ) {
        fake.spec = launched as KindLaunchSpec;
        fake.callbacks = callbacks;
        return Promise.resolve(
          behavior.startOk === false
            ? { ok: false as const, code: "unavailable" as const }
            : { ok: true as const },
        );
      },
      send(_kind: string, payload: unknown) {
        const message = payload as {
          op: string;
          request_id: string;
          channel?: number;
          payload: unknown;
        };
        fake.sent.push({
          op: message.op,
          channel: message.channel,
          payload: message.payload,
        });
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        setTimeout(() => {
          inFlight -= 1;
          const answer = behavior.answer
            ? behavior.answer(fake, message.op, message.payload)
            : { slot: fake.id, op: message.op };
          if (answer === undefined) return;
          fake.callbacks?.onMessage({
            type: "worker_response",
            request_id: message.request_id,
            ok: true,
            payload: answer,
          } as ChildMessage);
        }, behavior.delayMs ?? 0);
        return Promise.resolve({ ok: true as const });
      },
      sendBytes(_kind: string, channel: number, payload: Uint8Array) {
        fake.bytes.push({ channel, length: payload.length });
        return Promise.resolve({ ok: true as const });
      },
      stopAll() {
        fake.stopped = true;
        return Promise.resolve(true);
      },
    };
    return supervisor as unknown as Supervisor;
  }) as unknown as typeof import("../../../packages/platform/responsiveness/mod.ts").createSupervisor;
  return {
    create,
    supervisors,
    get maxInFlight() {
      return maxInFlight;
    },
  };
}

function poolOver(
  fakes: ReturnType<typeof fakeSupervisors>,
  extra: { signature?: () => string; specName?: () => string } = {},
) {
  return createPreparationPool({
    specFor: () => spec(extra.specName?.() ?? "roots"),
    ...(extra.signature ? { signature: extra.signature } : {}),
    denoCommand: "/deno",
    env: () => ({}),
    createSupervisor: fakes.create,
  });
}

Deno.test("documents/file-tracking#R5: 준비 worker는 두 slot뿐이고 사람 요청은 human slot을 먼저, 바쁘면 background slot으로 흘린다", async () => {
  const fakes = fakeSupervisors({ delayMs: 40 });
  const pool = poolOver(fakes);
  const answers = await Promise.all([
    pool.request({ op: "a", payload: {}, priority: "human" }),
    pool.request({ op: "b", payload: {}, priority: "human" }),
    pool.request({ op: "c", payload: {}, priority: "human" }),
  ]);
  assert(answers.every((answer) => answer.ok));
  // 동시에 진행한 요청은 slot 수 둘을 넘지 않고, worker 프로세스도 둘이다.
  assertEquals(fakes.maxInFlight, 2);
  assertEquals(fakes.supervisors.length, 2);
  const slots = answers.map((answer) =>
    (answer as { value: { slot: number } }).value.slot
  );
  assertEquals(slots[0], 0);
  assertEquals(slots[1], 1);
  await pool.stop();
});

Deno.test("documents/file-tracking#R5: 기다리는 사람 요청이 있으면 놀게 된 human slot은 background 요청보다 먼저 받는다", async () => {
  const fakes = fakeSupervisors({ delayMs: 30 });
  const pool = poolOver(fakes);
  const order: string[] = [];
  const run = (label: string, priority: "human" | "background") =>
    pool.request({ op: label, payload: {}, priority }).then(() =>
      order.push(label)
    );
  // 두 slot을 background 일로 채운 뒤, background 하나와 사람 하나가 줄을 선다.
  const running = [
    run("bg-1", "background"),
    run("bg-2", "background"),
  ];
  await new Promise((resolve) => setTimeout(resolve, 5));
  const queued = [run("bg-3", "background"), run("human-1", "human")];
  await Promise.all([...running, ...queued]);
  // 사람 요청이 줄에 늦게 들어왔어도 background 요청 뒤로 밀리지 않고 첫 빈 slot을 받는다.
  assertEquals(order.indexOf("human-1") < order.indexOf("bg-3"), true);
  await pool.stop();
});

Deno.test("documents/file-tracking#R11: 같은 목표 key의 요청은 두 slot이 비어 있어도 줄을 선다", async () => {
  const fakes = fakeSupervisors({ delayMs: 30 });
  const pool = poolOver(fakes);
  const started = Date.now();
  await Promise.all([
    pool.request({ op: "w1", payload: {}, priority: "human", keys: ["/a.md"] }),
    pool.request({ op: "w2", payload: {}, priority: "human", keys: ["/a.md"] }),
  ]);
  assertEquals(fakes.maxInFlight, 1);
  assert(Date.now() - started >= 55);
  // 다른 key는 동시에 간다.
  const parallel = fakeSupervisors({ delayMs: 30 });
  const other = poolOver(parallel);
  await Promise.all([
    other.request({
      op: "w1",
      payload: {},
      priority: "human",
      keys: ["/a.md"],
    }),
    other.request({
      op: "w2",
      payload: {},
      priority: "human",
      keys: ["/b.md"],
    }),
  ]);
  assertEquals(parallel.maxInFlight, 2);
  await pool.stop();
  await other.stop();
});

Deno.test("documents/file-tracking#R5: 바이트는 요청 앞에 작은 chunk로 가고 요청 payload가 그 channel을 가리킨다", async () => {
  const fakes = fakeSupervisors();
  const pool = poolOver(fakes);
  const bytes = new Uint8Array(600 * 1024);
  const answer = await pool.request({
    op: "documents.write_file",
    payload: (channel) => ({ content: { channel } }),
    bytes,
    priority: "human",
  });
  assert(answer.ok);
  const [fake] = fakes.supervisors;
  assertEquals(fake.bytes.map((chunk) => chunk.length), [
    256 * 1024,
    256 * 1024,
    600 * 1024 - 512 * 1024,
  ]);
  const channel = fake.bytes[0].channel;
  assert(channel >= 1);
  assertEquals(fake.bytes.every((chunk) => chunk.channel === channel), true);
  assertEquals(fake.sent[0].channel, channel);
  assertEquals(fake.sent[0].payload, { content: { channel } });
  await pool.stop();
});

Deno.test("documents/file-tracking#R5: 답이 기한 안에 없으면 unavailable이고 성공으로 꾸미지 않는다", async () => {
  const fakes = fakeSupervisors({ answer: () => undefined });
  const pool = poolOver(fakes);
  const answer = await pool.request({
    op: "slow",
    payload: {},
    priority: "human",
    timeoutMs: 50,
  });
  assert(!answer.ok);
  assertEquals(answer.error.code, "unavailable");
  // 기한이 지난 slot도 다음 요청을 받는다.
  const behavior = fakeSupervisors({ answer: (_fake, op) => ({ op }) });
  const next = poolOver(behavior);
  assert((await next.request({ op: "x", payload: {}, priority: "human" })).ok);
  await pool.stop();
  await next.stop();
});

Deno.test("documents/file-tracking#R5: 띄우지 못한 worker는 unavailable이고 다음 요청이 다시 띄운다", async () => {
  const behavior: Behavior = { startOk: false };
  const fakes = fakeSupervisors(behavior);
  const pool = poolOver(fakes);
  const failed = await pool.request({
    op: "x",
    payload: {},
    priority: "human",
  });
  assert(!failed.ok);
  assertEquals(failed.error.code, "unavailable");
  behavior.startOk = true;
  const retried = await pool.request({
    op: "x",
    payload: {},
    priority: "human",
  });
  assert(retried.ok);
  assertEquals(fakes.supervisors.length, 2);
  // 실패한 감독은 멈춘다.
  assertEquals(fakes.supervisors[0].stopped, true);
  await pool.stop();
});

Deno.test("documents/file-tracking#R8: 등록 root 근거가 달라지면 다음 요청이 worker를 새 권한으로 다시 띄운다", async () => {
  const fakes = fakeSupervisors();
  let roots = "";
  const pool = poolOver(fakes, {
    signature: () => roots,
    specName: () => roots || "none",
  });
  assert((await pool.request({ op: "a", payload: {}, priority: "human" })).ok);
  assertEquals(fakes.supervisors[0].spec?.allow_read, ["none"]);
  roots = "/work/notes";
  assert((await pool.request({ op: "b", payload: {}, priority: "human" })).ok);
  assertEquals(fakes.supervisors[0].stopped, true);
  assertEquals(fakes.supervisors[1].spec?.allow_read, ["/work/notes"]);
  // 같은 근거면 다시 띄우지 않는다.
  assert((await pool.request({ op: "c", payload: {}, priority: "human" })).ok);
  assertEquals(fakes.supervisors.length, 2);
  await pool.stop();
});

Deno.test("documents/file-tracking#R5: 한 번만 쓰는 worker는 그 요청의 권한으로 띄워 한 요청을 보내고 반드시 멈춘다", async () => {
  const fakes = fakeSupervisors();
  const pool = poolOver(fakes);
  const done = await pool.requestOnce(spec("/only/this/folder"), {
    op: "project.preview_tracking",
    payload: { a: 1 },
  });
  assert(done.ok);
  assertEquals(fakes.supervisors[0].spec?.allow_read, ["/only/this/folder"]);
  assertEquals(fakes.supervisors[0].stopped, true);
  const failing = fakeSupervisors({ startOk: false });
  const refused = await poolOver(failing).requestOnce(spec("/x"), {
    op: "x",
    payload: {},
  });
  assert(!refused.ok);
  assertEquals(refused.error.code, "unavailable");
  assertEquals(failing.supervisors[0].stopped, true);
  await pool.stop();
});

Deno.test("documents/file-tracking#R5: pool을 멈추면 진행 중인 요청은 unavailable이고 worker를 모두 멈춘다", async () => {
  const fakes = fakeSupervisors({ answer: () => undefined });
  const pool = poolOver(fakes);
  const pending = pool.request({
    op: "never",
    payload: {},
    priority: "human",
    timeoutMs: 10_000,
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  await pool.stop();
  const answer = await pending;
  assert(!answer.ok);
  assertEquals(answer.error.code, "unavailable");
  assertEquals(fakes.supervisors.every((fake) => fake.stopped), true);
  const after = await pool.request({ op: "x", payload: {}, priority: "human" });
  assert(!after.ok);
});
