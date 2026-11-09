import assert from "node:assert/strict";
import { test } from "node:test";
import { manualClock, ok } from "../../../../base/mod.ts";
import {
  type AppChild,
  createSupervisor,
  type DesiredApp,
} from "./supervisor.ts";

const DESIRED: DesiredApp = {
  app: "app_1",
  release: "rel_1",
  bundleHash: "hash",
  runEnabled: true,
  archived: false,
  tools: [],
  dataSchema: 1,
  entry: "main.ts",
  dataPath: "/tmp/data",
};

// 지우면 crash loop로 멈춘 앱을 사람이 Run으로 켜도 창이 안 비어 다시 뜨지 않는다.
test("crash loop로 멈춘 앱은 사람이 다시 켜면 창을 비우고 다시 뜬다", async () => {
  let crashing = true;
  let spawned = 0;
  const supervisor = createSupervisor({
    clock: manualClock(1_000_000),
    core: { record: () => Promise.resolve(ok({ state: "x" })) },
    environment: {},
    socketPaths: () => ({ broker: "b", control: "c" }),
    nonce: () => `nonce_${spawned}`,
    credential: () => "credential",
    wait: () => Promise.resolve(),
    probe: (_child, _control, desired) => ({
      ok: true,
      tools: [],
      dataSchema: 1,
      bundleHash: desired.bundleHash,
    }),
    spawn: (request) => {
      spawned += 1;
      let finish: (code: number | null) => void = () => {};
      const exited = crashing
        ? Promise.resolve(1)
        : new Promise<number | null>((resolve) => (finish = resolve));
      const child: AppChild = {
        identity: { ...request.identity, pid: spawned },
        exited,
        terminate: () => {
          finish(0);
          return Promise.resolve(true);
        },
      };
      return Promise.resolve(child);
    },
  });

  await supervisor.reconcile(DESIRED);
  for (let i = 0; i < 200; i++) {
    if (supervisor.observation(DESIRED.app)?.reason?.code === "crash_loop") {
      break;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(supervisor.observation(DESIRED.app)?.reason?.code, "crash_loop");
  const halted = spawned;

  crashing = false;
  await supervisor.reconcile(DESIRED);
  assert.equal(spawned, halted + 1);
  assert.equal(supervisor.observation(DESIRED.app)?.reason, undefined);
  await supervisor.stop();
});
