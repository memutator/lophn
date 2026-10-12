import { assert, assertEquals, assertRejects } from "@std/assert";
import { ok } from "../../../../base/mod.ts";
import { fixtureDriver } from "../testing/app-driver.ts";
import { createEmitter } from "./emit.ts";
import { observeDirectFailurePath } from "./checks.ts";
import { type HarnessPlan, ViewHostInconclusive } from "./driver.ts";
import { rpcDriver, type RunnerDriver, serveRpc } from "./rpc.ts";
import {
  checkDigest,
  failurePathDefinition,
  platformDefinition,
} from "./definitions.ts";

const HASH = "a".repeat(64);

function runnerDriver(over: Partial<RunnerDriver> = {}): RunnerDriver {
  const fake = fixtureDriver({
    bundle_hash: HASH,
    failure_commands: { save: "save_failed" },
    commands: ["save"],
    declared_codes: ["save_failed"],
    has_view: false,
  });
  return { ...fake, view: null, ...over };
}

Deno.test("problems/tests#R6 R19: test 자식은 scratch의 private 호출 통로로만 runner의 driver를 부른다", async () => {
  const scratch = await Deno.makeTempDir({ prefix: "rpc-test-" });
  try {
    const served = serveRpc(
      scratch,
      runnerDriver({
        view: {
          exception: () =>
            Promise.reject(new ViewHostInconclusive("host exit 3")),
          feedback: () => Promise.resolve([]),
        },
      }),
    );
    const child = rpcDriver(scratch, { view: true });
    const attestation = await child.probe();
    assertEquals(attestation.commands, ["save"]);
    assertEquals(attestation.bundle_hash, HASH);
    // 요청은 번호 순서대로 하나씩 실행되고 같은 호출 인자가 runner까지 간다.
    const invoked = await child.invoke("save", { a: 1 }, {
      inject_failure: true,
      fault: "store",
    });
    assertEquals(invoked.reports.map((report) => report.code), ["save_failed"]);
    // 화면 검사 host가 판정하지 못한 사실은 판정 불가 종류 그대로 자식에 닿는다.
    const error = await assertRejects(
      () => child.view!.exception(),
      ViewHostInconclusive,
    );
    assertEquals(error.reason, "host exit 3");
    assertEquals(await child.view!.feedback(), []);
    await served.stop();
    assertEquals(rpcDriver(scratch, { view: false }).view, null);
    // 요청·응답은 scratch의 rpc 폴더에만 남는다.
    const names = [];
    for await (const entry of Deno.readDir(`${scratch}/rpc`)) {
      names.push(entry.name);
    }
    assert(names.every((name) => /^\d+\.(req|res)\.json$/.test(name)));
  } finally {
    await Deno.remove(scratch, { recursive: true });
  }
});

Deno.test("problems/problem-codes#R9: SDK만 직접 부른 실패 경로 test는 보고가 접수돼도 통과하지 못하고 직접 보고로 적힌다", async () => {
  const frames: unknown[] = [];
  const emitter = createEmitter({
    side: "single",
    test_hash: HASH,
    write: (bytes) => frames.push(JSON.parse(new TextDecoder().decode(bytes))),
  });
  const definition = failurePathDefinition("save_failed");
  const plan = {
    bundle_hash: HASH,
    test_hash: HASH,
    declared_codes: ["save_failed"],
    commands: ["save"],
    has_view: false,
    command_details: [],
    automations: [],
    secrets: [],
    net: [],
    documents: [],
    data: { schema: 0, previous_schema: null },
    checks: [{
      ...definition,
      digest: checkDigest(definition),
      status: "required" as const,
      reason: "failure path",
    }, {
      ...platformDefinition("sdk_receipt"),
      digest: checkDigest(platformDefinition("sdk_receipt")),
      status: "required" as const,
      reason: "receipt",
    }],
  } satisfies HarnessPlan;
  const sent = await observeDirectFailurePath({
    driver: runnerDriver(),
    plan,
    emitter,
    code: "save_failed",
  });
  assertEquals(sent, ok(false));
  const frame = frames[0] as {
    name: string;
    expectation_met: boolean;
    actual: { via: string; command: unknown };
  };
  assertEquals(frame.name, "failure_path:save_failed");
  assertEquals(frame.expectation_met, false);
  assertEquals(frame.actual.via, "sdk_direct");
  assertEquals(frame.actual.command, null);
});
