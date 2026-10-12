// platform/secrets#R1 R2 R8: I/O worker의 `secret.prepare`. 값은 요청 json에 앞서 온 byte chunk로만
// 받고(JSON에는 용도·owner뿐), 응답은 값 없는 준비 증거이며 값은 keychain adapter에만 간다.
// keychain은 fake다(사람의 실제 keychain에 닿지 않는다). worker는 같은 process의 실제
// `createPlatformIo`이고 core 쪽은 제품과 같은 frame pipe다.
import { assert, assertEquals } from "@std/assert";
import {
  encodeFrame,
  type Frame,
  FrameDecoder,
} from "../../../protocol/base/mod.ts";
import {
  SECRET_INPUT_MAX_BYTES,
  SECRET_PREPARE_OP,
} from "../../../protocol/secrets/mod.ts";
import {
  createFakeKeychain,
  createSecretWork,
  type FakeKeychain,
} from "../mod.ts";
import { inProcessIo } from "../../testing/in-process-io.ts";
import { createSecretPipe } from "./pipe.ts";

const VALUE = "protected-input-value-4711";
const CONTEXT = {
  principal: "machine:secret-input",
  actor: "machine",
  scope: { operations: [SECRET_PREPARE_OP], targets: {} },
  conditions: { process: "platform/io", task: "secret-input" },
  credential_ref: "machine:secret-input",
};

type Worker = {
  keychain: FakeKeychain;
  channel: number;
  send(frame: Frame): Promise<void>;
  request(requestId: string, channel: number | undefined): Promise<Frame>;
  stop(): Promise<void>;
};

async function open(withSecrets: boolean): Promise<Worker> {
  const root = await Deno.makeTempDir({ prefix: "lophn-io-secret-" });
  const keychain = createFakeKeychain();
  const io = inProcessIo({
    root,
    secrets: withSecrets
      ? createSecretPipe({
        work: createSecretWork({
          keychain,
          preparationId: () => `prep_${crypto.randomUUID()}`,
        }),
      })
      : undefined,
  });
  const child = io.spawn({
    command: "deno",
    args: [],
    env: { LOPHN_WORKER_KIND: "platform/io" },
  });
  const decoder = new FrameDecoder();
  const frames: Frame[] = [];
  const buffer = new Uint8Array(64 * 1024);
  const pump = (async () => {
    for (;;) {
      const count = await child.stdout.read(buffer);
      if (count === null) return;
      frames.push(...decoder.push(buffer.subarray(0, count)));
    }
  })();
  const send = (frame: Frame) => child.stdin.write(encodeFrame(frame));
  const next = async (match: (payload: Record<string, unknown>) => boolean) => {
    for (let i = 0; i < 500; i++) {
      const found = frames.find((frame) =>
        frame.kind === "json" &&
        match(frame.payload as Record<string, unknown>)
      );
      if (found !== undefined) return found;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("worker did not answer");
  };
  await send({
    kind: "json",
    channel: 0,
    payload: {
      type: "hello",
      core_epoch: "epoch",
      process_identity: "process",
      kind: "platform/io",
      task: "diagnostics",
      scope: { operations: [], targets: {} },
      credential: "token-never-record",
      api_port: 7431,
    },
  });
  await next((payload) => payload["type"] === "ready");
  return {
    keychain,
    channel: 0x80000001,
    send,
    async request(requestId, channel) {
      await send({
        kind: "json",
        channel: 0,
        payload: {
          type: "worker_request",
          request_id: requestId,
          op: SECRET_PREPARE_OP,
          ...(channel === undefined ? {} : { channel }),
          payload: {
            context: CONTEXT,
            purpose: "app_secret",
            owner: "service.key",
          },
        },
      });
      return await next((payload) => payload["request_id"] === requestId);
    },
    async stop() {
      await send({
        kind: "json",
        channel: 0,
        payload: { type: "stop", grace_ms: 10 },
      });
      await child.exited;
      await pump;
      await Deno.remove(root, { recursive: true });
    },
  };
}

function payloadOf(frame: Frame): Record<string, unknown> {
  assertEquals(frame.kind, "json");
  return (frame as { payload: Record<string, unknown> }).payload;
}

Deno.test("platform/secrets#R2: secret.prepare는 요청 앞에 온 byte chunk만 값으로 받고 응답에는 값 없는 준비 증거만 있다", async () => {
  const worker = await open(true);
  try {
    // 값은 두 chunk로 나뉘어 와도 이어 붙여 한 값이 된다.
    const bytes = new TextEncoder().encode(VALUE);
    await worker.send({
      kind: "bytes",
      channel: worker.channel,
      payload: bytes.subarray(0, 5),
    });
    await worker.send({
      kind: "bytes",
      channel: worker.channel,
      payload: bytes.subarray(5),
    });
    const answered = payloadOf(await worker.request("r1", worker.channel));
    assertEquals(answered["ok"], true);
    const evidence = answered["payload"] as Record<string, string>;
    assertEquals(
      Object.keys(evidence).sort(),
      ["owner", "preparation", "purpose", "sealed_ref"],
    );
    assertEquals(evidence["purpose"], "app_secret");
    assertEquals(evidence["owner"], "service.key");
    assert(!JSON.stringify(answered).includes(VALUE));
    const stored = await worker.keychain.load(evidence["sealed_ref"]!);
    assert(stored.ok);
    assertEquals(new TextDecoder().decode(stored.value), VALUE);
  } finally {
    await worker.stop();
  }
});

Deno.test("platform/secrets#R2: core가 요청 전에 abort한 channel의 chunk는 버려지고 같은 channel의 요청은 값이 없다", async () => {
  const worker = await open(true);
  try {
    await worker.send({
      kind: "bytes",
      channel: worker.channel,
      payload: new TextEncoder().encode(VALUE),
    });
    await worker.send({ kind: "abort", channel: worker.channel });
    const answered = payloadOf(await worker.request("r2", worker.channel));
    assertEquals(answered["ok"], false);
    assertEquals(
      (answered["error"] as { code: string }).code,
      "invalid_input",
    );
    assertEquals(worker.keychain.stored.size, 0);
  } finally {
    await worker.stop();
  }
});

Deno.test("platform/secrets#R2: 상한을 넘는 값은 keychain에 두지 않고 거절한다", async () => {
  const worker = await open(true);
  try {
    await worker.send({
      kind: "bytes",
      channel: worker.channel,
      payload: new Uint8Array(SECRET_INPUT_MAX_BYTES + 1).fill(97),
    });
    const answered = payloadOf(await worker.request("r3", worker.channel));
    assertEquals(answered["ok"], false);
    assertEquals(
      (answered["error"] as { code: string }).code,
      "invalid_input",
    );
    assertEquals(worker.keychain.stored.size, 0);
  } finally {
    await worker.stop();
  }
});

Deno.test("platform/secrets#R8: keychain을 쓸 수 없으면 unavailable이고 아무것도 두지 않으며 보호 입력 통로가 없는 worker도 unavailable이다", async () => {
  const locked = await open(true);
  try {
    locked.keychain.setStatus("unavailable");
    await locked.send({
      kind: "bytes",
      channel: locked.channel,
      payload: new TextEncoder().encode(VALUE),
    });
    const answered = payloadOf(await locked.request("r4", locked.channel));
    assertEquals(answered["ok"], false);
    assertEquals(
      (answered["error"] as { code: string }).code,
      "unavailable",
    );
    assertEquals(locked.keychain.stored.size, 0);
    assert(!JSON.stringify(answered).includes(VALUE));
  } finally {
    await locked.stop();
  }
  const closed = await open(false);
  try {
    await closed.send({
      kind: "bytes",
      channel: closed.channel,
      payload: new TextEncoder().encode(VALUE),
    });
    const answered = payloadOf(await closed.request("r5", closed.channel));
    assertEquals(answered["ok"], false);
    assertEquals(
      (answered["error"] as { code: string }).code,
      "unavailable",
    );
    assertEquals(closed.keychain.stored.size, 0);
  } finally {
    await closed.stop();
  }
});
