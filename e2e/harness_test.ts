// contracts#T10 harness 확인: 화면 유무 판단, Electron 인자, 디버깅 target 선택,
// fixture 복사, 정확한 pid 정리가 정해진 대로 동작한다.
import { assert, assertEquals, assertThrows } from "@std/assert";

import {
  copyFixture,
  descendantPids,
  displayAvailable,
  e2eEnabled,
  electronArgs,
  pickPageTarget,
  processAlive,
  readEvaluation,
  signalPids,
} from "./harness.ts";

Deno.test("skeleton: DISPLAY가 없으면 E2E를 건너뛰고 있으면 돈다", () => {
  assertEquals(displayAvailable({}), false);
  assertEquals(displayAvailable({ DISPLAY: "" }), false);
  assertEquals(displayAvailable({ DISPLAY: ":0" }), true);
});

Deno.test("skeleton: Electron 인자는 원격 디버깅 포트와 임시 home만 담는다", () => {
  assertEquals(
    electronArgs({
      executable: "/bin/electron",
      app: "/app/main.cjs",
      home: "/tmp/lophn-e2e",
      port: 9333,
    }),
    [
      "--remote-debugging-port=9333",
      "/app/main.cjs",
      "--home",
      "/tmp/lophn-e2e",
    ],
  );
});

Deno.test("skeleton: 디버깅 target은 shell 페이지를 고르고 devtools는 제외한다", () => {
  const page = pickPageTarget([
    { type: "page", url: "devtools://devtools/bundled/inspector.html" },
    {
      type: "service_worker",
      url: "lophn-shell://app/sw.js",
      webSocketDebuggerUrl: "ws://sw",
    },
    {
      type: "page",
      url: "lophn-shell://app/desktop",
      webSocketDebuggerUrl: "ws://page",
      title: "lophn",
    },
    { type: "page", url: "about:blank", webSocketDebuggerUrl: "ws://blank" },
  ]);
  assertEquals(page?.webSocketDebuggerUrl, "ws://page");
  assertEquals(pickPageTarget([]), undefined);
});

Deno.test("skeleton: CDP 평가 응답에서 값을 꺼내고 오류는 던진다", () => {
  assertEquals(
    readEvaluation({ id: 1, result: { result: { value: "ready" } } }),
    "ready",
  );
  assertThrows(() => readEvaluation({ id: 2, error: { message: "boom" } }));
});

Deno.test("skeleton: fixture 디렉터리를 임시 폴더로 복사한다", async () => {
  const destination = await Deno.makeTempDir({ prefix: "lophn-fixture-" });
  try {
    const source = new URL("./fixtures/", import.meta.url).pathname;
    await copyFixture(source, `${destination}/copied`);
    const text = await Deno.readTextFile(`${destination}/copied/example.txt`);
    assert(text.includes("example fixture"));
  } finally {
    await Deno.remove(destination, { recursive: true });
  }
});

Deno.test("skeleton: 프로세스 트리는 정확한 pid만 모으고 없는 pid는 비어 있다", async () => {
  const self = descendantPids(Deno.pid);
  const pids = await self;
  assert(pids.includes(Deno.pid));
  assertEquals(await descendantPids(2_000_000_000), []);
  assertEquals(processAlive(Deno.pid), true);
  assertEquals(processAlive(2_000_000_000), false);
});

Deno.test("skeleton: 신호는 기록된 pid에만 보내고 없는 pid는 건너뛴다", () => {
  // 없는 pid에 보내도 예외가 나지 않는다. 넓은 패턴 정리는 쓰지 않는다.
  signalPids([2_000_000_000], "SIGTERM");
});

Deno.test("skeleton: flow는 deno task e2e가 켠 LOPHN_E2E와 화면이 있을 때만 돈다", () => {
  assertEquals(e2eEnabled({ DISPLAY: ":0" }), false);
  assertEquals(e2eEnabled({ DISPLAY: ":0", LOPHN_E2E: "1" }), true);
  assertEquals(e2eEnabled({ LOPHN_E2E: "1" }), false);
});
