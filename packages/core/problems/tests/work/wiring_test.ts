import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../../../base/mod.ts";
import { fileLedger } from "../testing/mod.ts";
import { accept, proof, REQUEST_HASH, runner } from "../fixtures.ts";
import { appendRequestObservation } from "../commands.ts";
import { loadRecords } from "../records.ts";
import { runPrepared } from "./runner.ts";
import type { SpawnPort } from "./spawn.ts";
import { brokerReport, childLaunch } from "./broker.ts";
import { groupLeader, groupTool } from "./group.ts";
import { startChild } from "./spawn.ts";

const HASH = "a".repeat(64);

const prepare = {
  method: {
    argv: ["test", "child_test.ts"],
    cwd: ".",
    timeout_ms: 1_000,
    expected_exit_code: 0,
    environment: HASH,
  },
  source: "/bundle/source",
  scratch: "/work/scratch",
  reads: ["/bundle/source"],
  env: {},
  deno: "/usr/bin/deno",
};

function memory() {
  return {
    limit(command: string, args: readonly string[]) {
      return Promise.resolve(ok({
        mode: "hard" as const,
        command,
        args: [...args],
      }));
    },
  };
}

function spawnCounter(): { port: SpawnPort; count: () => number } {
  let spawned = 0;
  return {
    count: () => spawned,
    port: {
      spawn() {
        spawned += 1;
        throw new Error("spawn should not run");
      },
    },
  };
}

Deno.test("problems/tests#R17: 시작 시도가 ledger에 확정되기 전에는 spawn하지 않는다", async () => {
  const ledger = fileLedger();
  try {
    assert(ledger.transaction(accept).ok);
    const counted = spawnCounter();
    const refused = await runPrepared({
      request_key: "key-1",
      prepare,
      test_hash: HASH,
      side: "single",
      start_attempt_at: "2026-10-04T00:00:01.000Z",
      running: 0,
      preparing: 0,
    }, {
      memory: memory(),
      spawn: counted.port,
      commit: () =>
        Promise.resolve(
          err({ code: "conflict", message: "아직 확정이 아니다" }),
        ),
    });
    assert(!refused.ok);
    assertEquals(counted.count(), 0);
    const rows = loadRecords(ledger.sql, "user-1", "key-1");
    assert(!rows.some((row) => row.phase === "start_attempt"));
  } finally {
    ledger.close();
  }
});

Deno.test("problems/tests#R17: 시작 시도를 ledger에 확정한 뒤에만 spawn한다", async () => {
  const ledger = fileLedger();
  const source = await Deno.makeTempDir({ prefix: "lophn-runner-src-" });
  const scratch = await Deno.makeTempDir({ prefix: "lophn-runner-scratch-" });
  try {
    assert(ledger.transaction(accept).ok);
    const order: string[] = [];
    const recorded = ledger.transaction((tx) =>
      appendRequestObservation(tx, runner(), {
        phase: "start_attempt",
        request_principal: "user-1",
        request_key: "key-1",
        request_hash: REQUEST_HASH,
        at: "2026-10-04T00:00:01.000Z",
        previous_runner: null,
        runner_principal: "runner-1",
        reason: "attempt",
      }, proof())
    );
    assert(recorded.ok);
    order.push("committed");
    const counted = spawnCounter();
    const ran = await runPrepared({
      request_key: "key-1",
      prepare: { ...prepare, source, scratch, reads: [source] },
      test_hash: HASH,
      side: "single",
      start_attempt_at: "2026-10-04T00:00:01.000Z",
      running: 0,
      preparing: 0,
    }, {
      memory: memory(),
      spawn: counted.port,
      commit: () => {
        const rows = loadRecords(ledger.sql, "user-1", "key-1");
        const attemptRow = rows.find((row) => row.phase === "start_attempt");
        if (!attemptRow) {
          return Promise.resolve(err({ code: "conflict", message: "없다" }));
        }
        order.push("spawn");
        return Promise.resolve(ok(attemptRow.at ?? ""));
      },
    });
    assert(!ran.ok);
    assertEquals(order, ["committed", "spawn"]);
    assertEquals(counted.count(), 1);
  } finally {
    ledger.close();
    await Deno.remove(source, { recursive: true });
    await Deno.remove(scratch, { recursive: true });
  }
});

Deno.test("problems/tests#R17: 시작 시도 확정이 없으면 결과를 만들지 않는다", async () => {
  const counted = spawnCounter();
  const ran = await runPrepared({
    request_key: "key-1",
    prepare,
    test_hash: HASH,
    side: "single",
    start_attempt_at: null,
    running: 0,
    preparing: 0,
  }, { memory: memory(), spawn: counted.port });
  assert(!ran.ok);
  assertEquals(ran.error.code, "conflict");
  assertEquals(counted.count(), 0);
});

const REPORT = {
  report_id: "rpt_01ary8h2z3n4p5q6r7s8t9v0wx",
  code: "save_failed",
  observed_at: "2026-10-05T00:00:00.000Z",
  text: "저장이 실패했다",
};

Deno.test("problems/tests#R14: 자식 SDK 보고는 mode=test와 요청 scope로 collector에 넘긴다", async () => {
  const frame = new TextEncoder().encode(JSON.stringify(REPORT));
  const handed: unknown[] = [];
  const sent = await brokerReport(frame, "app-test-1", (report) => {
    handed.push(report);
    return Promise.resolve(ok({ accepted: true }));
  });
  assert(sent.ok);
  assertEquals(handed, [{
    report: REPORT,
    mode: "test",
    scope: "app-test-1",
  }]);
});

Deno.test("problems/tests#R14: 자식이 mode·결과 기록을 주장하면 보고를 넘기지 않는다", async () => {
  let handed = 0;
  const sink = () => {
    handed += 1;
    return Promise.resolve(ok({}));
  };
  for (
    const extra of [
      { mode: "live" },
      { scope: "other" },
      { credential: "secret" },
      { record_verification: true },
    ]
  ) {
    const frame = new TextEncoder().encode(
      JSON.stringify({ ...REPORT, ...extra }),
    );
    const refused = await brokerReport(frame, "app-test-1", sink);
    assert(!refused.ok, JSON.stringify(extra));
  }
  assertEquals(handed, 0);
  const empty = await brokerReport(
    new TextEncoder().encode(JSON.stringify(REPORT)),
    "  ",
    sink,
  );
  assert(!empty.ok);
});

Deno.test("problems/tests#R14: 자식 환경과 argv에 core·collector 주소와 credential이 없다", () => {
  const clean = childLaunch(
    ["test", "child_test.ts"],
    { TZ: "UTC" },
  );
  assert(clean.ok);
  assertEquals(clean.value.env, { TZ: "UTC" });
  const blocked: Record<string, string>[] = [
    { LOPHN_CORE: "http://127.0.0.1:1" },
    { LOPHN_COLLECTOR_URL: "http://127.0.0.1:2" },
    { LOPHN_CREDENTIAL: "token" },
    { LOPHN_APP_BROKER: "/tmp/broker.sock" },
    { LOPHN_APP_BROKER_CREDENTIAL: "token" },
  ];
  for (const env of blocked) {
    assert(
      !childLaunch(["test", "child_test.ts"], env).ok,
      Object.keys(env)[0],
    );
  }
  assert(!childLaunch(["test", "--env=LOPHN_CORE"], {}).ok);
});

Deno.test("problems/tests#R14: 실제 자식의 환경과 argv에 주소와 credential이 없다", async () => {
  const root = await Deno.makeTempDir({ prefix: "lophn-runner-env-" });
  const script = `${root}/env.ts`;
  const out = `${root}/seen.json`;
  await Deno.writeTextFile(
    script,
    "const seen = { env: Deno.env.toObject(), args: Deno.args };\n" +
      `await Deno.writeTextFile(${
        JSON.stringify(out)
      }, JSON.stringify(seen));\n`,
  );
  const leaked = await startChild({
    executable: Deno.execPath(),
    args: [
      "run",
      "--allow-env",
      `--allow-read=${script}`,
      `--allow-write=${root}`,
      script,
    ],
    cwd: root,
    timeout_ms: 20_000,
    env: { TZ: "UTC", LOPHN_CORE: "http://127.0.0.1:9" },
  }, { memory: memory() });
  assert(!leaked.ok);
  const ran = await startChild({
    executable: Deno.execPath(),
    args: [
      "run",
      "--allow-env",
      `--allow-read=${script}`,
      `--allow-write=${root}`,
      script,
    ],
    cwd: root,
    timeout_ms: 20_000,
    env: { TZ: "UTC" },
  }, { memory: memory() });
  assert(ran.ok);
  const outcome = await ran.value.finished();
  assertEquals(outcome.exit_code, 0, new TextDecoder().decode(outcome.output));
  const seen = JSON.parse(await Deno.readTextFile(out)) as {
    env: Record<string, string>;
    args: string[];
  };
  const blocked = [
    "LOPHN_CORE",
    "LOPHN_CORE_URL",
    "LOPHN_COLLECTOR",
    "LOPHN_COLLECTOR_URL",
    "LOPHN_CREDENTIAL",
    "LOPHN_APP_BROKER",
    "LOPHN_APP_BROKER_CREDENTIAL",
  ];
  for (const name of blocked) assertEquals(seen.env[name], undefined, name);
  const joined = seen.args.join(" ");
  for (const name of blocked) assert(!joined.includes(name), name);
  assertEquals(seen.env.TZ, "UTC");
  await Deno.remove(root, { recursive: true });
});

Deno.test("problems/tests#R20: 프로세스 그룹은 OS로 고르고 macOS는 setsid 없이 perl을 쓴다", async () => {
  assertEquals(groupTool("linux"), "setsid");
  assertEquals(groupTool("darwin"), "perl");
  assertEquals(groupTool("windows"), "none");
  const linux = await groupLeader("linux");
  assert(linux);
  assertEquals(linux.command, "/usr/bin/setsid");
  const mac = await groupLeader("darwin");
  assert(mac);
  assertEquals(mac.command, "/usr/bin/perl");
  assert(mac.args.includes("setpgrp(0,0); exec @ARGV"));
  assert(!mac.args.some((arg) => arg.includes("setsid")));
  assertEquals(await groupLeader("windows"), null);
});

Deno.test("problems/tests#R20: perl 그룹 분리로 띄운 자식의 손자까지 timeout이 죽인다", async () => {
  const root = await Deno.makeTempDir({ prefix: "lophn-runner-perl-" });
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
  const leader = await groupLeader("darwin");
  assert(leader);
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
    memory: memory(),
    spawn: {
      spawn(command, args, options) {
        const child = new Deno.Command(leader.command, {
          args: [...leader.args, command, ...args],
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
  const grand = Number(await Deno.readTextFile(pidFile));
  try {
    Deno.kill(grand, "SIGCONT");
    assert(false, "손자가 남았다");
  } catch { /* 손자까지 그룹으로 죽었다 */ }
  await Deno.remove(root, { recursive: true });
});

Deno.test("problems/tests#R20: 그룹을 나눌 수 없는 OS는 자식을 띄우지 않는다", async () => {
  const counted = spawnCounter();
  const refused = await startChild({
    executable: "/usr/bin/deno",
    args: ["test"],
    cwd: "/bundle/source",
    timeout_ms: 1_000,
    env: {},
  }, { memory: memory(), os: "windows" });
  assert(!refused.ok);
  assertEquals(refused.error.code, "unavailable");
  assertEquals(counted.count(), 0);
});
