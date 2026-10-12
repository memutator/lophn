// 시험용 신뢰 자식. 실제 process·실제 감독 pipe에서 session.prepareBlob을 부른다.
// worker_request의 payload가 시나리오를 정한다. 제품 코드는 이 파일을 import하지 않는다.
import { startChild } from "../../../packages/core/supervision/responsiveness/mod.ts";

export type Scenario = {
  purpose: string;
  size: number;
  // ok: 전부 보낸다. abort_midway: 절반을 보내고 원천이 실패한다.
  mode: "ok" | "abort_midway";
};

export function patternBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 31 + 7) % 251;
  return bytes;
}

async function* source(scenario: Scenario): AsyncGenerator<Uint8Array> {
  const data = patternBytes(scenario.size);
  const limit = scenario.mode === "abort_midway"
    ? scenario.size >> 1
    : scenario.size;
  for (let offset = 0; offset < limit; offset += 300 * 1024) {
    yield data.subarray(offset, Math.min(limit, offset + 300 * 1024));
    await Promise.resolve();
  }
  if (scenario.mode === "abort_midway") throw new Error("source failed");
}

if (import.meta.main) {
  console.log =
    console.info =
    console.debug =
    console.error =
      () => {};
  const session = startChild(
    {
      stdin: { read: (buffer) => Deno.stdin.read(buffer) },
      stdout: { write: (bytes) => Deno.stdout.write(bytes) },
      stderr: { write: (bytes) => Deno.stderr.write(bytes) },
    },
    {
      onHello: () => session.send({ type: "ready" }),
      onStop: () => session.send({ type: "stopped" }),
      async onParent(message) {
        if (message.type !== "worker_request") return;
        const scenario = message.payload as Scenario;
        const result = await session.prepareBlob({
          purpose: scenario.purpose,
          sizeBytes: scenario.size,
          bytes: source(scenario),
        });
        await session.send(
          result.ok
            ? {
              type: "worker_response",
              request_id: message.request_id,
              ok: true,
              payload: result.value,
            }
            : {
              type: "worker_response",
              request_id: message.request_id,
              ok: false,
              error: result.error,
            },
        );
      },
    },
  );
  await session.run().catch(() => {});
  Deno.exit(0);
}
