import { assert, assertEquals } from "@std/assert";
import { encodeFrame } from "../../../contracts/platform/mod.ts";
import { attachControlLink, type ControlReader } from "./control-link.ts";
import type { DesiredApp, Supervisor } from "./supervisor.ts";

const DESIRED: DesiredApp = {
  app: "app_00000000000000000000000001",
  release: "rel_00000000000000000000000001",
  bundleHash: "ab".repeat(32),
  runEnabled: true,
  archived: false,
  commands: ["ping"],
  dataSchema: 1,
  flags: { args: ["--cached-only"], limits: [] },
  entry: "/bundle/main.ts",
  importMap: "/bundle/import-map.json",
  dataPath: "/data",
};

function frame(payload: unknown): Uint8Array {
  return encodeFrame({ kind: "json", channel: 0, payload });
}

function scripted(frames: Uint8Array[]): ControlReader {
  const pending = frames.flatMap((bytes) => [...bytes]);
  return {
    read(buffer) {
      if (pending.length === 0) return Promise.resolve(null);
      const count = Math.min(buffer.length, pending.length);
      buffer.set(pending.splice(0, count));
      return Promise.resolve(count);
    },
  };
}

function supervisor(): Supervisor & {
  reconciled: DesiredApp[];
  closed: number;
} {
  const reconciled: DesiredApp[] = [];
  return {
    reconciled,
    closed: 0,
    reconcile(desired) {
      reconciled.push(desired);
      return Promise.resolve();
    },
    coreClosed() {
      this.closed += 1;
      return Promise.resolve();
    },
    observation: () => undefined,
    stop: () => Promise.resolve(),
  } as Supervisor & { reconciled: DesiredApp[]; closed: number };
}

Deno.test("apps/runtime#R7: credential hello는 한 번이고 두 번째는 자식을 끝낸다", async () => {
  const target = supervisor();
  const link = attachControlLink(
    target,
    scripted([
      frame({
        type: "hello",
        credential: "cred-1",
        verify_key: "k".repeat(43),
      }),
      frame({
        type: "hello",
        credential: "cred-2",
        verify_key: "k".repeat(43),
      }),
    ]),
  );
  await link.closed;
  assertEquals(link.credential(), "cred-1");
  assertEquals(target.closed, 1);
});

Deno.test("apps/runtime#R17: 제어 frame이 깨져도 core 단절로 자식을 끝낸다", async () => {
  const target = supervisor();
  const link = attachControlLink(
    target,
    scripted([new Uint8Array([1, 2, 3, 4])]),
  );
  await link.closed;
  assertEquals(target.closed, 1);
});

Deno.test("apps/runtime#R2: reconcile의 desired가 schema에 맞지 않으면 반영하지 않는다", async () => {
  const target = supervisor();
  const link = attachControlLink(
    target,
    scripted([
      frame({ type: "reconcile", desired: { app: "not-valid" } }),
      frame({ type: "reconcile", desired: DESIRED }),
    ]),
  );
  await link.closed;
  assertEquals(target.reconciled.length, 1);
  assertEquals(target.reconciled[0].app, DESIRED.app);
});

Deno.test("apps/runtime#R17: 제어 EOF면 자식을 끝낸다", async () => {
  const target = supervisor();
  const link = attachControlLink(target, scripted([]));
  await link.closed;
  assertEquals(target.closed, 1);
  assert(link.credential() === undefined);
});
