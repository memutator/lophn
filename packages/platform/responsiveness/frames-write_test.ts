import { assert, assertEquals, assertRejects } from "@std/assert";
import { createFrameWriter } from "./frames.ts";

Deno.test("platform/responsiveness#R3: 쓰기 기한을 넘기면 쓰던 frame과 줄 선 frame이 오류로 끝나고 writer는 fault다", async () => {
  let timeouts = 0;
  const bytesSeen: number[] = [];
  const release: (() => void)[] = [];
  const writer = createFrameWriter({
    write: (bytes: Uint8Array) => {
      bytesSeen.push(bytes.length);
      return new Promise<number>((resolve) => {
        // 상대가 읽지 않는다. 기한 뒤에 풀려도 이미 버린 frame의 나머지는 잇지 않는다.
        release.push(() => resolve(Math.max(1, bytes.length - 1)));
      });
    },
  }, { writeMs: 40, onTimeout: () => timeouts += 1 });
  const first = writer.writeJson({ type: "worker_request" });
  const second = writer.writeBytes(3, new Uint8Array([1, 2, 3]));
  const failures = await Promise.allSettled([first, second]);
  for (const failure of failures) {
    assertEquals(failure.status, "rejected");
    if (failure.status === "rejected") {
      assert(String(failure.reason).includes("timed out"));
    }
  }
  assertEquals(writer.faulted, true);
  assertEquals(timeouts, 1);
  await assertRejects(() => writer.writeJson({ type: "later" }), Error);
  // 늦게 깨어난 write가 끊긴 frame의 나머지를 이어 쓰지 않는다.
  for (const wake of release.splice(0)) wake();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assertEquals(bytesSeen.length, 1);
});

Deno.test("platform/responsiveness#R3: 기한 안에 끝나는 쓰기는 기한에 걸리지 않는다", async () => {
  let timeouts = 0;
  const writer = createFrameWriter({
    write: (bytes: Uint8Array) =>
      new Promise<number>((resolve) =>
        setTimeout(() => resolve(bytes.length), 5)
      ),
  }, { writeMs: 2_000, onTimeout: () => timeouts += 1 });
  await writer.writeJson({ type: "a" });
  await writer.writeJson({ type: "b" });
  assertEquals(writer.faulted, false);
  assertEquals(timeouts, 0);
});
