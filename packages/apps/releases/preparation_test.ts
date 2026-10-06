// release 준비 요청의 진행(apps/releases#R19). 접수는 release 확정이 아니고 진행은 supervisor 메모리다.
// 메모리를 잃으면 이전 요청은 unknown이고 성공으로 다시 쓰이지 않는다. 준비의 실제 일은 runner가 한다.
import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../base/mod.ts";
import {
  createPreparationService,
  type PreparationJob,
  type PreparationOutcome,
  type PreparationRunner,
} from "./preparation.ts";

const APP = "app_01aryz6s41s4z4k7p41s4z4k7p";
const HASH = "a".repeat(64);
const OUTCOME: PreparationOutcome = {
  bundle_hash: HASH,
  blueprint_hash: "b".repeat(64),
  manifest: {
    entrypoint: "main.ts",
    files: [{ path: "main.ts", hash: "c".repeat(64) }],
    sdk_dependencies: [],
  },
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function job(overrides: Partial<PreparationJob> = {}): PreparationJob {
  return {
    app: APP,
    commit: "1".repeat(40),
    request_key: "prep-1",
    source_path: "/work/app",
    ...overrides,
  };
}

// 시험이 끝내는 때를 정하는 runner. abort되면 자식을 끝낸 것처럼 돌려준다.
function gatedRunner() {
  const runs: PreparationJob[] = [];
  let settle: ((result: Result<PreparationOutcome>) => void) | undefined;
  const runner: PreparationRunner = {
    run(next, signal) {
      runs.push(next);
      return new Promise((resolve) => {
        settle = resolve;
        signal.addEventListener(
          "abort",
          () => resolve(err({ code: "unavailable", message: "stopped" })),
          { once: true },
        );
      });
    },
  };
  return {
    runner,
    runs,
    finish: (r: Result<PreparationOutcome>) => settle?.(r),
  };
}

Deno.test("apps/releases#R19: 접수는 진행 중으로 답하고 끝나면 고정 bundle hash·blueprint hash·manifest를 낸다", async () => {
  const gate = gatedRunner();
  const service = createPreparationService(gate.runner);
  const started = service.start(job());
  assert(started.ok);
  assertEquals(started.value.status, "preparing");
  assertEquals(started.value.bundle_hash, null);
  gate.finish(ok(OUTCOME));
  await tick();
  const done = service.get(APP, "prep-1");
  assertEquals(done.status, "completed");
  assertEquals(done.bundle_hash, HASH);
  assertEquals(done.blueprint_hash, OUTCOME.blueprint_hash);
  assertEquals(done.manifest, OUTCOME.manifest);
});

Deno.test("apps/releases#R19: 같은 request_key의 같은 요청은 같은 진행이고 다른 commit은 conflict다", () => {
  const gate = gatedRunner();
  const service = createPreparationService(gate.runner);
  assert(service.start(job()).ok);
  const again = service.start(job());
  assert(again.ok);
  assertEquals(gate.runs.length, 1);
  const other = service.start(job({ commit: "2".repeat(40) }));
  assert(!other.ok);
  assertEquals(other.error.code, "conflict");
  // 다른 앱의 같은 request_key는 다른 요청이다.
  const otherApp = service.start(
    job({ app: "app_01h455vb4pex5v6nkc6gd5fdw9" }),
  );
  assert(otherApp.ok);
  assertEquals(gate.runs.length, 2);
});

Deno.test("apps/releases#R19: 실패한 준비는 failed이고 산출물 값이 없다", async () => {
  const service = createPreparationService({
    run: () => Promise.resolve(err({ code: "invalid_input", message: "no" })),
  });
  assert(service.start(job()).ok);
  await tick();
  const failed = service.get(APP, "prep-1");
  assertEquals(failed.status, "failed");
  assertEquals(failed.bundle_hash, null);
  assertEquals(failed.manifest, null);
});

Deno.test("apps/releases#R19: 취소는 실행 종료를 확인한 뒤 cancelled이고 끝난 뒤 늦게 온 결과로 확정하지 않는다", async () => {
  const gate = gatedRunner();
  const service = createPreparationService(gate.runner);
  assert(service.start(job()).ok);
  const cancelled = await service.cancel(APP, "prep-1");
  assert(cancelled.ok);
  assertEquals(service.get(APP, "prep-1").status, "cancelled");
  // 취소 뒤에 runner가 성공을 돌려줘도 이미 정해진 상태다.
  gate.finish(ok(OUTCOME));
  await tick();
  const after = service.get(APP, "prep-1");
  assertEquals(after.status, "cancelled");
  assertEquals(after.bundle_hash, null);
});

Deno.test("apps/releases#R19: 메모리를 잃은(새) 서비스에서 이전 요청은 unknown이고 취소는 conflict다", async () => {
  const first = createPreparationService(gatedRunner().runner);
  assert(first.start(job()).ok);
  // supervisor가 다시 떠서 새 서비스가 된 것이다.
  const second = createPreparationService(gatedRunner().runner);
  const lost = second.get(APP, "prep-1");
  assertEquals(lost.status, "unknown");
  assertEquals(lost.bundle_hash, null);
  assertEquals(lost.manifest, null);
  const cancelled = await second.cancel(APP, "prep-1");
  assert(!cancelled.ok);
  assertEquals(cancelled.error.code, "conflict");
});
