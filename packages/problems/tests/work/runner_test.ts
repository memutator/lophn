import { assert, assertEquals } from "@std/assert";
import { TEST_EXECUTION_LIMITS } from "../../../protocol/problems/mod.ts";
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
  assert(ok.value.args.includes("--frozen-lockfile"));
  assert(
    ok.value.args.includes("--v8-flags=--max-old-space-size=256"),
  );
  assert(ok.value.args.some((arg) => arg.startsWith("--allow-read=")));
  assert(
    ok.value.args.some((arg) => arg.startsWith("--allow-write=/work/scratch")),
  );
  assert(ok.value.args.includes("--allow-env=TZ"));
  const bare = prepareCommand({ ...base, env: {} });
  assert(bare.ok);
  assert(!bare.value.args.some((arg) => arg.startsWith("--allow-env")));
  assertEquals(bare.value.env, {});
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
      ["test", "--allow-read=/etc", "child_test.ts"],
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
    memory: {
      limit(command, args) {
        return Promise.resolve({
          ok: true,
          value: { mode: "hard" as const, command, args: [...args] },
        });
      },
    },
    outputCap: 100_000,
    spawn: {
      spawn(command, args, options) {
        const child = new Deno.Command("/usr/bin/setsid", {
          args: ["--wait", command, ...args],
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
          killGroup: (signal?: Deno.Signal) => {
            try {
              Deno.kill(-child.pid, signal ?? "SIGKILL");
            } catch { /* 그룹이 이미 없으면 회수된 것이다 */ }
          },
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
  assert(!alivePid(ran.value.pid));
  await Deno.remove(root, { recursive: true });
});

function alivePid(pid: number): boolean {
  // SIGKILL을 받은 프로세스는 회수될 때까지 zombie로 남고, zombie에도 신호는
  // 성공한다. /proc의 상태가 Z면 죽은 것으로 본다(Linux).
  try {
    const stat = Deno.readTextFileSync(`/proc/${pid}/stat`);
    if (stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z")) return false;
  } catch {
    // /proc이 없거나 이미 사라졌으면 신호로 판단한다.
  }
  try {
    Deno.kill(pid, "SIGCONT");
    return true;
  } catch {
    return false;
  }
}

// 부하 아래에서는 종료가 반영되기까지 잠깐 걸린다. 2초 안에 사라지면 죽은 것이다.
async function goneWithin(pid: number, ms = 2_000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (!alivePid(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !alivePid(pid);
}

Deno.test("problems/tests#R20: timeout은 자식이 띄운 손자까지 프로세스 그룹으로 죽인다", async () => {
  const root = await Deno.makeTempDir({ prefix: "lophn-runner-group-" });
  const pidFile = `${root}/grand.txt`;
  const script = `${root}/parent.ts`;
  const deno = Deno.execPath();
  await Deno.writeTextFile(
    script,
    "const child = new Deno.Command(Deno.execPath(), {\n" +
      "  args: ['eval', 'setInterval(() => {}, 60000)'],\n" +
      "  stdout: 'null', stderr: 'null',\n" +
      "}).spawn();\n" +
      `await Deno.writeTextFile(${
        JSON.stringify(pidFile)
      }, String(child.pid));\n` +
      "setInterval(() => {}, 60000);\n",
  );
  const ran = await startChild({
    executable: deno,
    args: [
      "run",
      `--allow-read=${script}`,
      `--allow-write=${root}`,
      `--allow-run=${deno}`,
      script,
    ],
    cwd: root,
    timeout_ms: 3_000,
    env: {},
  }, {
    memory: {
      limit(command, args) {
        return Promise.resolve({
          ok: true,
          value: { mode: "hard" as const, command, args: [...args] },
        });
      },
    },
  });
  assert(ran.ok);
  const outcome = await ran.value.finished();
  assertEquals(outcome.end_reason, "timeout");
  const grand = Number(await Deno.readTextFile(pidFile));
  assert(await goneWithin(ran.value.pid));
  assert(await goneWithin(grand), "손자가 남았다");
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
  const source = `${root}/source`;
  const scratch = `${root}/scratch`;
  const forbidden = `${root}/live-db`;
  await Deno.mkdir(source);
  await Deno.mkdir(scratch);
  await Deno.writeTextFile(forbidden, "live\n");
  await Deno.writeTextFile(`${source}/deno.lock`, "{}\n");
  // 쓰는 경로는 fixture 안에 고정한다. 여분 positional은 deno test가 파일로 본다.
  await Deno.writeTextFile(
    `${source}/child_test.ts`,
    'Deno.test("isolation", async () => {\n' +
      `  await Deno.writeTextFile(${
        JSON.stringify(`${scratch}/wrote`)
      }, "fixture\\n");\n` +
      "});\n",
  );
  const prepared = prepareCommand({
    method: {
      argv: ["test", "child_test.ts"],
      cwd: ".",
      timeout_ms: 20_000,
      expected_exit_code: 0,
      environment: HASH,
    },
    source,
    scratch,
    reads: [source],
    env: {},
    deno: Deno.execPath(),
  });
  assert(prepared.ok);
  // prepareCommand가 만든 argv를 startChild가 그대로 띄운다. 메모리 경계는
  // passthrough다. 512MiB RLIMIT_AS는 Deno 시작을 죽인다.
  const ran = await startChild(prepared.value, {
    memory: {
      limit(command, args) {
        return Promise.resolve({
          ok: true,
          value: { mode: "hard" as const, command, args: [...args] },
        });
      },
    },
  });
  assert(ran.ok);
  const outcome = await ran.value.finished();
  const text = new TextDecoder().decode(outcome.output);
  assertEquals(outcome.end_reason, "exited", text);
  assertEquals(outcome.exit_code, 0, text);
  assertEquals(await Deno.readTextFile(`${scratch}/wrote`), "fixture\n");
  assertEquals(await Deno.readTextFile(forbidden), "live\n");

  const denied = await startChild({
    executable: Deno.execPath(),
    args: [
      "run",
      `--allow-read=${
        new URL("../testdata/child.ts", import.meta.url).pathname
      }`,
      `--allow-write=${scratch}`,
      new URL("../testdata/child.ts", import.meta.url).pathname,
      forbidden,
    ],
    cwd: root,
    timeout_ms: 20_000,
    env: {},
  }, {
    memory: {
      limit(command, args) {
        return Promise.resolve({
          ok: true,
          value: { mode: "hard" as const, command, args: [...args] },
        });
      },
    },
  });
  assert(denied.ok);
  const deniedOut = await denied.value.finished();
  assert(deniedOut.exit_code !== 0);
  assertEquals(await Deno.readTextFile(forbidden), "live\n");

  const sleeper = new URL("../testdata/sleep.ts", import.meta.url).pathname;
  const hung = await startChild({
    executable: Deno.execPath(),
    args: ["run", `--allow-read=${sleeper}`, sleeper],
    cwd: root,
    timeout_ms: 400,
    env: {},
  }, {
    memory: {
      limit(command, args) {
        return Promise.resolve({
          ok: true,
          value: { mode: "hard" as const, command, args: [...args] },
        });
      },
    },
  });
  assert(hung.ok);
  const hungPid = hung.value.pid;
  const hungOut = await hung.value.finished();
  assertEquals(hungOut.end_reason, "timeout");
  assert(!alivePid(hungPid));
  await Deno.remove(root, { recursive: true });
});

Deno.test("coding-agent/mcp-server#R33, problems/tests#R20: 요청 timeout은 method의 timeout보다 길어지지 않는다", () => {
  const base = {
    method,
    source: "/bundle/source",
    scratch: "/work/scratch",
    reads: [],
    env: {},
    deno: "/usr/bin/deno",
  };
  const plain = prepareCommand(base);
  assert(plain.ok);
  assertEquals(plain.value.timeout_ms, method.timeout_ms);
  const shorter = prepareCommand({ ...base, request_timeout_ms: 1_000 });
  assert(shorter.ok);
  assertEquals(shorter.value.timeout_ms, 1_000);
  // method보다 긴 요청은 method의 한도로 줄어든다.
  const longer = prepareCommand({ ...base, request_timeout_ms: 300_000 });
  assert(longer.ok);
  assertEquals(longer.value.timeout_ms, method.timeout_ms);
  for (const request_timeout_ms of [0, -5, 1.5, 300_001]) {
    assert(!prepareCommand({ ...base, request_timeout_ms }).ok);
  }
});

Deno.test("problems/tests#R14 R16: runner가 고른 import map과 runtime 환경은 flag와 자식 환경에만 들어가고 allow-env나 요청 argv로는 넣지 못한다", () => {
  const base = {
    method,
    source: "/work/harness",
    scratch: "/work/scratch",
    reads: ["/bundle"],
    env: {},
    deno: "/usr/bin/deno",
  };
  const plain = prepareCommand(base);
  assert(plain.ok);
  assert(!plain.value.args.some((arg) => arg.startsWith("--import-map")));
  const mapped = prepareCommand({
    ...base,
    import_map: "/work/harness/import-map.json",
    runtime_env: { HOME: "/home/runner", DENO_DIR: "/cache" },
  });
  assert(mapped.ok);
  assert(mapped.value.args.includes("--no-config"));
  assert(
    mapped.value.args.includes("--import-map=/work/harness/import-map.json"),
  );
  // 환경은 자식 프로세스에만 가고 자식에게 env 권한은 없다.
  assertEquals(mapped.value.env, { HOME: "/home/runner", DENO_DIR: "/cache" });
  assert(!mapped.value.args.some((arg) => arg.startsWith("--allow-env")));
  // 요청이 argv로 import map을 바꾸려 하면 거절한다.
  assert(
    !prepareCommand({
      ...base,
      method: {
        ...method,
        argv: ["test", "child_test.ts", "--import-map=/evil.json"],
      },
    }).ok,
  );
  assert(!prepareCommand({ ...base, import_map: "relative.json" }).ok);
});
