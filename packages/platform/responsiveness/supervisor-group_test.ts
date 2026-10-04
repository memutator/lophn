import { assert, assertEquals } from "@std/assert";
import {
  checkKillAdapter,
  spawnProcess,
  supportsProcessGroupEnforcement,
} from "./process.ts";

// 이 파일은 실제 OS process group에 대한 책임만 진다. product 쪽 확인은 좁은 grant의
// probe(testdata/group-probe.ts) 안에서 돈다. 이 test 자신의 넓은 권한은 /proc 관측에만 쓴다.
const testdata = new URL("./testdata/", import.meta.url).pathname;
const probe = `${testdata}group-probe.ts`;
const config = new URL("../../../deno.json", import.meta.url).pathname;
const deno = Deno.execPath();
const KILL = "/usr/bin/kill";

type Line = Record<string, unknown> & { step: string };

function narrow(mode: string, grants: { run: string[]; env: string[] }) {
  return new Deno.Command(deno, {
    args: [
      "run",
      `--config=${config}`,
      "--cached-only",
      "--frozen",
      "--no-prompt",
      `--allow-run=${grants.run.join(",")}`,
      ...(grants.env.length ? [`--allow-env=${grants.env.join(",")}`] : []),
      `--allow-read=${testdata}`,
      probe,
      mode,
      deno,
      testdata,
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
}

// /proc/<pid>/stat: pid (comm) state ppid pgrp session ...
async function pgrpAndSession(pid: number) {
  const text = await Deno.readTextFile(`/proc/${pid}/stat`);
  const rest = text.slice(text.lastIndexOf(")") + 1).trim().split(/\s+/);
  return { pgrp: Number(rest[2]), session: Number(rest[3]) };
}

async function gone(pid: number): Promise<boolean> {
  try {
    await Deno.stat(`/proc/${pid}`);
    return false;
  } catch (error) {
    return error instanceof Deno.errors.NotFound;
  }
}

async function readLines(
  child: Deno.ChildProcess,
  onLine: (line: Line) => Promise<void>,
) {
  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of child.stdout) {
    pending += decoder.decode(chunk, { stream: true });
    let newline = pending.indexOf("\n");
    while (newline >= 0) {
      await onLine(JSON.parse(pending.slice(0, newline)));
      pending = pending.slice(newline + 1);
      newline = pending.indexOf("\n");
    }
  }
}

Deno.test("platform/security#R1: 좁은 grant의 product가 실제 group(pid=pgid=session)과 손자를 정리한다", async () => {
  assertEquals(Deno.build.os, "linux");
  const child = narrow("grant", {
    run: [deno, KILL],
    env: ["NODE_V8_COVERAGE"],
  });
  const writer = child.stdin.getWriter();
  const lines: Line[] = [];
  const stderr = new Response(child.stderr).text();
  await readLines(child, async (line) => {
    lines.push(line);
    if (line.step !== "forced-pids") return;
    const leader = line.leader as number;
    const grandchild = line.grandchild as number;
    // 실제 /proc: leader는 setsid session leader이고 손자는 같은 group·session에 있다.
    assertEquals(await pgrpAndSession(leader), {
      pgrp: leader,
      session: leader,
    });
    assertEquals(await pgrpAndSession(grandchild), {
      pgrp: leader,
      session: leader,
    });
    await writer.write(new TextEncoder().encode("go\n"));
  });
  await writer.close();
  const status = await child.status;
  assertEquals(status.code, 0, await stderr);
  const step = (name: string) => lines.find((line) => line.step === name);
  assertEquals(step("adapter")?.ok, true);
  for (const name of ["exit", "forced", "supervised"]) {
    const line = step(name);
    assert(line, `${name} missing: ${JSON.stringify(lines)}`);
    assertEquals(line.confirmed ?? line.stopped, true, name);
    for (const pid of [line.leader, line.grandchild] as number[]) {
      assert(Number.isInteger(pid) && pid > 1, name);
      assert(await gone(pid), `${name}: ${pid} still exists`);
    }
  }
  assertEquals(step("exit")?.code, 0);
  assertEquals(step("supervised")?.started, true);
  assertEquals(step("supervised")?.reason, "stopped");
});

Deno.test("platform/security#R3: /usr/bin/kill이나 NODE_V8_COVERAGE grant가 없으면 child를 하나도 띄우지 않는다", async () => {
  for (
    const grants of [
      { run: [deno], env: ["NODE_V8_COVERAGE"] },
      { run: [deno, KILL], env: [] },
    ]
  ) {
    const child = narrow("denied", grants);
    await child.stdin.close();
    const lines: Line[] = [];
    const stderr = new Response(child.stderr).text();
    await readLines(child, (line) => {
      lines.push(line);
      return Promise.resolve();
    });
    assertEquals((await child.status).code, 0, await stderr);
    assertEquals(lines, [{
      step: "denied",
      adapter: false,
      started: false,
      code: "unavailable",
      spawned: 0,
      reason: "group kill adapter unavailable",
    }]);
  }
});

Deno.test("platform/security#R3: 비Linux는 group 강제를 보장할 수 없어 fail-closed다", async () => {
  assertEquals(supportsProcessGroupEnforcement("linux"), true);
  assertEquals(supportsProcessGroupEnforcement("darwin"), false);
  assertEquals(supportsProcessGroupEnforcement("windows"), false);
  // 이 환경은 실제로 linux이므로 guard가 "언제나 거절"로 퇴행하지 않았음도 함께 본다.
  assertEquals(Deno.build.os, "linux");
  assert(await checkKillAdapter());
});

Deno.test("platform/security#R3: child env는 넘긴 이름만 갖고 부모의 NODE_V8_COVERAGE를 물려받지 않는다", async () => {
  const before = Deno.env.get("NODE_V8_COVERAGE");
  const coverage = await Deno.makeTempDir();
  Deno.env.set("NODE_V8_COVERAGE", coverage);
  try {
    const spawned = spawnProcess({
      command: deno,
      args: [
        "eval",
        "--no-config",
        "console.log(JSON.stringify(Object.keys(Deno.env.toObject())))",
      ],
      env: { LOPHN_FIXTURE_MODE: "normal" },
    });
    const buffer = new Uint8Array(4096);
    let out = "";
    while (true) {
      const count = await spawned.stdout.read(buffer);
      if (count === null) break;
      out += new TextDecoder().decode(buffer.subarray(0, count));
    }
    // PATH·DENO_NODE_SHIM_ACTIVE는 Deno child가 시작하며 스스로 넣는 이름이다(부모가 넘긴 것이 아니다).
    const keys = (JSON.parse(out) as string[]).filter((key) =>
      key !== "PATH" && key !== "DENO_NODE_SHIM_ACTIVE"
    );
    assertEquals(keys, ["LOPHN_FIXTURE_MODE"]);
    assert(await spawned.terminate());
  } finally {
    if (before === undefined) Deno.env.delete("NODE_V8_COVERAGE");
    else Deno.env.set("NODE_V8_COVERAGE", before);
    await Deno.remove(coverage, { recursive: true });
  }
});
