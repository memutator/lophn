import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import type { InvokeRequest } from "./app-invoke.ts";
import {
  BLOCKED_PER_SCREEN,
  bundleUpstream,
  createScreenTestCall,
  createScreenTestRecorder,
  ERROR_MESSAGE_MAX_CHARS,
  ERRORS_PER_SCREEN,
  fitsFrame,
  FRAME_MAX_BYTES,
  readFrame,
  runScreenTest,
  type ScreenEntry,
  screenEntryUrl,
  type ScreenSurface,
  type ScreenTestInput,
  screenTestPartition,
  type ScreenTestPorts,
} from "./screen-test-host.ts";

function input(
  screens: ScreenEntry[],
  deadline_ms = 100_000,
): ScreenTestInput {
  return {
    bundle_screens_dir: "/bundle/screens",
    screens,
    app_socket_path: "/tmp/app.sock",
    deadline_ms,
  };
}

/** 시계는 wait와 화면 열기에서만 간다. 멈춘 화면은 loaded가 끝나지 않는다. */
function fakePorts(behavior: Record<string, "ok" | "hang" | "crash">) {
  let clock = 0;
  const opened: string[] = [];
  const closed: string[] = [];
  const ports: ScreenTestPorts = {
    now: () => clock,
    wait: (ms) =>
      Promise.resolve().then(() => {
        clock += ms;
      }),
    open(screen): ScreenSurface {
      opened.push(screen.key);
      clock += 1;
      const kind = behavior[screen.key] ?? "ok";
      return {
        loaded: kind === "hang" ? new Promise(() => {}) : Promise.resolve(
          kind === "ok" ? { ok: true } : { ok: false, reason: "ERR_FAILED" },
        ),
        bound: () => kind !== "crash",
        capture: () => Promise.resolve(kind === "ok"),
        close: () => void closed.push(screen.key),
      };
    },
    openDialog: () => Promise.resolve(true),
  };
  return { ports, opened, closed };
}

test("problems/tests#R7: 화면마다 load를 보고 깨진 view(멈춤·죽음)에서도 feedback 경로를 본다", async () => {
  const { ports, opened, closed } = fakePorts({ hang: "hang", gone: "crash" });
  const recorder = createScreenTestRecorder();
  await runScreenTest(
    input([
      { key: "main", path: "main/index.html" },
      { key: "hang", path: "hang/index.html" },
      { key: "gone", path: "gone/index.html" },
    ]),
    ports,
    recorder,
  );
  const observation = recorder.observation();
  assert.deepEqual(observation.load, [
    { screen: "main", ok: true, reason: null },
    { screen: "hang", ok: false, reason: "timeout" },
    { screen: "gone", ok: false, reason: "ERR_FAILED" },
  ]);
  assert.deepEqual(observation.feedback_check, [
    { screen: "main", binding: true, capture: "captured", dialog: "opened" },
    { screen: "hang", binding: true, capture: "missing", dialog: "opened" },
    { screen: "gone", binding: false, capture: "missing", dialog: "opened" },
  ]);
  assert.deepEqual(opened, ["main", "hang", "gone"]);
  assert.deepEqual(closed, opened);
});

test("problems/tests#R7: 기한이 지난 화면은 열지 않고 deadline으로 남긴다", async () => {
  const { ports, opened } = fakePorts({});
  const recorder = createScreenTestRecorder();
  await runScreenTest(
    input([
      { key: "main", path: "main/index.html" },
      { key: "late", path: "late/index.html" },
    ], 1),
    ports,
    recorder,
  );
  assert.deepEqual(opened, ["main"]);
  assert.deepEqual(recorder.observation().load.at(-1), {
    screen: "late",
    ok: false,
    reason: "deadline",
  });
});

test("problems/tests#R7: view 오류는 preload 본문 모양만 받아 화면별 상한까지 message를 잘라 싣는다", () => {
  const recorder = createScreenTestRecorder();
  recorder.error("main", {
    observation: "error",
    name: "Error",
    message: "x".repeat(ERROR_MESSAGE_MAX_CHARS + 10),
  });
  recorder.error("main", { observation: "error", name: "Error" });
  recorder.error("main", {
    observation: "error",
    name: "Error",
    message: null,
    app: "app_other",
  });
  recorder.error("main", { observation: "crash", name: "E", message: null });
  for (let index = 0; index < ERRORS_PER_SCREEN + 5; index++) {
    recorder.error("other", {
      observation: "unhandledrejection",
      name: "TypeError",
      message: null,
    });
  }
  const errors = recorder.observation().errors;
  const main = errors.filter((item) => item.screen === "main");
  assert.equal(main.length, 1);
  assert.equal(main[0]?.message?.length, ERROR_MESSAGE_MAX_CHARS);
  assert.equal(
    errors.filter((item) => item.screen === "other").length,
    ERRORS_PER_SCREEN,
  );
});

test("problems/tests#R19: 막힌 요청은 주소 hash로만 싣고 관측 frame은 상한 안이어야 쓴다", () => {
  const recorder = createScreenTestRecorder();
  const url = "https://example.com/blocked?secret=1";
  for (let index = 0; index < BLOCKED_PER_SCREEN + 3; index++) {
    recorder.blocked("main", url);
  }
  const observation = recorder.observation();
  assert.equal(observation.blocked_requests.length, BLOCKED_PER_SCREEN);
  assert.equal(
    observation.blocked_requests[0]?.url_hash,
    createHash("sha256").update(url).digest("hex"),
  );
  assert.equal(JSON.stringify(observation).includes("secret"), false);
  assert.equal(fitsFrame(`${"a".repeat(FRAME_MAX_BYTES - 1)}\n`), true);
  assert.equal(fitsFrame(`${"a".repeat(FRAME_MAX_BYTES)}\n`), false);
});

test("problems/tests#R19: fd 3 입력은 첫 한 줄이고 상한을 넘거나 줄 없이 닫히면 없다", async () => {
  const first = new PassThrough();
  const line = readFrame(first);
  first.write('{"a":');
  first.write('1}\n{"b":2}\n');
  assert.equal(await line, '{"a":1}');

  const big = new PassThrough();
  const tooLong = readFrame(big, 8);
  big.write("123456789\n");
  assert.equal(await tooLong, undefined);

  const cut = new PassThrough();
  const closed = readFrame(cut);
  cut.end("{}");
  assert.equal(await closed, undefined);
});

test("problems/tests#R19: test view는 실행마다 메모리 partition과 test 전용 앱 주소를 쓴다", () => {
  const partition = screenTestPartition("ab12");
  assert.equal(partition, "app-test-ab12");
  assert.equal(partition.startsWith("persist:"), false);
  assert.equal(
    screenEntryUrl({ key: "usage", path: "usage/main page.html" }),
    "lophn-app://app-test/usage/main%20page.html",
  );
});

test("problems/tests#R19: bundle 파일 응답은 그 화면 폴더 안의 알려진 형식만 준다", async () => {
  const root = await mkdtemp(join(tmpdir(), "screen-test-bundle-"));
  try {
    const screens = join(root, "screens");
    await mkdir(join(screens, "main"), { recursive: true });
    await writeFile(join(screens, "main", "index.html"), "<p>hi</p>");
    await writeFile(join(screens, "main", "data.bin"), "x");
    await writeFile(join(root, "secret.txt"), "secret");
    await symlink(join(root, "secret.txt"), join(screens, "main", "leak.txt"));
    const upstream = bundleUpstream({
      ...input([{ key: "main", path: "main/index.html" }]),
      bundle_screens_dir: screens,
    });
    const get = (path: string) =>
      upstream({
        endpoint: "",
        authorization: "",
        path,
        signal: new AbortController().signal,
      });
    const ok = await get("/screens/main/index.html?size=full&view_session=v");
    assert.equal(ok.status, 200);
    assert.equal(ok.headers["content-type"], "text/html; charset=utf-8");
    assert.equal(await new Response(ok.body).text(), "<p>hi</p>");
    for (
      const path of [
        "/screens/main/leak.txt",
        "/screens/main/data.bin",
        "/screens/main/none.html",
        "/screens/other/index.html",
        "/other/main/index.html",
      ]
    ) {
      assert.equal((await get(path)).status, 404, path);
    }
  } finally {
    await rm(root, { recursive: true });
  }
});

test("problems/tests#R7: lophnApp.call은 runner가 준 test 앱 socket의 invoke로 command·입력만 보낸다", async () => {
  const sent: InvokeRequest[] = [];
  const call = createScreenTestCall({
    endpoint: "/tmp/app.sock",
    invoke: (request) => {
      sent.push(request);
      return Promise.resolve({
        status: 200,
        body: { result: { result: 1 } },
      });
    },
    requestKey: () => "req-1",
  });
  assert.deepEqual(await call({ command: "usage.list", input: { n: 1 } }), {
    ok: true,
    value: { result: { result: 1 } },
  });
  assert.deepEqual(sent, [{
    endpoint: "/tmp/app.sock",
    authorization: "",
    body: { request_key: "req-1", command: "usage.list", input: { n: 1 } },
  }]);
  assert.deepEqual(await call({ input: 1 }), {
    ok: false,
    error: { code: "invalid_input", message: "command is not available" },
  });
  const down = createScreenTestCall({
    endpoint: "/tmp/app.sock",
    invoke: () => Promise.reject(new Error("ECONNREFUSED")),
    requestKey: () => "req-2",
  });
  assert.deepEqual(await down({ command: "usage.list" }), {
    ok: false,
    error: { code: "unavailable", message: "app is not available" },
  });
});
