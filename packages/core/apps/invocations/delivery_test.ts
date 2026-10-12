// 후행 전달(apps/invocations#R1, R2, R5, R18, R19)을 실제 앱 runtime entrypoint와 supervisor 쪽 broker·
// 전달 목록, 실제 core(temp LOPHN_HOME)의 record_* command로 본다. 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { createCoreHarness } from "../../testing/core.ts";
import { createLedgerRegistration } from "../register.ts";
import { FrameDecoder } from "../../../protocol/base/mod.ts";
import {
  INVOCATION_DELIVERY_BACKOFF_MAX_MS,
  INVOCATION_DELIVERY_MAX_BYTES,
  INVOCATION_DELIVERY_MAX_MESSAGES,
} from "../../../protocol/apps/mod.ts";
import { deliveryBackoffMs } from "./delivery/backoff.ts";
import {
  createDeliveryQueue,
  type DeliveryMessage,
  type DeliveryOutcome,
  type LossReport,
} from "./delivery/queue.ts";
import { deliveryKey, recordingMode } from "./mod.ts";
import { coreAccess, gatedSend } from "./testing/mod.ts";
import { installHandlers, openRuntimeWorld, REL } from "./world_test.ts";

const behavior = {
  save: (): unknown => ({ saved: true }),
  read: (): unknown => ({ rows: [] }),
  sync: (): unknown => ({ sent: true }),
  calls: { save: 0, read: 0, sync: 0 },
};

installHandlers([
  {
    command: "usage.save",
    handle: () => {
      behavior.calls.save += 1;
      return behavior.save();
    },
  },
  {
    command: "usage.read",
    handle: () => {
      behavior.calls.read += 1;
      return behavior.read();
    },
  },
  {
    command: "usage.sync",
    handle: () => {
      behavior.calls.sync += 1;
      return behavior.sync();
    },
  },
]);

const TEAMS = [{ createLedgerRegistration }];
const MODULES = [
  new URL("../register.ts", import.meta.url).href,
];

function reset() {
  behavior.save = () => ({ saved: true });
  behavior.read = () => ({ rows: [] });
  behavior.sync = () => ({ sent: true });
  behavior.calls = { save: 0, read: 0, sync: 0 };
}

async function openCore() {
  const opened = await createCoreHarness({
    teams: TEAMS,
    teamModules: MODULES,
    nowMs: Date.parse("2026-10-04T00:00:00.000Z"),
  });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  return opened.value;
}

function body(command: string, key: string) {
  return { request_key: key, release: REL, command };
}

function invocationOf(reply: { body?: unknown }): string {
  const id = (reply.body as { invocation?: string }).invocation;
  assert(id, "응답에 invocation이 있어야 한다");
  return id;
}

Deno.test("apps/invocations#R1 #R5: ledger 저장을 지연시켜도 일반 호출 응답이 먼저 오고 기록은 뒤에 반영된다", async () => {
  reset();
  const harness = await openCore();
  try {
    const access = await coreAccess(harness);
    const gated = gatedSend(access.send, false);
    const world = openRuntimeWorld({ clock: harness.clock, send: gated.send });
    const reply = await world.invoke(body("usage.save", "r1"));
    // core로 가는 전송이 막혀 있어도 업무 응답은 성공이다.
    assertEquals(reply.status, 200);
    assertEquals(behavior.calls.save, 1);
    const id = invocationOf(reply);
    assertEquals(gated.gate.sends.length, 0);
    assertEquals(await access.invocation(id), null);
    gated.gate.open();
    await world.delivery.queue.pump();
    const row = await access.invocation(id);
    assertEquals(row?.["status"], "succeeded");
    assertEquals(row?.["actor"], "user");
    assertEquals(row?.["caller"], { kind: "direct" });
    assertEquals(row?.["operation"], {
      kind: "command",
      command: "usage.save",
    });
    // 같은 요청을 다시 보내도 명령은 반복되지 않는다.
    const again = await world.invoke(body("usage.save", "r1"));
    assertEquals(again.status, 200);
    assertEquals(behavior.calls.save, 1);
  } finally {
    await harness.close();
  }
});

Deno.test("apps/invocations#R2: write·external·실패한 read·거절된 read는 남기고 성공한 일반 read 100회는 기록을 만들지 않는다", async () => {
  reset();
  const harness = await openCore();
  try {
    const access = await coreAccess(harness);
    const world = openRuntimeWorld({ clock: harness.clock, send: access.send });
    for (let index = 0; index < 100; index += 1) {
      const reply = await world.invoke(body("usage.read", `read-${index}`));
      assertEquals(reply.status, 200);
      assertEquals(
        (reply.body as { invocation?: string }).invocation,
        undefined,
      );
    }
    assertEquals(behavior.calls.read, 100);
    await world.delivery.queue.pump();
    assertEquals((await access.invocations()).length, 0);

    assertEquals((await world.invoke(body("usage.save", "w"))).status, 200);
    assertEquals((await world.invoke(body("usage.sync", "x"))).status, 200);
    behavior.read = () => {
      throw new Error("boom");
    };
    assertEquals((await world.invoke(body("usage.read", "bad"))).status, 500);
    // 연결 범위 밖의 read는 handler 전에 거절되고 거절 기록이 남는다.
    const refused = await world.invoke(body("usage.read", "denied"), {
      commands: ["usage.save"],
    });
    assertEquals(refused.status, 403);
    assertEquals(behavior.calls.read, 101);
    await world.delivery.queue.pump();
    const rows = await access.invocations();
    const summary = rows.map((row) => ({
      command: (row["operation"] as { command: string }).command,
      status: row["status"],
    }));
    assertEquals(
      summary.sort((a, b) =>
        `${a.command}${a.status}`.localeCompare(`${b.command}${b.status}`)
      ),
      [
        { command: "usage.read", status: "denied" },
        { command: "usage.read", status: "failed" },
        { command: "usage.save", status: "succeeded" },
        { command: "usage.sync", status: "succeeded" },
      ],
    );
    const denied = rows.find((row) => row["status"] === "denied");
    assertEquals(denied?.["started_at"], null);
    // 실패한 호출의 요약에 원문 오류는 없다.
    const failed = rows.find((row) => row["status"] === "failed");
    assert(!JSON.stringify(failed).includes("boom"));
  } finally {
    await harness.close();
  }
});

Deno.test("apps/invocations#R2: automation은 읽기도 남기고 confirm·앱 시작·데이터 변경은 항상 남기며 호출자 종류는 규칙을 바꾸지 않는다", () => {
  const read = { operation: "command", effect: "read" } as const;
  assertEquals(recordingMode({ ...read, trigger: "direct" }), "on_failure");
  assertEquals(
    recordingMode({ ...read, trigger: "automation" }),
    "always",
  );
  assertEquals(
    recordingMode({ ...read, confirm: true, trigger: "direct" }),
    "always",
  );
  assertEquals(
    recordingMode({ operation: "command", effect: "write", trigger: "direct" }),
    "always",
  );
  assertEquals(
    recordingMode({
      operation: "command",
      effect: "external",
      trigger: "direct",
    }),
    "always",
  );
  assertEquals(
    recordingMode({ operation: "start", trigger: "activation" }),
    "always",
  );
  assertEquals(
    recordingMode({ operation: "data_change", trigger: "direct" }),
    "always",
  );
});

Deno.test("apps/invocations#R18: 다른 앱과 agent가 부른 일반 성공 read는 기록이 없고 write 기록은 응답 뒤 caller와 함께 남는다", async () => {
  reset();
  const harness = await openCore();
  try {
    const access = await coreAccess(harness);
    const gated = gatedSend(access.send, false);
    const world = openRuntimeWorld({ clock: harness.clock, send: gated.send });
    const caller = "app_01h455vb4pex5v6nkc6gd5fdw8";
    const byApp = {
      actor: `app:${caller}`,
      caller: {
        kind: "app",
        app: caller,
        release: "rel_01h455vb4pex5v6nkc6gd5fdw8",
        process_nonce: "caller-nonce",
        grant: "grt_01h455vb4pex5v6nkc6gd5fdw8",
        parent_invocation: null,
        path: [caller],
      },
    };
    const byAgent = {
      actor: "agent:asg_01h455vb4pex5v6nkc6gd5fdw8",
      caller: {
        kind: "agent",
        run: "run_01h455vb4pex5v6nkc6gd5fdw8",
        tool_call: "tcl_01h455vb4pex5v6nkc6gd5fdw8",
      },
    };
    const writes: string[] = [];
    for (const [name, over] of [["app", byApp], ["agent", byAgent]] as const) {
      const read = await world.invoke(body("usage.read", `${name}-read`), over);
      assertEquals(read.status, 200);
      const write = await world.invoke(
        body("usage.save", `${name}-write`),
        over,
      );
      assertEquals(write.status, 200);
      writes.push(invocationOf(write));
    }
    // 응답은 이미 돌아왔고 기록은 아직 core에 없다.
    assertEquals(gated.gate.sends.length, 0);
    for (const id of writes) assertEquals(await access.invocation(id), null);
    gated.gate.open();
    await world.delivery.queue.pump();
    const rows = await access.invocations();
    assertEquals(rows.length, 2);
    const app = await access.invocation(writes[0]);
    assertEquals(app?.["actor"], byApp.actor);
    assertEquals((app?.["caller"] as { kind: string }).kind, "app");
    assertEquals(
      (app?.["caller"] as { parent_invocation: string | null })
        .parent_invocation,
      null,
    );
    const agent = await access.invocation(writes[1]);
    assertEquals(agent?.["actor"], byAgent.actor);
    assertEquals(agent?.["caller"], byAgent.caller);
  } finally {
    await harness.close();
  }
});

Deno.test("apps/invocations#R5: 업무가 성공한 뒤 전달을 끊어도 응답은 성공이고 명령은 반복되지 않으며 기록 메시지만 backoff로 다시 보낸다", async () => {
  reset();
  const harness = await openCore();
  try {
    const access = await coreAccess(harness);
    const sentAt: number[] = [];
    let refuse = 3;
    const world = openRuntimeWorld({
      clock: harness.clock,
      send: (message) => {
        sentAt.push(harness.clock.nowMs());
        if (message.fact === "start" && refuse > 0) {
          refuse -= 1;
          return Promise.resolve({ ok: false, code: "unavailable" });
        }
        return access.send(message);
      },
    });
    const reply = await world.invoke(body("usage.save", "once"));
    assertEquals(reply.status, 200);
    assertEquals(behavior.calls.save, 1);
    const id = invocationOf(reply);
    await world.delivery.queue.pump();
    // 전송은 실패했고 start가 막혀 있는 동안 finish도 순서를 기다린다.
    assertEquals(sentAt.length, 1);
    assertEquals(world.delivery.queue.size().messages, 2);
    const first = sentAt[0];
    // 1초·2초·4초 뒤에야 다시 보낸다. 시간이 차기 전에는 보내지 않는다.
    for (const wait of [1000, 2000, 4000]) {
      harness.clock.advance(wait - 1);
      await world.delivery.queue.pump();
      const before = sentAt.length;
      harness.clock.advance(1);
      await world.delivery.queue.pump();
      assert(sentAt.length > before, `${wait}ms 뒤에 다시 보내야 한다`);
    }
    assertEquals(sentAt.slice(0, 4).map((at) => at - first), [
      0,
      1000,
      3000,
      7000,
    ]);
    assertEquals(world.delivery.queue.size().messages, 0);
    assertEquals(behavior.calls.save, 1);
    assertEquals((await access.invocation(id))?.["status"], "succeeded");
  } finally {
    await harness.close();
  }
});

Deno.test("apps/invocations#R19: backoff는 1·2·4초부터 두 배씩 늘어 최대 30초다", () => {
  assertEquals(
    [1, 2, 3, 4, 5, 6, 7, 20].map(deliveryBackoffMs),
    [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000],
  );
  assertEquals(INVOCATION_DELIVERY_BACKOFF_MAX_MS, 30000);
});

function memoryQueue(
  send: (message: DeliveryMessage) => Promise<DeliveryOutcome>,
  clock: { nowMs(): number; now(): string },
  losses: LossReport[],
) {
  return createDeliveryQueue({
    send,
    clock,
    report: (loss) => losses.push(loss),
  });
}

function message(index: number, size = 0): DeliveryMessage {
  return {
    invocation: `inv_${index}`,
    fact: "start",
    app: "app_01h455vb4pex5v6nkc6gd5fdw1",
    body: { filler: "x".repeat(size) },
  };
}

Deno.test("apps/invocations#R19: 전체 4096 메시지에서 새 메시지를 버리고 손실 진단을 한 번 남기며 앞서 쌓은 메시지는 그대로다", async () => {
  const harness = await openCore();
  try {
    const losses: LossReport[] = [];
    // 전송이 끝나지 않아 목록이 줄지 않는다.
    const queue = memoryQueue(
      () => new Promise<DeliveryOutcome>(() => {}),
      harness.clock,
      losses,
    );
    for (let index = 0; index < INVOCATION_DELIVERY_MAX_MESSAGES; index += 1) {
      assertEquals(queue.enqueue(message(index)), "queued");
    }
    assertEquals(queue.size().messages, INVOCATION_DELIVERY_MAX_MESSAGES);
    assertEquals(queue.enqueue(message(99_999)), "lost");
    assertEquals(queue.enqueue(message(99_998)), "lost");
    assertEquals(queue.size().messages, INVOCATION_DELIVERY_MAX_MESSAGES);
    // 같은 key의 재전송은 한 메시지다.
    assertEquals(queue.enqueue(message(0)), "duplicate");
    queue.flushLoss();
    assertEquals(losses.map((loss) => [loss.reason, loss.lost_messages]), [
      ["memory_limit", 1],
      ["memory_limit", 1],
    ]);
    assert(losses[0].lost_bytes > 0);
    assertEquals(losses[0].app, "app_01h455vb4pex5v6nkc6gd5fdw1");
  } finally {
    await harness.close();
  }
});

Deno.test("apps/invocations#R19: 8MiB에 먼저 닿으면 그 한도에서 새 메시지를 버린다", async () => {
  const harness = await openCore();
  try {
    const losses: LossReport[] = [];
    const queue = memoryQueue(
      () => new Promise<DeliveryOutcome>(() => {}),
      harness.clock,
      losses,
    );
    const chunk = 1_000_000;
    let queued = 0;
    for (let index = 0; index < 20; index += 1) {
      if (queue.enqueue(message(index, chunk)) === "queued") queued += 1;
    }
    assertEquals(
      queued,
      Math.floor(INVOCATION_DELIVERY_MAX_BYTES / (chunk + 200)),
    );
    assert(queue.size().bytes <= INVOCATION_DELIVERY_MAX_BYTES);
    queue.flushLoss();
    assertEquals(losses[0].reason, "memory_limit");
    assertEquals(
      losses.reduce((sum, loss) => sum + loss.lost_messages, 0),
      20 - queued,
    );
  } finally {
    await harness.close();
  }
});

Deno.test("apps/invocations#R19: unauthorized·conflict·invalid_input은 반복하지 않고 손실 진단이 되며 unavailable만 다시 보낸다", async () => {
  const harness = await openCore();
  try {
    const attempts = new Map<string, number>();
    const codes = ["unauthorized", "conflict", "invalid_input", "unavailable"];
    const losses: LossReport[] = [];
    const queue = memoryQueue(
      (sent) => {
        const code = (sent.body as { code: string }).code;
        attempts.set(code, (attempts.get(code) ?? 0) + 1);
        return Promise.resolve({ ok: false, code });
      },
      harness.clock,
      losses,
    );
    codes.forEach((code, index) => {
      const sent = message(index);
      sent.body = { code };
      queue.enqueue(sent);
    });
    await queue.pump();
    harness.clock.advance(60_000);
    await queue.pump();
    assertEquals(attempts.get("unauthorized"), 1);
    assertEquals(attempts.get("conflict"), 1);
    assertEquals(attempts.get("invalid_input"), 1);
    assert((attempts.get("unavailable") ?? 0) >= 2);
    queue.flushLoss();
    assertEquals(
      losses.reduce((sum, loss) => sum + loss.lost_messages, 0),
      3,
    );
    assert(losses.every((loss) => loss.reason === "non_retryable_error"));
    // 재시도하는 하나만 남아 있다.
    assertEquals(queue.size().messages, 1);
  } finally {
    await harness.close();
  }
});

Deno.test("apps/invocations#R19 #R5: 한도 초과 손실은 앱 응답을 막지 않고 redaction된 숫자만 진단 frame으로 core에 나간다", async () => {
  reset();
  const harness = await openCore();
  try {
    const world = openRuntimeWorld({
      clock: harness.clock,
      send: () => new Promise<DeliveryOutcome>(() => {}),
      limits: { messages: 1, bytes: INVOCATION_DELIVERY_MAX_BYTES },
    });
    const first = await world.invoke(body("usage.save", "one"));
    const second = await world.invoke(body("usage.save", "two"));
    assertEquals([first.status, second.status], [200, 200]);
    assertEquals(behavior.calls.save, 2);
    assert(world.frames.length > 0);
    const decoder = new FrameDecoder();
    const frames = world.frames.flatMap((frame) => decoder.push(frame));
    const diagnostics = frames.flatMap((frame) =>
      frame.kind === "json"
        ? [
          frame.payload as {
            type: string;
            kind: string;
            payload: Record<string, unknown>;
          },
        ]
        : []
    );
    assert(diagnostics.length > 0);
    const loss = diagnostics[0];
    assertEquals(loss.type, "diagnostic");
    assertEquals(loss.kind, "app_invocation_delivery_loss");
    assertEquals(loss.payload["reason"], "memory_limit");
    assertEquals(loss.payload["component"], "apps/supervisor");
    // 진단은 숫자와 ID만 담고 메시지 내용이나 업무 값은 없다.
    assert(!JSON.stringify(loss).includes("usage.save"));
  } finally {
    await harness.close();
  }
});

Deno.test("apps/invocations#R6: 한 호출의 종료 사실은 시작이 전달되기 전에는 보내지 않고 같은 사실 재전송은 한 메시지다", async () => {
  const harness = await openCore();
  try {
    const sent: string[] = [];
    let failStart = true;
    const queue = memoryQueue(
      (item) => {
        sent.push(deliveryKey(item.invocation, item.fact));
        if (item.fact === "start" && failStart) {
          return Promise.resolve({ ok: false, code: "unavailable" });
        }
        return Promise.resolve({ ok: true });
      },
      harness.clock,
      [],
    );
    const start = message(1);
    const finish = { ...start, fact: "finish" as const };
    assertEquals(queue.enqueue(finish), "queued");
    assertEquals(queue.enqueue(start), "queued");
    assertEquals(queue.enqueue({ ...start }), "duplicate");
    // finish를 먼저 올려도 start가 있는 동안은 start부터 보낸다.
    await queue.pump();
    assertEquals(sent, [deliveryKey(start.invocation, "start")]);
    failStart = false;
    harness.clock.advance(1000);
    await queue.pump();
    assertEquals(sent.length, 3);
    assertEquals(sent[2], deliveryKey(start.invocation, "finish"));
    assertEquals(queue.size().messages, 0);
  } finally {
    await harness.close();
  }
});

Deno.test("apps/invocations#R5: broker는 자식 연결이 아닌 신원 주장과 신원 필드를 덮어쓰는 사실을 거절한다", async () => {
  reset();
  const harness = await openCore();
  try {
    const access = await coreAccess(harness);
    const world = openRuntimeWorld({ clock: harness.clock, send: access.send });
    const child = {
      app: "app_01h455vb4pex5v6nkc6gd5fdw1",
      release: REL,
      mode: "live" as const,
      processNonce: "nonce-1",
    };
    const fact = {
      operation: { kind: "command", command: "usage.save" },
      trigger: { kind: "direct" },
      caller: { kind: "direct" },
      actor: "user",
      started_at: harness.clock.now(),
    };
    const submit = (extra: Record<string, unknown>, over = {}) =>
      world.delivery.broker.submit({ ...child, ...over }, {
        process_nonce: "nonce-1",
        mode: "live",
        invocation: "inv_01h455vb4pex5v6nkc6gd5fdw1",
        fact: "start",
        summary: { ...fact, ...extra },
      });
    const forged = submit({ app: "app_01h455vb4pex5v6nkc6gd5fdw9" });
    assert(!forged.ok && forged.error.code === "invalid_input");
    const other = submit({}, { processNonce: "nonce-2" });
    assert(!other.ok && other.error.code === "unauthorized");
    assertEquals(world.delivery.queue.size().messages, 0);
    assert(submit({}).ok);
    await world.delivery.queue.pump();
  } finally {
    await harness.close();
  }
});
