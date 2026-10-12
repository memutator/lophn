// supervisor의 release 준비 op(apps/releases#R19). core가 감독 pipe로 보내는 접수·조회·취소가 supervisor
// 메모리의 진행을 따르고, 진행이 붙지 않은 supervisor는 unavailable이다. 입력의 모양은 wire schema가 막는다.
import { assertEquals } from "@std/assert";
import { createIdSource, systemClock } from "../../packages/base/mod.ts";
import { err, ok } from "../../packages/base/mod.ts";
import {
  createPreparationService,
  type PreparationOutcome,
} from "../../packages/core/apps/releases/preparation.ts";
import {
  releasePreparationOutputSchema,
  SUPERVISOR_OPS,
} from "../../packages/core/apps/runtime/control-protocol.ts";
import { assembleSupervisor, type SupervisorIo } from "./assembly.ts";

const APP = "app_01aryz6s41s4z4k7p41s4z4k7p";
const OUTCOME: PreparationOutcome = {
  bundle_hash: "a".repeat(64),
  blueprint_hash: "b".repeat(64),
  manifest: {
    entrypoint: "main.ts",
    files: [{ path: "main.ts", hash: "c".repeat(64) }],
    sdk_dependencies: [],
  },
};

function io(extra: Partial<SupervisorIo>): SupervisorIo {
  return {
    clock: systemClock,
    ids: createIdSource({
      clock: systemClock,
      random: { fill: (bytes: Uint8Array) => crypto.getRandomValues(bytes) },
    }),
    deno: () => Deno.execPath(),
    environment: {},
    socketPaths: () => ({ broker: "/nowhere/b", direct: "/nowhere/d" }),
    nonce: () => crypto.randomUUID(),
    wait: () => Promise.resolve(),
    spawn: () => Promise.reject(new Error("no children in this test")),
    post: () => Promise.resolve({ status: 200, body: null }),
    direct: () => Promise.resolve({ status: 200, body: null }),
    send: () => undefined,
    ...extra,
  };
}

// op는 동기로 던지거나 거절로 끝날 수 있다. 던진 오류의 code를 돌려준다.
async function codeOf(run: () => unknown): Promise<string | undefined> {
  try {
    await run();
  } catch (thrown) {
    return (thrown as { code?: string }).code;
  }
  return undefined;
}

const request = {
  app: APP,
  commit: "1".repeat(40),
  request_key: "prep-1",
  source_path: "/work/app",
};

Deno.test("apps/releases#R19: supervisor op는 접수·조회·취소를 메모리 진행으로 이어 주고 끝난 결과만 낸다", async () => {
  let release: (() => void) | undefined;
  const service = createPreparationService({
    run: (_job, signal) =>
      new Promise((resolve) => {
        release = () => resolve(ok(OUTCOME));
        signal.addEventListener(
          "abort",
          () => resolve(err({ code: "unavailable", message: "stopped" })),
          { once: true },
        );
      }),
  });
  const assembly = assembleSupervisor(io({ preparation: service }));
  const accepted = releasePreparationOutputSchema.parse(
    await assembly.ops[SUPERVISOR_OPS.releasePrepare](request),
  );
  assertEquals(accepted.status, "preparing");
  assertEquals(accepted.bundle_hash, null);
  release?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const done = releasePreparationOutputSchema.parse(
    await assembly.ops[SUPERVISOR_OPS.releasePreparation]({
      app: APP,
      request_key: "prep-1",
    }),
  );
  assertEquals(done.status, "completed");
  assertEquals(done.bundle_hash, OUTCOME.bundle_hash);
  // 같은 request_key를 다른 commit에 쓰면 conflict다.
  assertEquals(
    await codeOf(() =>
      assembly.ops[SUPERVISOR_OPS.releasePrepare]({
        ...request,
        commit: "2".repeat(40),
      })
    ),
    "conflict",
  );
  // 새 supervisor(메모리 유실)에서는 같은 요청이 unknown이다.
  const lost = assembleSupervisor(io({
    preparation: createPreparationService({
      run: () => Promise.resolve(ok(OUTCOME)),
    }),
  }));
  const unknown = releasePreparationOutputSchema.parse(
    await lost.ops[SUPERVISOR_OPS.releasePreparation]({
      app: APP,
      request_key: "prep-1",
    }),
  );
  assertEquals(unknown.status, "unknown");
  assertEquals(unknown.manifest, null);
});

Deno.test("apps/releases#R19: 준비가 붙지 않은 supervisor와 잘못된 입력은 접수하지 않는다", async () => {
  const bare = assembleSupervisor(io({}));
  assertEquals(
    await codeOf(() => bare.ops[SUPERVISOR_OPS.releasePrepare](request)),
    "unavailable",
  );
  const attached = assembleSupervisor(io({
    preparation: createPreparationService({
      run: () => Promise.resolve(ok(OUTCOME)),
    }),
  }));
  for (
    const bad of [
      { ...request, commit: "abc" },
      { ...request, app: "not-an-app" },
      { ...request, extra: true },
    ]
  ) {
    assertEquals(
      await codeOf(() => attached.ops[SUPERVISOR_OPS.releasePrepare](bad)),
      "invalid_input",
    );
  }
});
