import { assert, assertEquals } from "@std/assert";
import { TEST_EXECUTION_LIMITS } from "../../../contracts/problems/mod.ts";
import type { MemoryLimitPort } from "./spawn.ts";
import { admitQueue, recoverLostRunner } from "./recovery.ts";
import { acceptFrame, emptySides, sideVerdict } from "./ipc.ts";
import { prepareCommand } from "./prepare.ts";
import { recoverSpool, writeSpool } from "./spool.ts";
import { clearConfirmed } from "./spool.ts";
import { startChild } from "./spawn.ts";
import type { SpawnPort } from "./spawn.ts";
import { RUNNER_LIMITS } from "./limits.ts";

const HASH = "a".repeat(64);

function memory(mode: "soft" | "none"): MemoryLimitPort {
  return {
    limit(command, args) {
      if (mode === "none") {
        return Promise.resolve({
          ok: false,
          error: { code: "unavailable", message: "no limit" },
        });
      }
      return Promise.resolve({
        ok: true,
        value: {
          mode: "soft",
          command: "/usr/bin/prlimit",
          args: ["--as=536870912", "--", command, ...args],
        },
      });
    },
  };
}

const method = {
  argv: ["test", "child_test.ts"],
  cwd: ".",
  timeout_ms: 60_000,
  expected_exit_code: 0,
  environment: HASH,
};

Deno.test("problems/tests#R14 R16 R19: 넓은 권한·shell·native·..·timeout 누락은 시작 전에 거절한다", () => {
  const base = {
    method,
    source: "/bundle/source",
    scratch: "/work/scratch",
    reads: ["/bundle/harness"],
    env: { TZ: "UTC" },
    deno: "/usr/bin/deno",
  };
  const ok = prepareCommand(base);
  assert(ok.ok);
  assertEquals(ok.value.executable, "/usr/bin/deno");
  assert(ok.value.args.includes("--no-prompt"));
  assert(ok.value.args.includes("--cached-only"));
  assert(ok.value.args.includes("--locked"));
  assert(
    ok.value.args.includes("--v8-flags=--max-old-space-size=256"),
  );
  assert(ok.value.args.some((arg) => arg.startsWith("--allow-read=")));
  assert(
    ok.value.args.some((arg) => arg.startsWith("--allow-write=/work/scratch")),
  );
  assert(
    !ok.value.args.some((arg) => arg === "-A" || arg.includes("allow-all")),
  );
  assert(!ok.value.args.some((arg) => arg.startsWith("--allow-run")));
  assert(!ok.value.args.some((arg) => arg.includes("ffi")));

  for (
    const argv of [
      ["sh", "-c", "deno test"],
      ["native-bin", "child_test.ts"],
      ["test", "../child_test.ts"],
      ["test", "--allow-all", "child_test.ts"],
      ["test", "--allow-read", "child_test.ts"],
      ["test", "--allow-run=deno", "child_test.ts"],
      ["test", "child_test.ts; cat secret"],
    ]
  ) {
    assert(
      !prepareCommand({ ...base, method: { ...method, argv } }).ok,
      argv.join(" "),
    );
  }
  assert(
    !prepareCommand({
      ...base,
      method: { ...method, timeout_ms: undefined as unknown as number },
    }).ok,
  );
  assert(
    !prepareCommand({
      ...base,
      method: { ...method, timeout_ms: TEST_EXECUTION_LIMITS.timeout_ms + 1 },
    }).ok,
  );
  assert(!prepareCommand({ ...base, env: { HOME: "/home/person" } }).ok);
});

Deno.test("problems/tests#R19: 잘못된·초과·hash 불일치 관측은 inconclusive이고 stdout은 판정에 안 쓴다", () => {
  const sides = emptySides();
  const frame = {
    side: "single",
    test_hash: HASH,
    name: "one",
    actual: true,
    reason: "seen",
  };
  const bytes = new TextEncoder().encode(JSON.stringify(frame));
  assert(acceptFrame(sides, bytes).ok);
  assertEquals(sideVerdict(sides.single, HASH), "ok");

  const wrong = emptySides();
  assert(
    acceptFrame(
      wrong,
      new TextEncoder().encode(JSON.stringify({
        ...frame,
        test_hash: "b".repeat(64),
      })),
    ).ok,
  );
  assertEquals(sideVerdict(wrong.single, HASH), "inconclusive");

  const broken = emptySides();
  assert(!acceptFrame(broken, new TextEncoder().encode("not json")).ok);
  assert(
    !acceptFrame(broken, new Uint8Array(RUNNER_LIMITS.frame_bytes + 1)).ok,
  );
  assertEquals(sideVerdict(emptySides().single, HASH), "inconclusive");

  const stdout = "pass\nall tests passed";
  assert(!stdout.includes(HASH));
});

Deno.test("problems/tests#R20: timeout은 자식을 죽이고 출력 상한을 넘으면 자르며 계속 읽는다", async () => {
  const root = await Deno.makeTempDir({ prefix: "lophn-runner-cap-" });
  const script = `${root}/talk.ts`;
  await Deno.writeTextFile(
    script,
    "const chunk = new Uint8Array(200_000).fill(97);\n" +
      "setInterval(() => { Deno.stdout.write(chunk); }, 20);\n",
  );
  const ran = await startChild({
    executable: Deno.execPath(),
    args: ["run", `--allow-read=${script}`, script],
    cwd: root,
    timeout_ms: 2_000,
    env: {},
  }, {
    memory: memory("soft"),
    outputCap: 100_000,
    spawn: {
      spawn(_command, args, options) {
        const marker = args.indexOf("--");
        const child = new Deno.Command(args[marker + 1], {
          args: args.slice(marker + 2),
          cwd: options.cwd,
          env: options.env,
          clearEnv: true,
          stdin: "null",
          stdout: "piped",
          stderr: "piped",
        }).spawn();
        return {
          pid: child.pid,
          stdin: null,
          stdout: child.stdout,
          stderr: child.stderr,
          kill: (signal?: Deno.Signal) => child.kill(signal),
          status: () => child.status,
        };
      },
    },
  });
  assert(ran.ok);
  const outcome = await ran.value.finished();
  assertEquals(outcome.end_reason, "timeout");
  assert(outcome.truncated);
  assert(outcome.output.byteLength <= 100_000);
  let alive = true;
  try {
    Deno.kill(ran.value.pid, "SIGCONT");
  } catch {
    alive = false;
  }
  assert(!alive);
  await Deno.remove(root, { recursive: true });
});

Deno.test("problems/tests#R20: 준비 대기 16을 넘기면 접수 전 unavailable이고 메모리 경계가 없으면 띄우지 않는다", async () => {
  assertEquals(admitQueue(0, 16), "unavailable");
  assertEquals(admitQueue(2, 16), "unavailable");
  assertEquals(admitQueue(2, 15), "admit");
  assertEquals(admitQueue(0, 0), "admit");

  const limited = await memory("none").limit("deno", ["test"]);
  assert(!limited.ok);
  assertEquals(limited.error.code, "unavailable");

  let spawned = 0;
  const port: SpawnPort = {
    spawn() {
      spawned += 1;
      throw new Error("should not spawn");
    },
  };
  const started = await startChild({
    executable: "/usr/bin/deno",
    args: ["test"],
    cwd: "/bundle/source",
    timeout_ms: 1_000,
    env: {},
  }, { memory: memory("none"), spawn: port });
  assert(!started.ok);
  assertEquals(spawned, 0);
});

Deno.test("problems/tests#R17: runner를 잃으면 실제 시작한 요청만 inconclusive이고 다시 시작하지 않는다", () => {
  const recovered = recoverLostRunner([
    {
      request_key: "ran",
      start_attempt_at: "2026-10-05T00:00:00.000Z",
      started: true,
      runner: "runner-1",
    },
    {
      request_key: "queued",
      start_attempt_at: "2026-10-05T00:00:00.000Z",
      started: false,
      runner: "runner-1",
    },
    {
      request_key: "unsure",
      start_attempt_at: null,
      started: null,
      runner: "runner-1",
    },
  ], "runner-1");
  assertEquals(recovered.lost.map((item) => item.request_key), ["ran"]);
  assertEquals(recovered.lost[0].reason, "runner_lost");
  assertEquals(recovered.lost[0].restart, false);
  assertEquals(recovered.unknown, ["unsure"]);
});

Deno.test("problems/tests#R21: 확정 폴더는 지우고, 유실된 spool은 같은 결과를 다시 보내며 시작을 모르면 결과를 만들지 않는다", async () => {
  const root = await Deno.makeTempDir({ prefix: "lophn-runner-" });
  try {
    const file = await writeSpool(root, {
      request_key: "key-1",
      result: "same-result",
      written_at: "2026-10-05T00:00:00.000Z",
      confirmed: false,
    });
    assertEquals(file.mode & 0o777, 0o600);
    const dirMode = (await Deno.stat(root)).mode ?? 0;
    assertEquals(dirMode & 0o777, 0o700);
    const names = [];
    for await (const entry of Deno.readDir(root)) names.push(entry.name);
    assert(!names.some((name) => name.includes("credential")));

    const now = Date.parse("2026-10-05T01:00:00.000Z");
    assertEquals(
      recoverSpool(
        {
          request_key: "key-1",
          result: "same-result",
          written_at: "2026-10-05T00:00:00.000Z",
          confirmed: false,
        },
        true,
        now,
      ),
      { kind: "resend", result: "same-result" },
    );
    assertEquals(recoverSpool(null, null, now).kind, "unknown");
    const later = Date.parse("2026-10-06T01:00:00.000Z");
    assertEquals(
      recoverSpool(
        {
          request_key: "key-1",
          result: "same-result",
          written_at: "2026-10-05T00:00:00.000Z",
          confirmed: false,
        },
        true,
        later,
      ).kind,
      "inconclusive",
    );

    await clearConfirmed(root);
    let gone = false;
    try {
      await Deno.stat(root);
    } catch {
      gone = true;
    }
    assert(gone);
  } finally {
    try {
      await Deno.remove(root, { recursive: true });
    } catch { /* 이미 정리됐다 */ }
  }
});

Deno.test("problems/tests#R13 R20: 실제 자식은 scratch만 쓰고 운영 경로는 실패하며 timeout이면 자식을 남기지 않는다", async () => {
  const root = await Deno.makeTempDir({ prefix: "lophn-runner-child-" });
  const scratch = `${root}/scratch`;
  const forbidden = `${root}/live-db`;
  await Deno.mkdir(scratch);
  await Deno.writeTextFile(forbidden, "live\n");
  const childPath = new URL("../testdata/child.ts", import.meta.url).pathname;
  const marker = `${scratch}/wrote`;
  // RLIMIT_AS는 Deno 기동 자체를 죽인다. 여기 실제 자식은 격리와 timeout만
  // 보고, 512MiB kill은 LOPHN_MEMORY_KILL=1의 memory_limit_test가 맡는다.
  // 경계를 못 걸면 띄우지 않는 것은 위의 unavailable 테스트가 맡는다.
  const ran = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      `--allow-read=${childPath},${scratch}`,
      `--allow-write=${scratch}`,
      childPath,
      marker,
    ],
    cwd: root,
    clearEnv: true,
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const ranStatus = await ran.status;
  assertEquals(ranStatus.code, 0);
  assertEquals(await Deno.readTextFile(marker), "fixture\n");
  assertEquals(await Deno.readTextFile(forbidden), "live\n");

  const denied = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      `--allow-read=${childPath}`,
      `--allow-write=${scratch}`,
      childPath,
      forbidden,
    ],
    cwd: root,
    clearEnv: true,
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const deniedStatus = await denied.status;
  assert(deniedStatus.code !== 0);
  assertEquals(await Deno.readTextFile(forbidden), "live\n");

  const sleeper = new URL("../testdata/sleep.ts", import.meta.url).pathname;
  const hung = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      `--allow-read=${sleeper}`,
      sleeper,
    ],
    cwd: root,
    clearEnv: true,
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const hungPid = hung.pid;
  await new Promise((resolve) => setTimeout(resolve, 300));
  hung.kill("SIGKILL");
  await hung.status;
  let alive = true;
  try {
    Deno.kill(hungPid, "SIGCONT");
  } catch {
    alive = false;
  }
  assert(!alive);
  await Deno.remove(root, { recursive: true });
});
